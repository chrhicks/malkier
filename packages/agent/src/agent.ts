import { Config, ConfigError, Context, Effect, Layer, Option, Redacted, Stream } from "effect";
import type { AgentEvent, AgentInput } from "./types";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { FetchHttpClient } from "@effect/platform";
import { AiError, LanguageModel } from "@effect/ai";

export class Agent extends Context.Tag("@malkier/agent/Agent")<Agent, Agent.Service>() { }

export declare namespace Agent {
  export interface Service {
    runStream: (input: AgentInput) => Stream.Stream<AgentEvent, never>
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

export const make = (options: Agent.Options): Effect.Effect<Agent.Service> =>
  Effect.succeed(
    Agent.of({
      runStream: (input) =>
        LanguageModel.streamText({
          prompt: input.message
        }).pipe(
          Stream.filterMap((part) =>
            part.type === "text-delta"
              ? Option.some({ type: "text-delta", delta: part.delta } as AgentEvent)
              : Option.none()
          ),
          Stream.concat(Stream.succeed({ type: "done" } as const)),
          Stream.catchAll((error) => Stream.succeed({ type: "error", message: String(error) } as const)),
          Stream.provideLayer(providerLayer(options))
        )
    })
  )

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
