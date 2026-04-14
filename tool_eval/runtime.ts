import { Prompt } from "@effect/ai"
import { Effect, Layer } from "effect"
import { Agent, layer } from "../packages/agent/src"
import { getMalkierConfig, toAgentOptions } from "../apps/api/src/config/malkier-config"
import type { SessionService } from "../apps/api/src/service/session.service"
import { malkierBaseSystemPrompt } from "../apps/api/src/agent/prompts/base-system-prompt"
import { buildPromptSource, resolveGitSha, type EvalRunMetadata } from "./core"

const malkierConfig = getMalkierConfig()

export const defaultEvalAgentModel = malkierConfig.agent.model.name
const defaultEvalDbPath = malkierConfig.evals.databasePath

export const basePromptFilePath = "apps/api/src/agent/prompts/malkier-base-system-prompt.md"

const agentLayer = layer(toAgentOptions(malkierConfig.agent))

const loadSessionServiceModule = Effect.tryPromise({
  try: async () => {
    Bun.env.MALKIER_DB_PATH ??= defaultEvalDbPath
    const { migrateDb } = await import("../apps/api/src/db/migrate")
    migrateDb()
    return import("../apps/api/src/service/session.service")
  },
  catch: (cause) => new Error(`Failed to load SessionService for eval runtime: ${String(cause)}`)
})

const loadEvalLayer = loadSessionServiceModule.pipe(
  Effect.map(({ SessionService }) => Layer.mergeAll(agentLayer, SessionService.Default))
)

export const createEvalPrompt = (userText: string) =>
  Prompt.empty.pipe(
    Prompt.merge(
      Prompt.fromMessages([
        Prompt.makeMessage("system", {
          content: malkierBaseSystemPrompt
        })
      ])
    ),
    Prompt.merge(
      Prompt.fromMessages([
        Prompt.makeMessage("user", {
          content: [Prompt.makePart("text", { text: userText })]
        })
      ])
    )
  )

export const createEvalContext = Effect.gen(function* () {
  const { SessionService } = yield* loadSessionServiceModule

  return {
    agent: yield* Agent,
    sessionService: yield* SessionService,
    userId: crypto.randomUUID(),
    model: malkierConfig.agent.model.name,
    gitSha: yield* resolveGitSha
  }
})

export const createEvalMetadata = ({
  prompt,
  model,
  gitSha,
  startedAt,
  finishedAt
}: {
  prompt: string,
  model: string,
  gitSha: string,
  startedAt: Date,
  finishedAt: Date
}): EvalRunMetadata => ({
  prompt,
  model,
  gitSha,
  promptSource: buildPromptSource({
    filePath: basePromptFilePath,
    promptText: malkierBaseSystemPrompt
  }),
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime()
})

type EvalCliResult<Artifact extends { readonly pass: boolean }> = {
  artifact: Artifact,
  latestPath: URL,
  timestampedPath: URL
}

export const runEvalCli = <Artifact extends { readonly pass: boolean }>({
  evalName,
  run
}: {
  evalName: string,
  run: Effect.Effect<EvalCliResult<Artifact>, unknown, Agent | SessionService>
}) => {
  const main = Effect.gen(function* () {
    const evalLayer = yield* loadEvalLayer
    const { artifact, latestPath, timestampedPath } = yield* run.pipe(Effect.provide(evalLayer))

    yield* Effect.sync(() => {
      console.log(JSON.stringify({
        eval: evalName,
        pass: artifact.pass,
        artifact,
        outputs: {
          latest: latestPath.pathname,
          timestamped: timestampedPath.pathname
        }
      }, null, 2))
    })

    if (!artifact.pass) {
      return yield* Effect.fail(new Error(`${evalName} failed`))
    }
  })

  Effect.runPromise(main).catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
