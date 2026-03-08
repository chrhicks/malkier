import { describe, expect, test } from "bun:test"
import { Prompt, Response } from "@effect/ai"
import type { SessionMessage } from "../db/schema"
import { collectPrompt } from "./post-agent-stream"

const makeSessionMessage = (
  overrides: Partial<SessionMessage> & Pick<SessionMessage, "role" | "content" | "sequence">
): SessionMessage => ({
  id: overrides.id ?? `msg-${overrides.sequence}`,
  sessionId: overrides.sessionId ?? "session-1",
  role: overrides.role,
  content: overrides.content,
  status: overrides.status ?? "complete",
  sequence: overrides.sequence,
  tokenCount: overrides.tokenCount ?? null,
  metadata: overrides.metadata ?? null,
  createdAt: overrides.createdAt ?? new Date(0)
})

const normalizePrompt = (prompt: Prompt.Prompt) =>
  prompt.content.map((message) => ({
    role: message.role,
    content: typeof message.content === "string"
      ? message.content
      : message.content.map((part) => {
      switch (part.type) {
        case "text":
          return { type: part.type, text: part.text }
        case "tool-call":
          return {
            type: part.type,
            id: part.id,
            name: part.name,
            params: part.params,
            providerExecuted: part.providerExecuted
          }
        case "tool-result":
          return {
            type: part.type,
            id: part.id,
            name: part.name,
            result: part.result,
            isFailure: part.isFailure,
            providerExecuted: part.providerExecuted
          }
      }
      })
  }))

describe("collectPrompt", () => {
  test("rebuilds persisted tool-call history as structured prompt messages", () => {
    const messages: SessionMessage[] = [
      makeSessionMessage({
        role: "user",
        content: "What is the weather in Paris?",
        sequence: 1
      }),
      makeSessionMessage({
        role: "assistant",
        content: "Calling get_weather",
        sequence: 2,
        metadata: JSON.stringify({
          kind: "assistant-tool-call",
          id: "call-1",
          name: "get_weather",
          params: { city: "Paris" }
        })
      }),
      makeSessionMessage({
        role: "tool",
        content: '{"forecast":"sunny in Paris"}',
        sequence: 3,
        metadata: JSON.stringify({
          kind: "tool-result",
          id: "call-1",
          name: "get_weather",
          result: { forecast: "sunny in Paris" },
          isFailure: false
        })
      }),
      makeSessionMessage({
        role: "assistant",
        content: "Paris is sunny.",
        sequence: 4
      }),
      makeSessionMessage({
        role: "user",
        content: "Great, thanks.",
        sequence: 5
      })
    ]

    const actual = Prompt.make(collectPrompt(messages))

    const expected = Prompt.empty.pipe(
      Prompt.merge(
        Prompt.fromMessages([
          Prompt.makeMessage("user", {
            content: [Prompt.makePart("text", { text: "What is the weather in Paris?" })]
          })
        ])
      ),
      Prompt.merge(
        Prompt.fromResponseParts([
          Response.makePart("tool-call", {
            id: "call-1",
            name: "get_weather",
            params: { city: "Paris" },
            providerExecuted: false
          }),
          Response.makePart("tool-result", {
            id: "call-1",
            name: "get_weather",
            result: { forecast: "sunny in Paris" },
            encodedResult: { forecast: "sunny in Paris" },
            isFailure: false,
            providerExecuted: false
          }),
          Response.makePart("text", { text: "Paris is sunny." })
        ])
      ),
      Prompt.merge(
        Prompt.fromMessages([
          Prompt.makeMessage("user", {
            content: [Prompt.makePart("text", { text: "Great, thanks." })]
          })
        ])
      )
    )

    expect(normalizePrompt(actual)).toEqual(normalizePrompt(expected))
  })

  test("falls back to plain text messages when metadata is invalid", () => {
    const messages: SessionMessage[] = [
      makeSessionMessage({
        role: "assistant",
        content: "Calling get_weather",
        sequence: 1,
        metadata: "{not json}"
      }),
      makeSessionMessage({
        role: "tool",
        content: "tool output",
        sequence: 2
      })
    ]

    const actual = Prompt.make(collectPrompt(messages))

    expect(normalizePrompt(actual)).toEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "Calling get_weather" }]
      },
      {
        role: "tool",
        content: [{ type: "text", text: "tool output" }]
      }
    ])
  })
})
