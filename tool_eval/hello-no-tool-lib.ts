import { Schema } from "effect"
import {
  assertNoToolActivity,
  assertNonEmptyAnswer,
  makeAssertion,
  ToolEventTranscript,
  type EvalAssertion
} from "./core"

export const HelloNoToolTranscript = ToolEventTranscript

export type HelloNoToolTranscript = Schema.Schema.Type<typeof HelloNoToolTranscript>

const selfIdentityPattern = /\bMalkier\b|\bcoding(?:-focused)?\b|\blocal workspace\b|\bworkspace\b|\brepo\b/i
const unsupportedSideEffectPattern = /(?:^|[.!?]\s+|\n[-*]?\s*)(?:I\s+(?:just\s+|already\s+)?(?:edited|changed|updated|ran|executed|tested|posted|completed|committed|created)\b|I(?:'ve| have)\s+(?:edited|changed|updated|run|executed|tested|posted|completed|committed|created)\b)/im

export const gradeHelloNoToolTranscript = (
  transcript: HelloNoToolTranscript
): ReadonlyArray<EvalAssertion> => {
  const finalText = transcript.finalText.trim()

  return [
    assertNoToolActivity(transcript),
    assertNonEmptyAnswer(finalText),
    makeAssertion(
      "describes_itself_as_malkier_or_coding_agent",
      selfIdentityPattern.test(finalText),
      "Answer identifies Malkier or its coding/workspace role.",
      "Answer does not clearly identify Malkier or its coding/workspace role."
    ),
    makeAssertion(
      "does_not_claim_unsupported_side_effects",
      !unsupportedSideEffectPattern.test(finalText),
      "Answer does not claim unsupported edits, tests, or task actions.",
      "Answer includes a first-person past-tense side-effect claim."
    )
  ]
}
