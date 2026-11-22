import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { captureLegacyData, importLegacyData } from "./legacy-migration.js";

const migrationsDirectories = [
  fileURLToPath(new URL("./migrations/", import.meta.url)),
  fileURLToPath(new URL("../../src/db/migrations/", import.meta.url)),
];
const schemaPaths = [
  fileURLToPath(new URL("./workbook-schema.sql", import.meta.url)),
  fileURLToPath(new URL("../../src/db/workbook-schema.sql", import.meta.url)),
];

export function migrateDatabase(database: Database.Database): void {
  const hasHistory = Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  ).get());
  const hasTables = Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1",
  ).get());
  const version = (database.pragma("user_version") as Array<{ user_version: number }>)[0]?.user_version ?? 0;
  if (!hasHistory && version === 1) {
    const attendanceColumns = database.pragma('table_info("ATENDIMENTO")') as Array<{ name: string }>;
    if (attendanceColumns.length > 0 && !attendanceColumns.some((column) => column.name === "dt_inicio_real")) {
      database.exec("ALTER TABLE ATENDIMENTO ADD COLUMN dt_inicio_real TEXT");
    }
    return;
  }

  if (hasHistory) applyLegacyMigrations(database);
  applyWorkbookSchema(database, hasTables || hasHistory);
}

function applyLegacyMigrations(database: Database.Database): void {
  const migrationsDirectory = migrationsDirectories.find((directory) => existsSync(directory));
  if (!migrationsDirectory) throw new Error("SQLite migration directory was not found.");
  const migrationFiles = readdirSync(migrationsDirectory).filter((file) => file.endsWith(".sql")).sort();
  const hasMigration = database.prepare("SELECT 1 FROM schema_migrations WHERE version = ?");
  const recordMigration = database.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)");
  for (const version of migrationFiles) {
    if (hasMigration.get(version)) continue;
    const sql = readFileSync(join(migrationsDirectory, version), "utf8");
    const applyMigration = database.transaction(() => {
      const conditionalColumn = sql.match(/^\s*-- @add-column-if-missing ([A-Z_]+) ([a-zA-Z_]+) ([A-Z]+)\s*$/m);
      if (conditionalColumn) {
        const [, table, column, columnType] = conditionalColumn;
        const columns = database.pragma(`table_info("${table}")`) as Array<{ name: string }>;
        if (!columns.some((entry) => entry.name === column)) {
          database.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${columnType}`);
        }
      }
      const statements = sql.replace(/^\s*-- @add-column-if-missing [A-Z_]+ [a-zA-Z_]+ [A-Z]+\s*$/m, "").trim();
      if (statements) database.exec(statements);
      recordMigration.run(version, new Date().toISOString());
    });
    applyMigration.immediate();
  }
}

function applyWorkbookSchema(database: Database.Database, backupExisting: boolean): void {
  const schemaPath = schemaPaths.find((candidate) => existsSync(candidate));
  if (!schemaPath) throw new Error("Workbook SQLite schema file was not found.");
  const schema = readFileSync(schemaPath, "utf8");
  const legacyData = backupExisting ? captureLegacyData(database) : null;
  if (backupExisting && database.name !== ":memory:") {
    const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "Z");
    const backupPath = join(dirname(database.name), `${basename(database.name, ".sqlite")}.before-workbook-remodel-${stamp}.sqlite`);
    database.pragma("wal_checkpoint(FULL)");
    database.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  }

  database.pragma("foreign_keys = OFF");
  const replaceSchema = database.transaction(() => {
    const objects = database.prepare(
      "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND type IN ('table','view','trigger','index') ORDER BY CASE type WHEN 'trigger' THEN 0 WHEN 'view' THEN 1 WHEN 'index' THEN 2 ELSE 3 END",
    ).all() as Array<{ type: string; name: string }>;
    for (const object of objects) {
      if (object.type === "index") continue;
      database.exec(`DROP ${object.type.toUpperCase()} IF EXISTS "${object.name.replace(/"/g, '""')}"`);
    }
    database.exec(schema);
    if (legacyData) importLegacyData(database, legacyData);
  });
  replaceSchema.immediate();
  database.pragma("foreign_keys = ON");
  const violations = database.pragma("foreign_key_check") as unknown[];
  if (violations.length > 0) throw new Error(`Workbook schema contains ${violations.length} foreign-key violation(s).`);
}
