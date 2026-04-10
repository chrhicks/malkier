import { describe, expect, test } from "bun:test"
import { createPromptRunMetadata } from "./prompt-run-metadata"
import { assemblePrompt } from "./prompt-assembler"

describe("prompt run metadata", () => {
  test("builds compact persisted metadata for base, repo, mode, and skill layers", () => {
    const assembled = assemblePrompt({
      messages: [],
      explicitMode: "review",
      selectedSkills: ["coding-standards"]
    })

    const metadata = createPromptRunMetadata(assembled)

    expect(metadata.resolvedMode).toBe("review")
    expect(metadata.selectedSkills).toEqual(["coding-standards"])
    expect(metadata.rootAgentsLoaded).toBe(true)
    expect(metadata.layers.map((layer) => ({ kind: layer.kind, source: layer.source }))).toEqual([
      {
        kind: "base",
        source: "apps/api/src/agent/prompts/malkier-base-system-prompt.md"
      },
      {
        kind: "repo",
        source: "AGENTS.md"
      },
      {
        kind: "mode",
        source: "apps/api/src/agent/prompts/review-mode-prompt.md"
      },
      {
        kind: "skill",
        source: ".agents/skills/coding-standards/SKILL.md"
      }
    ])
    expect(metadata.layers.map((layer) => layer.order)).toEqual([0, 1, 2, 3])
    expect(metadata.layers.every((layer) => typeof layer.sha256 === "string" && layer.sha256.length > 0)).toBe(true)
  })
})
