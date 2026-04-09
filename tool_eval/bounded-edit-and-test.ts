import { dirname, relative, resolve } from "node:path"
import { mkdir } from "node:fs/promises"
import { Effect } from "effect"
import { getAgentTools } from "../apps/api/src/agent/tools"
import { buildEvalArtifact, captureToolEventTranscript, writeEvalArtifact } from "./core"
import { createEvalContext, createEvalMetadata, createEvalPrompt, runEvalCli } from "./runtime"
import {
  BoundedEditAndTestTranscript,
  gradeBoundedEditAndTestTranscript
} from "./bounded-edit-and-test-lib"

const evalName = "bounded_edit_and_test"
const fixtureDirectoryPath = "tool_eval/fixtures/bounded-edit-and-test"
const targetFilePath = `${fixtureDirectoryPath}/src/math.ts`
const targetTestPath = `${fixtureDirectoryPath}/src/math.test.ts`
const resultDirectory = new URL("./results/bounded-edit-and-test/", import.meta.url)

const baselineFiles = {
  [targetFilePath]: `export const subtract = (a: number, b: number) => {\n  return a + b\n}\n`,
  [targetTestPath]: `import { describe, expect, test } from "bun:test"\nimport { subtract } from "./math"\n\ndescribe("subtract", () => {\n  test("subtracts positive numbers", () => {\n    expect(subtract(5, 2)).toBe(3)\n  })\n\n  test("subtracts into negatives", () => {\n    expect(subtract(-1, 2)).toBe(-3)\n  })\n})\n`
} as const

const evalPrompt = `Fix \`${targetFilePath}\` so \`${targetTestPath}\` passes. Keep the change minimal, do not edit the test file, and run only the targeted test file.`

const resetFixture = Effect.forEach(Object.entries(baselineFiles), ([filePath, content]) =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(resolve(process.cwd(), filePath)), { recursive: true })
      await Bun.write(filePath, content)
    },
    catch: (cause) => new Error(`Failed to reset fixture ${filePath}: ${String(cause)}`)
  })
)

const readFileText = (filePath: string) =>
  Effect.tryPromise({
    try: async () => Bun.file(filePath).text(),
    catch: (cause) => new Error(`Failed to read fixture file ${filePath}: ${String(cause)}`)
  })

const runVerification = Effect.try({
  try: () => {
    const child = Bun.spawnSync(["bun", "test", targetTestPath], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe"
    })

    const decoder = new TextDecoder()
    return {
      passed: child.exitCode === 0,
      output: `${decoder.decode(child.stdout)}${decoder.decode(child.stderr)}`.trim()
    }
  },
  catch: (cause) => new Error(`Failed to run bounded edit verification: ${String(cause)}`)
})

const runBoundedEditAndTestEval = Effect.gen(function* () {
  yield* resetFixture

  const startedAt = new Date()
  const { agent, sessionService, userId, model, gitSha } = yield* createEvalContext
  const toolkit = yield* getAgentTools(userId, sessionService)

  const agentTranscript = yield* captureToolEventTranscript(agent.runStream({
    prompt: createEvalPrompt(evalPrompt),
    toolkit
  }))

  const targetFileContent = yield* readFileText(targetFilePath)
  const changedPaths = (yield* Effect.forEach(Object.entries(baselineFiles), ([filePath, baselineContent]) =>
    readFileText(filePath).pipe(
      Effect.map((currentContent) => currentContent === baselineContent
        ? null
        : relative(resolve(process.cwd(), fixtureDirectoryPath), resolve(process.cwd(), filePath)).replaceAll("\\", "/"))
    )
  )).filter((value): value is string => value != null)
  const verification = yield* runVerification
  const finishedAt = new Date()

  const transcript = {
    agent: agentTranscript,
    changedPaths,
    targetFileContent,
    verificationPassed: verification.passed,
    verificationOutput: verification.output
  }
  const assertions = gradeBoundedEditAndTestTranscript(transcript)
  const artifact = yield* buildEvalArtifact({
    evalName,
    transcriptSchema: BoundedEditAndTestTranscript,
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
}).pipe(Effect.ensuring(resetFixture))

runEvalCli({
  evalName,
  run: runBoundedEditAndTestEval
})
