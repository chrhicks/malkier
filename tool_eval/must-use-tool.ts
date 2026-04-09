import { Effect } from "effect"
import type { SessionService } from "../apps/api/src/service/session.service"
import { getAgentTools } from "../apps/api/src/agent/tools"
import {
  buildEvalArtifact,
  captureToolEventTranscript,
  writeEvalArtifact
} from "./core"
import { gradeMustUseToolTranscript, MustUseToolTranscript } from "./must-use-tool-lib"
import { createEvalContext, createEvalMetadata, createEvalPrompt, runEvalCli } from "./runtime"

const evalName = "must_use_tool"
const evalPrompt = "List my recent chat sessions by title. Use the available session tools rather than guessing."
const resultDirectory = new URL("./results/must-use-tool/", import.meta.url)
const seededSessionTitles = [
  "alpha eval session",
  "beta eval session"
] as const

const seedSession = ({
  sessionService,
  userId,
  title
}: {
  sessionService: SessionService,
  userId: string,
  title: string
}) =>
  Effect.gen(function* () {
    const { sessionId } = yield* sessionService.ensureSession({ userId })

    yield* sessionService.insertSessionMessage({
      sessionId,
      message: title,
      nextSequence: 1,
      role: "user",
      status: "complete"
    })

    return sessionId
  })

const runMustUseToolEval = Effect.gen(function* () {
  const startedAt = new Date()
  const { agent, sessionService, userId, model, gitSha } = yield* createEvalContext

  yield* Effect.forEach(seededSessionTitles, (title) =>
    seedSession({
      sessionService,
      userId,
      title
    })
  )

  const toolkit = yield* getAgentTools(userId, sessionService)

  const transcript = yield* captureToolEventTranscript(agent.runStream({
    prompt: createEvalPrompt(evalPrompt),
    toolkit
  }))

  const finishedAt = new Date()
  const assertions = gradeMustUseToolTranscript({
    transcript,
    expectedTitles: seededSessionTitles
  })
  const artifact = yield* buildEvalArtifact({
    evalName,
    transcriptSchema: MustUseToolTranscript,
    metadata: createEvalMetadata({ prompt: evalPrompt, model, gitSha, startedAt, finishedAt }),
    transcript,
    assertions
  })

  const { latestPath, timestampedPath } = yield* writeEvalArtifact({
    directory: resultDirectory,
    artifact
  })

  return {
    artifact,
    latestPath,
    timestampedPath
  }
})

runEvalCli({
  evalName,
  run: runMustUseToolEval
})
