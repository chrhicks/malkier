import { describe, expect, test } from "bun:test"
import { AiError, LanguageModel, Tool, Toolkit } from "@effect/ai"
import type * as Response from "@effect/ai/Response"
import { Chunk, Effect, Layer, Schema, Stream } from "effect"
import { makeWithLanguageModelLayer } from "./agent"
import type { AgentStreamError } from "./types"

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2
} as const

const makeTestAgent = (streamText: (options: LanguageModel.ProviderOptions) => Stream.Stream<Response.StreamPartEncoded, AiError.AiError>) =>
  Effect.runPromise(
    makeWithLanguageModelLayer(
      Layer.effect(
        LanguageModel.LanguageModel,
        LanguageModel.make({
          generateText: () =>
            Effect.fail(
              new AiError.UnknownError({
                module: "AgentTest",
                method: "generateText",
                description: "generateText is not used in these tests"
              })
            ),
          streamText
        })
      )
    )
  )

const collectEvents = (stream: Stream.Stream<unknown, AgentStreamError>) =>
  Effect.runPromise(
    Stream.runCollect(stream).pipe(
      Effect.map(Chunk.toReadonlyArray)
    )
  )

describe("Agent", () => {
  test("runStream emits done after a clean completion", async () => {
    const agent = await makeTestAgent(() =>
      Stream.fromIterable([
        { type: "text-delta", id: "text-1", delta: "hello" },
        { type: "finish", reason: "stop", usage }
      ])
    )

    const events = await collectEvents(
      agent.runStream({
        prompt: "hello"
      })
    )

    expect(events).toEqual([
      { type: "text-delta", delta: "hello" },
      { type: "done" }
    ])
  })

  test("runStream continues after tool calls and emits tool events in order", async () => {
    const GetWeather = Tool.make("get_weather", {
      parameters: { city: Schema.String },
      success: Schema.Struct({ forecast: Schema.String })
    })
    const WeatherToolkit = Toolkit.make(GetWeather)

    const handledCities: string[] = []
    const toolkit = await Effect.runPromise(
      WeatherToolkit.pipe(
        Effect.provide(
          WeatherToolkit.toLayer(
            WeatherToolkit.of({
              get_weather: ({ city }) => {
                handledCities.push(city)
                return Effect.succeed({ forecast: `sunny in ${city}` })
              }
            })
          )
        )
      )
    )

    let streamCallCount = 0
    const agent = await makeTestAgent(() => {
      streamCallCount += 1

      if (streamCallCount === 1) {
        return Stream.fromIterable([
          {
            type: "tool-call",
            id: "call-1",
            name: "get_weather",
            params: { city: "Paris" },
            providerExecuted: false
          },
          { type: "finish", reason: "tool-calls", usage }
        ])
      }

      return Stream.fromIterable([
        { type: "text-delta", id: "text-2", delta: "Paris is sunny." },
        { type: "finish", reason: "stop", usage }
      ])
    })

    const events = await collectEvents(
      agent.runStream({
        prompt: "What is the weather in Paris?",
        toolkit
      })
    )

    expect(streamCallCount).toBe(2)
    expect(handledCities).toEqual(["Paris"])
    expect(events).toEqual([
      {
        type: "tool-call",
        id: "call-1",
        name: "get_weather",
        params: { city: "Paris" }
      },
      {
        type: "tool-result",
        id: "call-1",
        name: "get_weather",
        result: { forecast: "sunny in Paris" },
        isFailure: false
      },
      { type: "text-delta", delta: "Paris is sunny." },
      { type: "done" }
    ])
  })

  test("runStream emits terminal error event on upstream failure", async () => {
    const agent = await makeTestAgent(() =>
      Stream.fail(
        new AiError.UnknownError({
          module: "AgentTest",
          method: "streamText",
          description: "boom"
        })
      )
    )

    const events = await collectEvents(
      agent.runStream({
        prompt: "hello"
      })
    )

    expect(events).toEqual([
      { type: "error", message: "UnknownError: AgentTest.streamText: boom" }
    ])
  })
})
