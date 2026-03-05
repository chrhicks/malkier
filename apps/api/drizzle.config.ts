import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: Bun.env.MALKIER_DB_PATH ?? ".data/malkier.sqlite"
  },
  strict: true,
  verbose: true
})
