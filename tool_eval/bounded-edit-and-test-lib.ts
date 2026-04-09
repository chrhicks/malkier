import { Schema } from "effect"
import {
  assertNonEmptyAnswer,
  assertToolCallWhere,
  makeAssertion,
  ToolEventTranscript,
  type EvalAssertion
} from "./core"

export const BoundedEditAndTestTranscript = Schema.Struct({
  agent: ToolEventTranscript,
  changedPaths: Schema.Array(Schema.String),
  targetFileContent: Schema.String,
  verificationPassed: Schema.Boolean,
  verificationOutput: Schema.String
})

export type BoundedEditAndTestTranscript = Schema.Schema.Type<typeof BoundedEditAndTestTranscript>

type BashToolCallParams = {
  command?: unknown,
  args?: unknown,
  cwd?: unknown
}

type FileMutationResult = {
  status?: unknown,
  data?: unknown
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const collectMutationPaths = (transcript: ToolEventTranscript): ReadonlyArray<string> => {
  const paths = new Set<string>()

  for (const toolResult of transcript.toolResults) {
    if (toolResult.isFailure || !isObject(toolResult.result)) {
      continue
    }

    const result = toolResult.result as FileMutationResult
    if (result.status !== "success" || !isObject(result.data)) {
      continue
    }

    if (toolResult.name === "apply_patch") {
      const files = result.data.files
      if (!Array.isArray(files)) {
        continue
      }

      for (const file of files) {
        if (isObject(file) && typeof file.path === "string") {
          paths.add(file.path)
        }
      }

      continue
    }

    if ((toolResult.name === "write_file" || toolResult.name === "delete_file") && typeof result.data.path === "string") {
      paths.add(result.data.path)
    }
  }

  return Array.from(paths).sort()
}

const isTargetedBunTestCall = (params: unknown) => {
  if (!isObject(params)) {
    return false
  }

  const { command, args, cwd } = params as BashToolCallParams
  if (command !== "bun" || !Array.isArray(args) || !args.includes("test")) {
    return false
  }

  const normalizedArgs = args.filter((arg): arg is string => typeof arg === "string")
  const normalizedCwd = typeof cwd === "string" ? cwd : null

  return normalizedArgs.includes("tool_eval/fixtures/bounded-edit-and-test/src/math.test.ts")
    || (normalizedCwd === "tool_eval/fixtures/bounded-edit-and-test" && normalizedArgs.includes("src/math.test.ts"))
}

export const gradeBoundedEditAndTestTranscript = (
  transcript: BoundedEditAndTestTranscript
): ReadonlyArray<EvalAssertion> => {
  const finalText = transcript.agent.finalText.trim()
  const mutationPaths = collectMutationPaths(transcript.agent)
  const bashCalls = transcript.agent.toolCalls.filter((toolCall) => toolCall.name === "bash")

  return [
    assertNonEmptyAnswer(finalText),
    assertToolCallWhere({
      transcript: transcript.agent,
      assertionName: "runs_targeted_bun_test",
      predicate: (toolCall) => toolCall.name === "bash" && isTargetedBunTestCall(toolCall.params),
      passDetail: "Observed a targeted bun test command for the fixture test file.",
      failDetail: "Did not observe a targeted bun test command for the fixture test file."
    }),
    makeAssertion(
      "uses_only_targeted_bash_calls",
      bashCalls.every((toolCall) => isTargetedBunTestCall(toolCall.params)),
      "All bash calls were limited to the targeted fixture test run.",
      `Observed unexpected bash call(s): ${bashCalls.map((toolCall) => JSON.stringify(toolCall.params)).join("; ") || "none"}.`
    ),
    makeAssertion(
      "file_tool_mutations_stay_on_target_file",
      mutationPaths.length === 1 && mutationPaths[0] === "tool_eval/fixtures/bounded-edit-and-test/src/math.ts",
      "All successful file-tool mutations stayed on the target file.",
      `Unexpected successful file-tool mutation paths: ${mutationPaths.join(", ") || "none"}.`
    ),
    makeAssertion(
      "edits_only_target_file",
      transcript.changedPaths.length === 1 && transcript.changedPaths[0] === "src/math.ts",
      "Only the target implementation file changed.",
      `Unexpected changed paths: ${transcript.changedPaths.join(", ") || "none"}.`
    ),
    makeAssertion(
      "fixes_subtract_implementation",
      transcript.targetFileContent.includes("return a - b"),
      "Target file contains the expected subtraction fix.",
      "Target file does not contain the expected subtraction fix."
    ),
    makeAssertion(
      "verification_passed",
      transcript.verificationPassed,
      "Independent verification of the targeted test passed.",
      `Independent verification failed:\n${transcript.verificationOutput}`
    )
  ]
}
