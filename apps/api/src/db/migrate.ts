import { resolve } from "node:path"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { db, dbPath } from "./client"

const migrationsFolder = resolve(import.meta.dirname, "../../drizzle")

export const migrateDb = () => migrate(db, { migrationsFolder })

if (import.meta.main) {
  migrateDb()
  console.log(`Applied migrations from ${migrationsFolder} to ${dbPath}`)
}
