import { describe, expect, test } from "bun:test"
import { gradeRepoGroundedApproachTranscript } from "./repo-grounded-approach-lib"

const targetPath = "apps/api/src/workspace-root.ts"
const expectedConsumers = [
  "apps/api/src/agent/prompt-assembler.ts",
  "apps/api/src/agent/tools/file-tools.ts",
  "apps/api/src/agent/tools/shell-tools.ts"
]

describe("gradeRepoGroundedApproachTranscript", () => {
  test("passes when the agent inspects the repo and names the abstraction plus a real consumer", () => {
    const assertions = gradeRepoGroundedApproachTranscript({
      transcript: {
        finalText: [
          "I inspected apps/api/src/workspace-root.ts first.",
          "I would turn it into a Workspace abstraction and then move current consumers like apps/api/src/agent/prompt-assembler.ts onto that service boundary."
        ].join(" "),
        toolCalls: [
          {
            id: "call-1",
            name: "read_file",
            params: { path: targetPath }
          }
        ],
        toolResults: []
      },
      targetPath,
      expectedConsumers
    })

    expect(assertions.every((assertion) => assertion.pass)).toBe(true)
  })

  test("fails when the agent answers without repo inspection", () => {
    const assertions = gradeRepoGroundedApproachTranscript({
      transcript: {
        finalText: "In general I would create a Workspace abstraction and inject it across the system.",
        toolCalls: [],
        toolResults: []
      },
      targetPath,
      expectedConsumers
    })

    expect(assertions.find((assertion) => assertion.name === "inspects_workspace_root_or_related_code")?.pass).toBe(false)
  })

  test("fails when the answer omits real consumers", () => {
    const assertions = gradeRepoGroundedApproachTranscript({
      transcript: {
        finalText: "I inspected apps/api/src/workspace-root.ts and would evolve it into a proper Workspace abstraction.",
        toolCalls: [
          {
            id: "call-1",
            name: "read_file",
            params: { path: targetPath }
          }
        ],
        toolResults: []
      },
      targetPath,
      expectedConsumers
    })

    expect(assertions.find((assertion) => assertion.name === "mentions_real_consumers")?.pass).toBe(false)
  })
})
