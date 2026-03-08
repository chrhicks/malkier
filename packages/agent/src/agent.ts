import { Config, ConfigError, Context, Effect, Layer, Mailbox, Option, Redacted, Stream } from "effect";
import type { AgentEvent, AgentInput } from "./types";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { FetchHttpClient } from "@effect/platform";
import { AiError, LanguageModel, Prompt } from "@effect/ai";
import type * as Tool from '@effect/ai/Tool'
import type * as Response from "@effect/ai/Response";

export class Agent extends Context.Tag("@malkier/agent/Agent")<Agent, Agent.Service>() { }

export declare namespace Agent {
  export interface Service {
    runStream: <Tools extends Record<string, Tool.Any> = {}>(
      input: AgentInput<Tools>
    ) => Stream.Stream<AgentEvent, never>
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
  mailbox: Mailbox.Mailbox<AgentEvent>,
  input: AgentInput<Tools>,
  prompt: Prompt.Prompt
): Effect.Effect<Option.Option<Prompt.Prompt>, AiError.AiError, LanguageModel.LanguageModel> =>
  Effect.gen(function* () {
    const parts: Array<Response.StreamPart<Tools>> = []

    yield* LanguageModel.streamText({
      prompt,
      toolkit: input.toolkit
    }).pipe(
      Stream.runForEach((part) =>
        Effect.gen(function* () {
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

    if (finishReason === 'tool-calls') {
      return Option.some(
        Prompt.merge(prompt, Prompt.fromResponseParts(parts))
      )
    }

    return Option.none()
  })

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
            const mailbox = yield* Mailbox.make<AgentEvent>()

            const producer = Effect.gen(function* () {
              let prompt = Prompt.make(input.prompt)

              while (true) {
                const nextPrompt = yield* runTurn(mailbox, input, prompt)

                if (Option.isNone(nextPrompt)) {
                  yield* mailbox.offer({ type: 'done' })
                  yield* mailbox.end
                  return
                }

                prompt = nextPrompt.value
              }
            }).pipe(
              Effect.catchAll((error) =>
                mailbox.offer({ type: 'error', message: String(error) }).pipe(
                  Effect.zipRight(mailbox.end),
                  Effect.asVoid
                )
              ),
              Effect.provide(languageModelLayer)
            )

            yield* Effect.forkScoped(producer)

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
