import { describe, expect, test } from "bun:test"
import { gradeMustUseToolTranscript } from "./must-use-tool-lib"

const expectedTitles = ["alpha eval session", "beta eval session"]

describe("gradeMustUseToolTranscript", () => {
  test("passes when list_sessions is called and seeded titles are mentioned", () => {
    const assertions = gradeMustUseToolTranscript({
      transcript: {
        finalText: "Recent sessions: alpha eval session and beta eval session.",
        toolCalls: [
          {
            id: "call-1",
            name: "list_sessions",
            params: {}
          }
        ],
        toolResults: []
      },
      expectedTitles
    })

    expect(assertions.every((assertion) => assertion.pass)).toBe(true)
  })

  test("fails when the required tool was not called", () => {
    const assertions = gradeMustUseToolTranscript({
      transcript: {
        finalText: "Recent sessions: alpha eval session and beta eval session.",
        toolCalls: [],
        toolResults: []
      },
      expectedTitles
    })

    expect(assertions.find((assertion) => assertion.name === "calls_list_sessions")?.pass).toBe(false)
  })

  test("fails when the answer omits seeded titles", () => {
    const assertions = gradeMustUseToolTranscript({
      transcript: {
        finalText: "Recent sessions are available.",
        toolCalls: [
          {
            id: "call-1",
            name: "list_sessions",
            params: {}
          }
        ],
        toolResults: []
      },
      expectedTitles
    })

    expect(assertions.find((assertion) => assertion.name === "mentions_seeded_session_titles")?.pass).toBe(false)
  })
})
