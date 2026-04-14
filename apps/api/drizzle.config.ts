import { defineConfig } from "drizzle-kit"
import { getMalkierConfigInput, resolveMalkierPath } from "./src/config/malkier-config"

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: resolveMalkierPath(getMalkierConfigInput().database.path)
  },
  strict: true,
  verbose: true
})
