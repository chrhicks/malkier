import { describe, expect, test } from "bun:test"
import { gradeHelloNoToolTranscript } from "./hello-no-tool-lib"

describe("gradeHelloNoToolTranscript", () => {
  test("passes a self-descriptive response with no tool activity", () => {
    const assertions = gradeHelloNoToolTranscript({
      finalText: "I'm Malkier, a coding-focused assistant working in your local workspace.",
      toolCalls: [],
      toolResults: []
    })

    expect(assertions.every((assertion) => assertion.pass)).toBe(true)
  })

  test("fails when tool activity is present", () => {
    const assertions = gradeHelloNoToolTranscript({
      finalText: "I'm Malkier.",
      toolCalls: [
        {
          id: "call-1",
          name: "list_sessions",
          params: {}
        }
      ],
      toolResults: []
    })

    expect(assertions.find((assertion) => assertion.name === "does_not_call_tools")?.pass).toBe(false)
  })

  test("fails when the answer claims unsupported side effects", () => {
    const assertions = gradeHelloNoToolTranscript({
      finalText: "I ran tests before answering. I'm Malkier.",
      toolCalls: [],
      toolResults: []
    })

    expect(assertions.find((assertion) => assertion.name === "does_not_claim_unsupported_side_effects")?.pass).toBe(false)
  })

  test("allows capability descriptions that mention what it can report", () => {
    const assertions = gradeHelloNoToolTranscript({
      finalText: "I'm Malkier, and I can report exactly what I changed and verified.",
      toolCalls: [],
      toolResults: []
    })

    expect(assertions.find((assertion) => assertion.name === "does_not_claim_unsupported_side_effects")?.pass).toBe(true)
  })

  test("allows hypothetical honesty statements about not pretending", () => {
    const assertions = gradeHelloNoToolTranscript({
      finalText: "I'm Malkier, and I won't pretend I ran tests when I didn't.",
      toolCalls: [],
      toolResults: []
    })

    expect(assertions.find((assertion) => assertion.name === "does_not_claim_unsupported_side_effects")?.pass).toBe(true)
  })
})
