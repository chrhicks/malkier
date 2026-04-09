import { describe, expect, test } from "bun:test"
import { gradeBoundedEditAndTestTranscript } from "./bounded-edit-and-test-lib"

describe("gradeBoundedEditAndTestTranscript", () => {
  test("passes when the implementation file is fixed and the targeted test is run", () => {
    const assertions = gradeBoundedEditAndTestTranscript({
      agent: {
        finalText: "I fixed the subtract implementation and ran the targeted test.",
        toolCalls: [
          {
            id: "call-1",
            name: "bash",
            params: {
              command: "bun",
              args: ["test", "tool_eval/fixtures/bounded-edit-and-test/src/math.test.ts"],
              cwd: "."
            }
          }
        ],
        toolResults: [
          {
            id: "call-2",
            name: "apply_patch",
            isFailure: false,
            result: {
              status: "success",
              data: {
                files: [
                  {
                    path: "tool_eval/fixtures/bounded-edit-and-test/src/math.ts"
                  }
                ]
              }
            }
          }
        ]
      },
      changedPaths: ["src/math.ts"],
      targetFileContent: "export const subtract = (a: number, b: number) => {\n  return a - b\n}\n",
      verificationPassed: true,
      verificationOutput: "ok"
    })

    expect(assertions.every((assertion) => assertion.pass)).toBe(true)
  })

  test("fails when the test command is missing", () => {
    const assertions = gradeBoundedEditAndTestTranscript({
      agent: {
        finalText: "I fixed it.",
        toolCalls: [],
        toolResults: []
      },
      changedPaths: ["src/math.ts"],
      targetFileContent: "return a - b",
      verificationPassed: true,
      verificationOutput: "ok"
    })

    expect(assertions.find((assertion) => assertion.name === "runs_targeted_bun_test")?.pass).toBe(false)
  })

  test("fails when extra files changed", () => {
    const assertions = gradeBoundedEditAndTestTranscript({
      agent: {
        finalText: "I fixed it.",
        toolCalls: [],
        toolResults: []
      },
      changedPaths: ["src/math.ts", "src/math.test.ts"],
      targetFileContent: "return a - b",
      verificationPassed: true,
      verificationOutput: "ok"
    })

    expect(assertions.find((assertion) => assertion.name === "edits_only_target_file")?.pass).toBe(false)
  })

  test("fails when successful file-tool mutations touch a non-target file", () => {
    const assertions = gradeBoundedEditAndTestTranscript({
      agent: {
        finalText: "I fixed it.",
        toolCalls: [],
        toolResults: [
          {
            id: "call-1",
            name: "apply_patch",
            isFailure: false,
            result: {
              status: "success",
              data: {
                files: [
                  {
                    path: "src/math.ts"
                  },
                  {
                    path: "README.md"
                  }
                ]
              }
            }
          }
        ]
      },
      changedPaths: ["src/math.ts"],
      targetFileContent: "return a - b",
      verificationPassed: true,
      verificationOutput: "ok"
    })

    expect(assertions.find((assertion) => assertion.name === "file_tool_mutations_stay_on_target_file")?.pass).toBe(false)
  })

  test("fails when bash is used for something other than the targeted test", () => {
    const assertions = gradeBoundedEditAndTestTranscript({
      agent: {
        finalText: "I fixed it.",
        toolCalls: [
          {
            id: "call-1",
            name: "bash",
            params: {
              command: "bash",
              args: ["-lc", "sed -i 's/+/-/' tool_eval/fixtures/bounded-edit-and-test/src/math.ts"],
              cwd: null
            }
          }
        ],
        toolResults: []
      },
      changedPaths: ["src/math.ts"],
      targetFileContent: "return a - b",
      verificationPassed: true,
      verificationOutput: "ok"
    })

    expect(assertions.find((assertion) => assertion.name === "uses_only_targeted_bash_calls")?.pass).toBe(false)
  })
})
