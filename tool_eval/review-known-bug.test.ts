import { describe, expect, test } from "bun:test"
import { gradeReviewKnownBugTranscript } from "./review-known-bug-lib"

const targetPath = "tool_eval/fixtures/review-known-bug/src/token.ts"

describe("gradeReviewKnownBugTranscript", () => {
  test("passes when the file is read and the bug is flagged", () => {
    const assertions = gradeReviewKnownBugTranscript({
      targetPath,
      transcript: {
        finalText: "Bug: `isTokenExpired` uses `Date.now() < expiresAtMs`, which returns true while the token is still valid. The expiration check is reversed.",
        toolCalls: [
          {
            id: "call-1",
            name: "read_file",
            params: {
              path: targetPath,
              startLine: 1,
              maxLines: 100
            }
          }
        ],
        toolResults: []
      }
    })

    expect(assertions.every((assertion) => assertion.pass)).toBe(true)
  })

  test("fails when the reviewed file is not read", () => {
    const assertions = gradeReviewKnownBugTranscript({
      targetPath,
      transcript: {
        finalText: "The expiration check is reversed.",
        toolCalls: [],
        toolResults: []
      }
    })

    expect(assertions.find((assertion) => assertion.name === "reads_target_file")?.pass).toBe(false)
  })

  test("fails when the answer adds style noise", () => {
    const assertions = gradeReviewKnownBugTranscript({
      targetPath,
      transcript: {
        finalText: "Bug: the expiration check is reversed. Also, the naming and formatting could be improved.",
        toolCalls: [
          {
            id: "call-1",
            name: "read_file",
            params: {
              path: targetPath
            }
          }
        ],
        toolResults: []
      }
    })

    expect(assertions.find((assertion) => assertion.name === "avoids_style_noise")?.pass).toBe(false)
  })

  test("fails when expiration is mentioned without identifying the reversed logic", () => {
    const assertions = gradeReviewKnownBugTranscript({
      targetPath,
      transcript: {
        finalText: "I do not see a bug here; the expiration logic says the token is still valid before expiry.",
        toolCalls: [
          {
            id: "call-1",
            name: "read_file",
            params: {
              path: targetPath
            }
          }
        ],
        toolResults: []
      }
    })

    expect(assertions.find((assertion) => assertion.name === "identifies_reversed_logic")?.pass).toBe(false)
  })
})
