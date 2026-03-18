import { Config, ConfigError, Context, Effect, Layer, Mailbox, Option, Redacted, Stream } from "effect";
import type { AgentEvent, AgentInput, AgentStreamError } from "./types";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { FetchHttpClient } from "@effect/platform";
import { AiError, LanguageModel, Prompt } from "@effect/ai";
import type * as Tool from '@effect/ai/Tool'
import type * as Response from "@effect/ai/Response";
import { AgentMaxTurnsExceededError, StreamTimeoutError, TurnTimeoutError } from "./errors";

const maxTurns = 5

export class Agent extends Context.Tag("@malkier/agent/Agent")<Agent, Agent.Service>() { }

export declare namespace Agent {
  export interface Service {
    runStream: <Tools extends Record<string, Tool.Any> = {}>(
      input: AgentInput<Tools>
    ) => Stream.Stream<AgentEvent, AgentStreamError>
  }

  export interface Options {
    readonly model: string
    readonly apiUrl: string
    readonly apiKey: Redacted.Redacted
  }

  export interface ConfigOptions {
    readonly model: Config.Config<string>
    readonly apiUrl: Config.Config<string>
    readonly apiKey: Config.Config<Redacted.Redacted>
  }
}

const providerLayer = (options: Agent.Options) =>
  Layer.provide(
    OpenAiLanguageModel.layer({ model: options.model }),
    Layer.provide(
      OpenAiClient.layer({
        apiKey: options.apiKey,
        apiUrl: options.apiUrl
      }),
      FetchHttpClient.layer
    )
  )

const toEvent = <Tools extends Record<string, Tool.Any>>(
  part: Response.StreamPart<Tools>
): Option.Option<AgentEvent> => {
  switch (part.type) {
    case 'text-delta':
      return Option.some({
        type: 'text-delta',
        delta: part.delta
      })

    case 'tool-call':
      return Option.some({
        type: 'tool-call',
        id: part.id,
        name: part.name,
        params: part.params
      })

    case 'tool-result':
      return Option.some({
        id: part.id,
        type: 'tool-result',
        result: part.result,
        name: part.name,
        isFailure: part.isFailure
      })

    default:
      return Option.none()
  }
}

const runTurn = <Tools extends Record<string, Tool.Any>>(
  mailbox: Mailbox.Mailbox<AgentEvent, AgentStreamError>,
  input: AgentInput<Tools>,
  prompt: Prompt.Prompt,
  turn: number
): Effect.Effect<Option.Option<Prompt.Prompt>, AgentStreamError, LanguageModel.LanguageModel> =>
  Effect.gen(function* () {
    const startedAt = Date.now()
    let sawFirstPart = false
    const parts: Array<Response.StreamPart<Tools>> = []

    yield* Effect.annotateCurrentSpan('turn', turn)

    yield* LanguageModel.streamText({
      prompt,
      toolkit: input.toolkit
    }).pipe(
      Stream.timeoutFail(() => new StreamTimeoutError({ message: `Turn ${turn} produced no chunks in time` }), '20 seconds'),
      Stream.runForEach((part) =>
        Effect.gen(function* () {
          if (!sawFirstPart) {
            sawFirstPart = true
            yield* Effect.logInfo("agent first stream part", {
              turn,
              latencyMs: Date.now() - startedAt,
              type: part.type
            })
          }

          parts.push(part)

          const event = toEvent(part)
          if (Option.isSome(event)) {
            yield* mailbox.offer(event.value)
          }
        })
      )
    )

    const finishPart = parts.find((p): p is Response.FinishPart => p.type === 'finish')
    const finishReason: Response.FinishReason = finishPart?.reason ?? 'unknown'

    yield* Effect.annotateCurrentSpan("finishReason", finishReason)

    if (finishReason === 'tool-calls') {
      return Option.some(
        Prompt.merge(prompt, Prompt.fromResponseParts(parts))
      )
    }

    return Option.none()
  }).pipe(
    Effect.withSpan('agent.run-turn'),
    Effect.timeoutFail({
      duration: '60 seconds',
      onTimeout: () => new TurnTimeoutError({ message: `Turn ${turn} timed out` })
    })
  )

export const makeWithLanguageModelLayer = (
  languageModelLayer: Layer.Layer<LanguageModel.LanguageModel>
): Effect.Effect<Agent.Service> =>
  Effect.succeed(
    Agent.of({
      runStream: <Tools extends Record<string, Tool.Any> = {}>(
        input: AgentInput<Tools>
      ) =>
        Stream.unwrapScoped(
          Effect.gen(function* () {
            const mailbox = yield* Mailbox.make<AgentEvent, AgentStreamError>()

            const producer = Effect.gen(function* () {
              let prompt = Prompt.make(input.prompt)
              let turn = 0
              while (true) {
                if (turn > 5) {
                  yield* Effect.fail(
                    new AgentMaxTurnsExceededError({
                      maxTurns,
                      message: `Agent exceeded maximum turns (${maxTurns})`
                    })
                  )
                }

                const nextPrompt = yield* runTurn(mailbox, input, prompt, ++turn)

                if (Option.isNone(nextPrompt)) {
                  yield* mailbox.offer({ type: 'done' })
                  yield* mailbox.end
                  return
                }

                prompt = nextPrompt.value
              }
            })

            yield* Effect.forkScoped(
              producer.pipe(
                // Capture and log the producer Exit explicitly before forwarding it to the mailbox.
                // This makes failures/defects inside the forked producer visible during debugging
                // instead of only surfacing later as stream-level timeouts or generic transport errors.
                Effect.provide(languageModelLayer),
                Effect.exit,
                Effect.tap((exit) =>
                  Effect.logError('agent producer exit', exit)
                ),
                Effect.flatMap((exit) => mailbox.done(exit))
              )
            )

            return Mailbox.toStream(mailbox)
          })
        )
    })
  )

export const make = (options: Agent.Options): Effect.Effect<Agent.Service> =>
  makeWithLanguageModelLayer(providerLayer(options))

export const layer = (options: Agent.Options): Layer.Layer<Agent> =>
  Layer.effect(Agent, make(options))

export const layerConfig = (options: Agent.ConfigOptions): Layer.Layer<Agent, ConfigError.ConfigError> =>
  Layer.effect(
    Agent,
    Config.all({
      model: options.model,
      apiUrl: options.apiUrl,
      apiKey: options.apiKey
    }).pipe(
      Effect.flatMap(make)
    )
  )
