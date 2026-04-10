import { describe, expect, test } from "bun:test"
import { Prompt, Response } from "@effect/ai"
import { createHash } from "node:crypto"
import {
  assemblePrompt,
  collectPrompt,
  loadRootAgentsPromptLayer,
  rootAgentsPromptSource,
  softStopPromptSource
} from "../agent/prompt-assembler"
import { malkierBaseSystemPrompt, malkierBaseSystemPromptSource } from "../agent/prompts/base-system-prompt"
import { reviewModePrompt, reviewModePromptSource } from "../agent/prompts/review-mode-prompt"
import type { SessionMessageWithMetadata } from "../service/session.service"

const makeSessionMessage = (
  overrides: Partial<SessionMessageWithMetadata> & Pick<SessionMessageWithMetadata, "role" | "content" | "sequence">
): SessionMessageWithMetadata => ({
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
    const messages: SessionMessageWithMetadata[] = [
      makeSessionMessage({
        role: "user",
        content: "What is the weather in Paris?",
        sequence: 1
      }),
      makeSessionMessage({
        role: "assistant",
        content: "Calling get_weather",
        sequence: 2,
        metadata: {
          kind: "tool-call",
          id: "call-1",
          name: "get_weather",
          params: { city: "Paris" }
        }
      }),
      makeSessionMessage({
        role: "tool",
        content: '{"forecast":"sunny in Paris"}',
        sequence: 3,
        metadata: {
          kind: "tool-result",
          id: "call-1",
          name: "get_weather",
          result: { forecast: "sunny in Paris" },
          isFailure: false
        }
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

  test("keeps messages without metadata as plain text", () => {
    const messages: SessionMessageWithMetadata[] = [
      makeSessionMessage({
        role: "assistant",
        content: "Calling get_weather",
        sequence: 1,
        metadata: null
      }),
      makeSessionMessage({
        role: "tool",
        content: "tool output",
        sequence: 2,
        metadata: null
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

  test("keeps partial assistant output metadata as plain assistant text", () => {
    const messages: SessionMessageWithMetadata[] = [
      makeSessionMessage({
        role: "assistant",
        content: "Here is the partial summary so far.",
        sequence: 1,
        metadata: {
          kind: "assistant-output",
          state: "partial",
          reason: "client-cancel"
        }
      }),
      makeSessionMessage({
        role: "assistant",
        content: "Stream cancelled by client",
        sequence: 2,
        status: "error",
        metadata: {
          kind: "stream-error",
          reason: "client-cancel"
        }
      })
    ]

    const actual = Prompt.make(collectPrompt(messages))

    expect(normalizePrompt(actual)).toEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "Here is the partial summary so far." }]
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Stream cancelled by client" }]
      }
    ])
  })

  test("assemblePrompt prepends the base system prompt and returns layer metadata", () => {
    const rootAgentsLayer = loadRootAgentsPromptLayer()

    expect(rootAgentsLayer).not.toBeNull()

    const assembled = assemblePrompt({
      messages: [
        makeSessionMessage({
          role: "user",
          content: "Please use your tools.",
          sequence: 1
        })
      ]
    })
    const actual = Prompt.make(assembled.prompt)

    const normalized = normalizePrompt(actual)

    expect(assembled.resolvedMode).toBe("default")
    expect(assembled.selectedSkills).toEqual([])
    expect(assembled.layers).toEqual([
      {
        id: `base:${createHash("sha256").update(malkierBaseSystemPrompt).digest("hex").slice(0, 12)}`,
        kind: "base",
        role: "system",
        source: malkierBaseSystemPromptSource,
        content: malkierBaseSystemPrompt,
        sha256: createHash("sha256").update(malkierBaseSystemPrompt).digest("hex")
      },
      rootAgentsLayer!
    ])
    expect(normalized[0]).toEqual({
      role: "system",
      content: malkierBaseSystemPrompt
    })
    expect(normalized[1]).toEqual({
      role: "system",
      content: rootAgentsLayer!.content
    })
    expect(normalized[2]).toEqual({
      role: "user",
      content: [{ type: "text", text: "Please use your tools." }]
    })
  })

  test("assemblePrompt skips the repo layer cleanly when the root AGENTS.md file is missing", () => {
    const assembled = assemblePrompt({
      messages: [
        makeSessionMessage({
          role: "user",
          content: "Please use your tools.",
          sequence: 1
        })
      ]
    }, {
      rootAgentsLayer: loadRootAgentsPromptLayer(`/tmp/missing-agents-${crypto.randomUUID()}.md`)
    })

    expect(assembled.layers.map((layer) => layer.kind)).toEqual(["base"])
    expect(normalizePrompt(Prompt.make(assembled.prompt))[1]).toEqual({
      role: "user",
      content: [{ type: "text", text: "Please use your tools." }]
    })
  })

  test("assemblePrompt infers review mode from the latest user review request", () => {
    const rootAgentsLayer = loadRootAgentsPromptLayer()

    expect(rootAgentsLayer).not.toBeNull()

    const assembled = assemblePrompt({
      messages: [
        makeSessionMessage({
          role: "user",
          content: "Please review this patch for regressions.",
          sequence: 1
        })
      ]
    })
    const normalized = normalizePrompt(Prompt.make(assembled.prompt))
    const reviewLayer = assembled.layers[2]!

    expect(assembled.resolvedMode).toBe("review")
    expect(assembled.layers.map((layer) => layer.kind)).toEqual(["base", "repo", "mode"])
    expect(reviewLayer.source).toBe(reviewModePromptSource)
    expect(reviewLayer.content).toBe(reviewModePrompt)
    expect(normalized[2]).toEqual({
      role: "system",
      content: reviewModePrompt
    })
    expect(normalized[3]).toEqual({
      role: "user",
      content: [{ type: "text", text: "Please review this patch for regressions." }]
    })
  })

  test("explicit default mode overrides review inference", () => {
    const assembled = assemblePrompt({
      messages: [
        makeSessionMessage({
          role: "user",
          content: "Please review this patch for regressions.",
          sequence: 1
        })
      ],
      explicitMode: "default"
    }, {
      rootAgentsLayer: null
    })

    expect(assembled.resolvedMode).toBe("default")
    expect(assembled.layers.map((layer) => layer.kind)).toEqual(["base"])
  })

  test("assemblePrompt appends the soft-stop layer before conversation history when requested", () => {
    const rootAgentsLayer = loadRootAgentsPromptLayer()

    expect(rootAgentsLayer).not.toBeNull()

    const assembled = assemblePrompt({
      messages: [
        makeSessionMessage({
          role: "user",
          content: "Wrap up now.",
          sequence: 1
        })
      ],
      explicitMode: "review",
      selectedSkills: ["coding-standards"],
      nearSoftStop: true
    })
    const normalized = normalizePrompt(Prompt.make(assembled.prompt))
    const reviewLayer = assembled.layers[2]!
    const softStopLayer = assembled.layers[3]!

    expect(assembled.resolvedMode).toBe("review")
    expect(assembled.selectedSkills).toEqual(["coding-standards"])
    expect(assembled.layers.map((layer) => layer.kind)).toEqual(["base", "repo", "mode", "soft-stop"])
    expect(assembled.layers[1]).toEqual(rootAgentsLayer!)
    expect(assembled.layers[1]?.source).toBe(rootAgentsPromptSource)
    expect(reviewLayer.source).toBe(reviewModePromptSource)
    expect(softStopLayer.source).toBe(softStopPromptSource)
    expect(softStopLayer.sha256).toBe(
      createHash("sha256")
        .update(softStopLayer.content)
        .digest("hex")
    )

    expect(normalized[0]).toEqual({
      role: "system",
      content: malkierBaseSystemPrompt
    })
    expect(normalized[1]).toEqual({
      role: "system",
      content: rootAgentsLayer!.content
    })
    expect(normalized[2]).toEqual({
      role: "system",
      content: reviewModePrompt
    })
    expect(normalized[3]).toEqual({
      role: "system",
      content: softStopLayer.content
    })
    expect(normalized[4]).toEqual({
      role: "user",
      content: [{ type: "text", text: "Wrap up now." }]
    })
  })

})
