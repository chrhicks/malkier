import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import * as schema from "./schema"

const appRoot = resolve(import.meta.dirname, "../..")

export const dbPath = resolve(
  appRoot,
  Bun.env.MALKIER_DB_PATH ?? ".data/malkier.sqlite"
)

mkdirSync(dirname(dbPath), { recursive: true })

export const sqlite = new Database(dbPath, { create: true })

sqlite.run("PRAGMA journal_mode = WAL;")
sqlite.run("PRAGMA foreign_keys = ON;")

export const db = drizzle(sqlite, { schema })

export { schema }
