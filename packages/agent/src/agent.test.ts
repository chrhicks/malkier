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

  test("runStream allows more than five tool turns before completing", async () => {
    const CountTool = Tool.make("count_turn", {
      parameters: { turn: Schema.Number },
      success: Schema.Struct({ acknowledged: Schema.Boolean })
    })
    const CountToolkit = Toolkit.make(CountTool)

    const handledTurns: number[] = []
    const toolkit = await Effect.runPromise(
      CountToolkit.pipe(
        Effect.provide(
          CountToolkit.toLayer(
            CountToolkit.of({
              count_turn: ({ turn }) => {
                handledTurns.push(turn)
                return Effect.succeed({ acknowledged: true })
              }
            })
          )
        )
      )
    )

    let streamCallCount = 0
    const agent = await makeTestAgent(() => {
      streamCallCount += 1

      if (streamCallCount <= 6) {
        return Stream.fromIterable([
          {
            type: "tool-call",
            id: `count-${streamCallCount}`,
            name: "count_turn",
            params: { turn: streamCallCount },
            providerExecuted: false
          },
          { type: "finish", reason: "tool-calls", usage }
        ])
      }

      return Stream.fromIterable([
        { type: "text-delta", id: "text-final", delta: "done" },
        { type: "finish", reason: "stop", usage }
      ])
    })

    const events = await collectEvents(
      agent.runStream({
        prompt: "Count through several tool turns",
        toolkit
      })
    )

    expect(streamCallCount).toBe(7)
    expect(handledTurns).toEqual([1, 2, 3, 4, 5, 6])
    expect(events.at(-2)).toEqual({ type: "text-delta", delta: "done" })
    expect(events.at(-1)).toEqual({ type: "done" })
  })

  test("runStream uses a final no-tool summary round after the soft model-round cap", async () => {
    const CountTool = Tool.make("count_turn", {
      parameters: { turn: Schema.Number },
      success: Schema.Struct({ acknowledged: Schema.Boolean })
    })
    const CountToolkit = Toolkit.make(CountTool)

    const handledTurns: number[] = []
    const toolkit = await Effect.runPromise(
      CountToolkit.pipe(
        Effect.provide(
          CountToolkit.toLayer(
            CountToolkit.of({
              count_turn: ({ turn }) => {
                handledTurns.push(turn)
                return Effect.succeed({ acknowledged: true })
              }
            })
          )
        )
      )
    )

    let streamCallCount = 0
    let sawNoToolkitSummaryRound = false
    const agent = await makeTestAgent((options) => {
      const providerOptions = options as LanguageModel.ProviderOptions & {
        readonly tools?: unknown
        readonly toolChoice?: string
      }
      streamCallCount += 1

      if (providerOptions.toolChoice === "none") {
        sawNoToolkitSummaryRound = true

        return Stream.fromIterable([
          { type: "text-delta", id: "summary", delta: "Here is the best summary with the gathered context." },
          { type: "finish", reason: "stop", usage }
        ])
      }

      return Stream.fromIterable([
        {
          type: "tool-call",
          id: `count-${streamCallCount}`,
          name: "count_turn",
          params: { turn: streamCallCount },
          providerExecuted: false
        },
        { type: "finish", reason: "tool-calls", usage }
      ])
    })

    const events = await collectEvents(
      agent.runStream({
        prompt: "Keep working until you need to wrap up.",
        toolkit
      })
    )

    expect(sawNoToolkitSummaryRound).toBe(true)
    expect(handledTurns.length).toBeGreaterThan(20)
    expect(events.at(-2)).toEqual({
      type: "text-delta",
      delta: "Here is the best summary with the gathered context."
    })
    expect(events.at(-1)).toEqual({ type: "done" })
  })

  test("runStream still hard-fails when the model keeps looping past the soft stop", async () => {
    const CountTool = Tool.make("count_turn", {
      parameters: { turn: Schema.Number },
      success: Schema.Struct({ acknowledged: Schema.Boolean })
    })
    const CountToolkit = Toolkit.make(CountTool)

    const toolkit = await Effect.runPromise(
      CountToolkit.pipe(
        Effect.provide(
          CountToolkit.toLayer(
            CountToolkit.of({
              count_turn: () => Effect.succeed({ acknowledged: true })
            })
          )
        )
      )
    )

    let sawNoToolkitRound = false
    const agent = await makeTestAgent((options) => {
      const providerOptions = options as LanguageModel.ProviderOptions & {
        readonly tools?: unknown
        readonly toolChoice?: string
      }

      if (providerOptions.toolChoice === "none") {
        sawNoToolkitRound = true

        return Stream.fromIterable([
          { type: "text-delta", id: "still-thinking", delta: "I need one more pass." },
          { type: "finish", reason: "tool-calls", usage }
        ])
      }

      return Stream.fromIterable([
        {
          type: "tool-call",
          id: crypto.randomUUID(),
          name: "count_turn",
          params: { turn: 1 },
          providerExecuted: false
        },
        { type: "finish", reason: "tool-calls", usage }
      ])
    })

    await expect(
      collectEvents(
        agent.runStream({
          prompt: "Keep looping forever.",
          toolkit
        })
      )
    ).rejects.toThrow("Agent exceeded maximum model rounds (30)")

    expect(sawNoToolkitRound).toBe(true)
  })

  test("runStream fails the stream on upstream failure", async () => {
    const agent = await makeTestAgent(() =>
      Stream.fail(
        new AiError.UnknownError({
          module: "AgentTest",
          method: "streamText",
          description: "boom"
        })
      )
    )

    await expect(
      collectEvents(
        agent.runStream({
          prompt: "hello"
        })
      )
    ).rejects.toThrow("AgentTest.streamText: boom")
  })
})
