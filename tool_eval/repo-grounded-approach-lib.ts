import { Schema } from "effect"
import {
  assertNonEmptyAnswer,
  assertToolCallWhere,
  makeAssertion,
  ToolEventTranscript,
  type EvalAssertion
} from "./core"

export const RepoGroundedApproachTranscript = ToolEventTranscript

export type RepoGroundedApproachTranscript = Schema.Schema.Type<typeof RepoGroundedApproachTranscript>

type FileToolCallParams = {
  path?: unknown
  query?: unknown
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const readsTargetFile = (params: unknown, targetPath: string) => {
  if (!isObject(params)) {
    return false
  }

  const { path } = params as FileToolCallParams
  return path === targetPath
}

const searchesForWorkspaceRoot = (params: unknown) => {
  if (!isObject(params)) {
    return false
  }

  const { query } = params as FileToolCallParams
  return typeof query === "string" && /workspace-root|workspaceRoot/i.test(query)
}

const mentionsConsumer = (text: string, consumer: string) => {
  const basename = consumer.split("/").at(-1)

  return text.includes(consumer) || (basename != null && text.includes(basename))
}

export const gradeRepoGroundedApproachTranscript = ({
  transcript,
  targetPath,
  expectedConsumers
}: {
  transcript: RepoGroundedApproachTranscript,
  targetPath: string,
  expectedConsumers: ReadonlyArray<string>
}): ReadonlyArray<EvalAssertion> => {
  const finalText = transcript.finalText.trim()

  return [
    assertNonEmptyAnswer(finalText),
    assertToolCallWhere({
      transcript,
      assertionName: "inspects_workspace_root_or_related_code",
      predicate: (toolCall) =>
        (toolCall.name === "read_file" && readsTargetFile(toolCall.params, targetPath))
        || (toolCall.name === "search_code" && searchesForWorkspaceRoot(toolCall.params))
        || toolCall.name === "glob_files",
      passDetail: "Observed repo inspection before answering the architecture question.",
      failDetail: "Did not observe a focused repo inspection tool call for the architecture question."
    }),
    makeAssertion(
      "mentions_target_abstraction",
      /workspace-root\.ts|Workspace abstraction|workspace root/i.test(finalText),
      "Answer references the current workspace-root abstraction directly.",
      "Answer does not reference the current workspace-root abstraction directly."
    ),
    makeAssertion(
      "mentions_real_consumers",
      expectedConsumers.some((consumer) => mentionsConsumer(finalText, consumer)),
      "Answer mentions at least one real current consumer of the abstraction.",
      `Answer does not mention any expected current consumers: ${expectedConsumers.join(", ")}.`
    ),
    makeAssertion(
      "avoids_claiming_no_inspection_needed",
      !/without needing to inspect|without looking at the code|generally i would|in general i would start/i.test(finalText),
      "Answer stays grounded instead of explicitly hand-waving inspection away.",
      "Answer falls back to generic, inspection-free framing."
    )
  ]
}
