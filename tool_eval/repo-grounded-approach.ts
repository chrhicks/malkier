import { Effect } from "effect"
import { getAgentTools } from "../apps/api/src/agent/tools"
import { buildEvalArtifact, captureToolEventTranscript, writeEvalArtifact } from "./core"
import { createEvalContext, createEvalMetadata, createEvalPrompt, runEvalCli } from "./runtime"
import { gradeRepoGroundedApproachTranscript, RepoGroundedApproachTranscript } from "./repo-grounded-approach-lib"

const evalName = "repo_grounded_approach"
const targetPath = "apps/api/src/workspace-root.ts"
const expectedConsumers = [
  "apps/api/src/agent/prompt-assembler.ts",
  "apps/api/src/agent/tools/file-tools.ts",
  "apps/api/src/agent/tools/shell-tools.ts"
] as const
const evalPrompt = [
  `Take a moment to inspect the current repo and explain how you would evolve \`${targetPath}\` into a proper Workspace abstraction.`,
  "Ground the answer in the current implementation and its current consumers before proposing the refactor."
].join(" ")
const resultDirectory = new URL("./results/repo-grounded-approach/", import.meta.url)

const runRepoGroundedApproachEval = Effect.gen(function* () {
  const startedAt = new Date()
  const { agent, sessionService, userId, model, gitSha } = yield* createEvalContext
  const toolkit = yield* getAgentTools(userId, sessionService)

  const transcript = yield* captureToolEventTranscript(agent.runStream({
    prompt: createEvalPrompt(evalPrompt),
    toolkit
  }))

  const finishedAt = new Date()
  const assertions = gradeRepoGroundedApproachTranscript({
    transcript,
    targetPath,
    expectedConsumers
  })
  const artifact = yield* buildEvalArtifact({
    evalName,
    transcriptSchema: RepoGroundedApproachTranscript,
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
  run: runRepoGroundedApproachEval
})
