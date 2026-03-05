import { resolve } from "node:path"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { db, dbPath } from "./client"

const migrationsFolder = resolve(import.meta.dirname, "../../drizzle")

migrate(db, { migrationsFolder })

console.log(`Applied migrations from ${migrationsFolder} to ${dbPath}`)
