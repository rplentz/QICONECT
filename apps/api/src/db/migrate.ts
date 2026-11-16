import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";

const migrationsDirectories = [
  fileURLToPath(new URL("./migrations/", import.meta.url)),
  fileURLToPath(new URL("../../src/db/migrations/", import.meta.url)),
];

export function migrateDatabase(database: Database.Database): void {
  const migrationsDirectory = migrationsDirectories.find((directory) => existsSync(directory));
  if (!migrationsDirectory) {
    throw new Error("SQLite migration directory was not found.");
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const hasMigration = database.prepare("SELECT 1 FROM schema_migrations WHERE version = ?");
  const recordMigration = database.prepare(
    "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
  );

  for (const version of migrationFiles) {
    if (hasMigration.get(version)) continue;

    const sql = readFileSync(join(migrationsDirectory, version), "utf8");
    const applyMigration = database.transaction(() => {
      database.exec(sql);
      recordMigration.run(version, new Date().toISOString());
    });
    applyMigration.immediate();
  }
}
