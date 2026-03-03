import { describe, expect, test } from "bun:test"
import { Chunk, Effect, Option, Redacted, Stream } from "effect"
import { make } from "./agent"

describe("Agent", () => {
  test("runStream emits terminal error event on upstream failure", async () => {
    const agent = await Effect.runPromise(
      make({
        model: "gpt-5.3-codex",
        apiUrl: "http://127.0.0.1:1",
        apiKey: Redacted.make("test-key")
      })
    )

    const events = await Effect.runPromise(
      Stream.runCollect(
        agent.runStream({
          message: "hello"
        })
      )
    )

    const terminalEvent = Chunk.last(events)
    expect(Option.isSome(terminalEvent)).toBe(true)

    if (Option.isSome(terminalEvent)) {
      expect(terminalEvent.value.type).toBe("error")
    }
  })
})
