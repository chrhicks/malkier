import { Schema } from "effect"
import {
  assertCalledTool,
  assertMentionsAll,
  assertNonEmptyAnswer,
  makeAssertion,
  ToolEventTranscript,
  type EvalAssertion
} from "./core"

export const MustUseToolTranscript = ToolEventTranscript

export type MustUseToolTranscript = Schema.Schema.Type<typeof MustUseToolTranscript>

export const gradeMustUseToolTranscript = ({
  transcript,
  expectedTitles
}: {
  transcript: MustUseToolTranscript,
  expectedTitles: ReadonlyArray<string>
}): ReadonlyArray<EvalAssertion> => {
  const finalText = transcript.finalText.trim()

  return [
    assertCalledTool({
      transcript,
      toolName: "list_sessions",
      assertionName: "calls_list_sessions"
    }),
    assertNonEmptyAnswer(finalText),
    assertMentionsAll({
      text: finalText,
      values: expectedTitles,
      assertionName: "mentions_seeded_session_titles",
      subject: "session titles"
    }),
    makeAssertion(
      "does_not_claim_no_sessions",
      !/\bno sessions\b|\bno recent sessions\b|\bno chat sessions\b/i.test(finalText),
      "Answer does not incorrectly claim there are no sessions.",
      "Answer incorrectly claims there are no sessions."
    )
  ]
}
