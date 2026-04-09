import { Schema } from "effect"
import {
  assertNonEmptyAnswer,
  assertTextDoesNotMatch,
  assertTextMatches,
  assertToolCallWhere,
  makeAssertion,
  ToolEventTranscript,
  type EvalAssertion
} from "./core"

export const ReviewKnownBugTranscript = ToolEventTranscript

export type ReviewKnownBugTranscript = Schema.Schema.Type<typeof ReviewKnownBugTranscript>

type ReadFileParams = {
  path?: unknown
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const readsTargetFile = (params: unknown, targetPath: string) => {
  if (!isObject(params)) {
    return false
  }

  const { path } = params as ReadFileParams
  return path === targetPath
}

const identifiesReversedExpirationLogic = (text: string) => {
  const lowered = text.toLowerCase()

  return (
    /(?:reversed|inverted|opposite)/i.test(text)
    || /nowms\s*>?=\s*expiresatms/i.test(text)
    || /should (?:be|use|return).*>=/i.test(text)
    || (lowered.includes("returns true") && lowered.includes("still valid"))
    || (lowered.includes("before expiry") && lowered.includes("should") && lowered.includes("false"))
  )
}

export const gradeReviewKnownBugTranscript = ({
  transcript,
  targetPath
}: {
  transcript: ReviewKnownBugTranscript,
  targetPath: string
}): ReadonlyArray<EvalAssertion> => {
  const finalText = transcript.finalText.trim()

  return [
    assertNonEmptyAnswer(finalText),
    assertToolCallWhere({
      transcript,
      assertionName: "reads_target_file",
      predicate: (toolCall) => toolCall.name === "read_file" && readsTargetFile(toolCall.params, targetPath),
      passDetail: "Observed a read_file call for the reviewed file.",
      failDetail: "Did not observe a read_file call for the reviewed file."
    }),
    assertTextMatches({
      text: finalText,
      assertionName: "flags_expiration_bug",
      pattern: /(?:expired|expiration|expiry|isTokenExpired)/i,
      passDetail: "Answer flags the seeded expiration logic bug.",
      failDetail: "Answer does not clearly flag the seeded expiration logic bug."
    }),
    makeAssertion(
      "identifies_reversed_logic",
      identifiesReversedExpirationLogic(finalText),
      "Answer identifies the reversed expiration logic rather than just mentioning expiration generically.",
      "Answer mentions expiration but does not clearly identify the reversed logic bug."
    ),
    assertTextDoesNotMatch({
      text: finalText,
      assertionName: "avoids_style_noise",
      pattern: /\bstyle\b|\bformat(?:ting)?\b|\bnaming\b|\breadability\b|\bnit\b/i,
      passDetail: "Answer avoids style-only review noise.",
      failDetail: "Answer includes style-only review noise."
    })
  ]
}
