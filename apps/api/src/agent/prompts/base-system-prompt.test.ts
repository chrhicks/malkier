import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { malkierBaseSystemPrompt } from "./base-system-prompt"

describe("malkierBaseSystemPrompt", () => {
  test("loads the base prompt markdown asset from disk", () => {
    const promptFile = new URL("./malkier-base-system-prompt.md", import.meta.url)

    expect(malkierBaseSystemPrompt).toBe(readFileSync(promptFile, "utf8").trim())
  })
})
