import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../config/env.js";
import { migrateDatabase } from "./migrate.js";

const projectRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const databasePath =
  env.DATABASE_PATH === ":memory:"
    ? ":memory:"
    : isAbsolute(env.DATABASE_PATH)
      ? env.DATABASE_PATH
      : resolve(projectRoot, env.DATABASE_PATH);

if (databasePath !== ":memory:") {
  mkdirSync(dirname(databasePath), { recursive: true });
}

export const db = new Database(databasePath);

db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

migrateDatabase(db);
