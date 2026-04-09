import { Effect } from "effect"
import { getAgentTools } from "../apps/api/src/agent/tools"
import {
  buildEvalArtifact,
  captureToolEventTranscript,
  writeEvalArtifact
} from "./core"
import { gradeHelloNoToolTranscript, HelloNoToolTranscript } from "./hello-no-tool-lib"
import { createEvalContext, createEvalMetadata, createEvalPrompt, runEvalCli } from "./runtime"

const evalName = "hello_no_tool"
const evalPrompt = "Tell me about yourself"
const resultDirectory = new URL("./results/hello-no-tool/", import.meta.url)

const runHelloNoToolEval = Effect.gen(function* () {
  const startedAt = new Date()
  const { agent, sessionService, userId, model, gitSha } = yield* createEvalContext
  const toolkit = yield* getAgentTools(userId, sessionService)

  const transcript = yield* captureToolEventTranscript(agent.runStream({
    prompt: createEvalPrompt(evalPrompt),
    toolkit
  }))

  const finishedAt = new Date()
  const assertions = gradeHelloNoToolTranscript(transcript)
  const artifact = yield* buildEvalArtifact({
    evalName,
    transcriptSchema: HelloNoToolTranscript,
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
  run: runHelloNoToolEval
})
