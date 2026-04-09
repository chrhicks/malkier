import { readFileSync } from "node:fs"

const baseSystemPromptFile = new URL("./malkier-base-system-prompt.md", import.meta.url)

export const malkierBaseSystemPrompt = readFileSync(baseSystemPromptFile, "utf8").trim()
