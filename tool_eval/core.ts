import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import type { AgentEvent } from "../packages/agent/src"
import { Effect, Schema, Stream } from "effect"

export const EvalAssertion = Schema.Struct({
  name: Schema.String,
  pass: Schema.Boolean,
  detail: Schema.String
})

export type EvalAssertion = Schema.Schema.Type<typeof EvalAssertion>

export const CapturedToolCall = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  params: Schema.Unknown
})

export type CapturedToolCall = Schema.Schema.Type<typeof CapturedToolCall>

export const CapturedToolResult = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  result: Schema.Unknown,
  isFailure: Schema.Boolean
})

export type CapturedToolResult = Schema.Schema.Type<typeof CapturedToolResult>

export const ToolEventTranscript = Schema.Struct({
  finalText: Schema.String,
  toolCalls: Schema.Array(CapturedToolCall),
  toolResults: Schema.Array(CapturedToolResult)
})

export type ToolEventTranscript = Schema.Schema.Type<typeof ToolEventTranscript>

export const EvalPromptSource = Schema.Struct({
  filePath: Schema.String,
  sha256: Schema.String
})

export type EvalPromptSource = Schema.Schema.Type<typeof EvalPromptSource>

export const EvalRunMetadata = Schema.Struct({
  prompt: Schema.String,
  model: Schema.String,
  gitSha: Schema.String,
  promptSource: EvalPromptSource,
  startedAt: Schema.String,
  finishedAt: Schema.String,
  durationMs: Schema.Number
})

export type EvalRunMetadata = Schema.Schema.Type<typeof EvalRunMetadata>

export const makeEvalArtifactSchema = <A, I, R>(transcriptSchema: Schema.Schema<A, I, R>) =>
  Schema.Struct({
    evalName: Schema.String,
    pass: Schema.Boolean,
    metadata: EvalRunMetadata,
    transcript: transcriptSchema,
    assertions: Schema.Array(EvalAssertion)
  })

export const makeAssertion = (
  name: string,
  pass: boolean,
  passDetail: string,
  failDetail: string
): EvalAssertion => ({
  name,
  pass,
  detail: pass ? passDetail : failDetail
})

export const buildPromptSource = ({
  filePath,
  promptText
}: {
  filePath: string,
  promptText: string
}): EvalPromptSource => ({
  filePath,
  sha256: createHash("sha256").update(promptText).digest("hex")
})

export const captureToolEventTranscript = <E>(events: Stream.Stream<AgentEvent, E>) =>
  events.pipe(
    Stream.runFold(
      {
        finalText: "",
        toolCalls: [] as Array<CapturedToolCall>,
        toolResults: [] as Array<CapturedToolResult>
      },
      (state, event) => {
        switch (event.type) {
          case "text-delta":
            return {
              ...state,
              finalText: state.finalText + event.delta
            }
          case "tool-call":
            return {
              ...state,
              toolCalls: [...state.toolCalls, { id: event.id, name: event.name, params: event.params }]
            }
          case "tool-result":
            return {
              ...state,
              toolResults: [...state.toolResults, { id: event.id, name: event.name, result: event.result, isFailure: event.isFailure }]
            }
          default:
            return state
        }
      }
    )
  )

export const assertNoToolActivity = (transcript: ToolEventTranscript): EvalAssertion =>
  makeAssertion(
    "does_not_call_tools",
    transcript.toolCalls.length === 0 && transcript.toolResults.length === 0,
    "No tool calls or tool results were emitted.",
    `Observed ${transcript.toolCalls.length} tool call(s) and ${transcript.toolResults.length} tool result(s).`
  )

export const assertCalledTool = ({
  transcript,
  toolName,
  assertionName = `calls_${toolName}`
}: {
  transcript: ToolEventTranscript,
  toolName: string,
  assertionName?: string
}): EvalAssertion =>
  makeAssertion(
    assertionName,
    transcript.toolCalls.some((toolCall) => toolCall.name === toolName),
    `Observed required tool call: ${toolName}.`,
    `Did not observe required tool call: ${toolName}. Observed tools: ${transcript.toolCalls.map((toolCall) => toolCall.name).join(", ") || "none"}.`
  )

export const assertToolCallWhere = ({
  transcript,
  assertionName,
  predicate,
  passDetail,
  failDetail
}: {
  transcript: ToolEventTranscript,
  assertionName: string,
  predicate: (toolCall: CapturedToolCall) => boolean,
  passDetail: string,
  failDetail: string
}): EvalAssertion =>
  makeAssertion(
    assertionName,
    transcript.toolCalls.some(predicate),
    passDetail,
    failDetail
  )

export const assertNonEmptyAnswer = (text: string): EvalAssertion =>
  makeAssertion(
    "returns_non_empty_answer",
    text.trim().length > 0,
    `Returned ${text.trim().length} characters of text.`,
    "Returned no assistant text."
  )

export const assertMentionsAll = ({
  text,
  values,
  assertionName,
  subject
}: {
  text: string,
  values: ReadonlyArray<string>,
  assertionName: string,
  subject: string
}): EvalAssertion => {
  const missing = values.filter((value) => !text.toLowerCase().includes(value.toLowerCase()))

  return makeAssertion(
    assertionName,
    missing.length === 0,
    `Answer mentions all expected ${subject}.`,
    `Answer is missing expected ${subject}: ${missing.join(", ")}.`
  )
}

export const assertTextMatches = ({
  text,
  assertionName,
  pattern,
  passDetail,
  failDetail
}: {
  text: string,
  assertionName: string,
  pattern: RegExp,
  passDetail: string,
  failDetail: string
}): EvalAssertion =>
  makeAssertion(
    assertionName,
    pattern.test(text),
    passDetail,
    failDetail
  )

export const assertTextDoesNotMatch = ({
  text,
  assertionName,
  pattern,
  passDetail,
  failDetail
}: {
  text: string,
  assertionName: string,
  pattern: RegExp,
  passDetail: string,
  failDetail: string
}): EvalAssertion =>
  makeAssertion(
    assertionName,
    !pattern.test(text),
    passDetail,
    failDetail
  )

export const resolveGitSha = Effect.try({
  try: () => {
    const child = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe"
    })

    if (child.exitCode !== 0) {
      const stderr = new TextDecoder().decode(child.stderr).trim()
      throw new Error(stderr || "git rev-parse HEAD failed")
    }

    return new TextDecoder().decode(child.stdout).trim()
  },
  catch: (cause) => new Error(`Failed to resolve git SHA for eval run: ${String(cause)}`)
})

export const buildEvalArtifact = <A, I, R>({
  evalName,
  transcriptSchema,
  metadata,
  transcript,
  assertions
}: {
  evalName: string,
  transcriptSchema: Schema.Schema<A, I, R>,
  metadata: EvalRunMetadata,
  transcript: A,
  assertions: ReadonlyArray<EvalAssertion>
}) =>
  Schema.decodeUnknown(makeEvalArtifactSchema(transcriptSchema))({
    evalName,
    pass: assertions.every((assertion) => assertion.pass),
    metadata,
    transcript,
    assertions
  })

export const writeEvalArtifact = <Artifact extends { readonly metadata: { readonly finishedAt: string } }>({
  directory,
  artifact
}: {
  directory: URL,
  artifact: Artifact
}) =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => mkdir(directory, { recursive: true }),
      catch: (cause) => new Error(`Failed to create eval results directory: ${String(cause)}`)
    })

    const timestamp = artifact.metadata.finishedAt.replaceAll(":", "-")
    const latestPath = new URL("latest.json", directory)
    const timestampedPath = new URL(`${timestamp}.json`, directory)
    const artifactJson = JSON.stringify(artifact, null, 2)

    yield* Effect.tryPromise({
      try: () => Promise.all([Bun.write(latestPath, artifactJson), Bun.write(timestampedPath, artifactJson)]),
      catch: (cause) => new Error(`Failed to write eval artifact: ${String(cause)}`)
    })

    return {
      latestPath,
      timestampedPath
    }
  })
