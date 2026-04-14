import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { appendToolLoadedSkill, createPromptRunMetadata } from "./prompt-run-metadata"
import { decodePromptRunMetadata } from "./prompt-run-metadata"
import { assemblePrompt } from "./prompt-assembler"

describe("prompt run metadata", () => {
  test("builds compact persisted metadata for base, repo, runtime, mode, and skill layers", () => {
    const assembled = assemblePrompt({
      messages: [],
      explicitMode: "review",
      selectedSkills: ["coding-standards"]
    })

    const metadata = createPromptRunMetadata(assembled)

    expect(metadata.resolvedMode).toBe("review")
    expect(metadata.selectedSkills).toEqual(["coding-standards"])
    expect(metadata.toolLoadedSkills).toEqual([])
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
        kind: "runtime",
        source: "@malkier/agent/available-skills"
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
    expect(metadata.layers.map((layer) => layer.order)).toEqual([0, 1, 2, 3, 4])
    expect(metadata.layers.every((layer) => typeof layer.sha256 === "string" && layer.sha256.length > 0)).toBe(true)
  })

  test("includes subagent layers in persisted run metadata", () => {
    const assembled = assemblePrompt({
      messages: [],
      subagentContext: {
        role: "code-reviewer",
        brief: "Inspect the latest patch for regressions.",
        outputContract: "Return summary and findings.",
        inheritedMode: "review",
        inheritedSkills: ["coding-standards"]
      }
    })

    const metadata = createPromptRunMetadata(assembled)

    expect(metadata.resolvedMode).toBe("review")
    expect(metadata.selectedSkills).toEqual(["coding-standards"])
    expect(metadata.toolLoadedSkills).toEqual([])
    expect(metadata.layers.at(-1)).toEqual({
      order: 5,
      id: metadata.layers[5]!.id,
      kind: "subagent",
      source: "subagent:code-reviewer",
      sha256: metadata.layers[5]!.sha256
    })
  })

  test("appends tool-loaded skills without duplicates", () => {
    const metadata = appendToolLoadedSkill(
      appendToolLoadedSkill(
        createPromptRunMetadata(assemblePrompt({ messages: [] })),
        "coding-standards"
      ),
      "coding-standards"
    )

    expect(metadata.toolLoadedSkills).toEqual(["coding-standards"])
  })

  test("decodes older run metadata rows that do not include toolLoadedSkills", async () => {
    const decoded = await Effect.runPromise(
      decodePromptRunMetadata(JSON.stringify({
        resolvedMode: "default",
        selectedSkills: [],
        rootAgentsLoaded: true,
        layers: [
          {
            order: 0,
            id: "base:abc",
            kind: "base",
            source: "apps/api/src/agent/prompts/malkier-base-system-prompt.md",
            sha256: "abc"
          }
        ]
      }))
    )

    expect(decoded.toolLoadedSkills).toEqual([])
    expect(decoded.rootAgentsLoaded).toBe(true)
  })
})
