import { Effect } from "effect"
import { getAgentTools } from "../apps/api/src/agent/tools"
import { buildEvalArtifact, captureToolEventTranscript, writeEvalArtifact } from "./core"
import { createEvalContext, createEvalMetadata, createEvalPrompt, runEvalCli } from "./runtime"
import { gradeReviewKnownBugTranscript, ReviewKnownBugTranscript } from "./review-known-bug-lib"

const evalName = "review_known_bug"
const targetPath = "tool_eval/fixtures/review-known-bug/src/token.ts"
const evalPrompt = `Review \`${targetPath}\` for correctness or security issues. Focus on concrete bugs only, not style.`
const resultDirectory = new URL("./results/review-known-bug/", import.meta.url)

const runReviewKnownBugEval = Effect.gen(function* () {
  const startedAt = new Date()
  const { agent, sessionService, userId, model, gitSha } = yield* createEvalContext
  const toolkit = yield* getAgentTools(userId, sessionService)

  const transcript = yield* captureToolEventTranscript(agent.runStream({
    prompt: createEvalPrompt(evalPrompt),
    toolkit
  }))

  const finishedAt = new Date()
  const assertions = gradeReviewKnownBugTranscript({ transcript, targetPath })
  const artifact = yield* buildEvalArtifact({
    evalName,
    transcriptSchema: ReviewKnownBugTranscript,
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
  run: runReviewKnownBugEval
})
