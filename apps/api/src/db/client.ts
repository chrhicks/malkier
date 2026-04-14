import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import * as schema from "./schema"
import { getMalkierConfigInput, resolveMalkierPath } from "../config/malkier-config"

export const dbPath = resolveMalkierPath(getMalkierConfigInput().database.path)

mkdirSync(dirname(dbPath), { recursive: true })

export const sqlite = new Database(dbPath, { create: true })

sqlite.run("PRAGMA journal_mode = WAL;")
sqlite.run("PRAGMA foreign_keys = ON;")

export const db = drizzle(sqlite, { schema })

export { schema }
