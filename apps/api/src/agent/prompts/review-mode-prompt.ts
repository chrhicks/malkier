import { readFileSync } from "node:fs"

const reviewModePromptFile = new URL("./review-mode-prompt.md", import.meta.url)

export const reviewModePromptSource = "apps/api/src/agent/prompts/review-mode-prompt.md"

export const reviewModePrompt = readFileSync(reviewModePromptFile, "utf8").trim()
