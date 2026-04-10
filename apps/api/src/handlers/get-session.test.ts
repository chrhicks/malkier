import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Session } from "../db/schema"
import type { PromptRunMetadata } from "../agent/prompt-run-metadata"
import { getSession } from "./get-session"
import type { SessionMessageWithMetadata, SessionService } from "../service/session.service"
import { SessionService as SessionServiceTag } from "../service/session.service"

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: overrides.id ?? "11111111-1111-4111-8111-111111111111",
  userId: overrides.userId ?? "22222222-2222-4222-8222-222222222222",
  title: overrides.title ?? null,
  status: overrides.status ?? "active",
  createdAt: overrides.createdAt ?? new Date("2026-03-09T00:00:00.000Z"),
  updatedAt: overrides.updatedAt ?? new Date("2026-03-09T00:00:00.000Z")
})

const makeSessionMessage = (overrides: Partial<SessionMessageWithMetadata> = {}): SessionMessageWithMetadata => ({
  id: overrides.id ?? "message-1",
  sessionId: overrides.sessionId ?? "11111111-1111-4111-8111-111111111111",
  role: overrides.role ?? "user",
  content: overrides.content ?? "Hello",
  status: overrides.status ?? "complete",
  sequence: overrides.sequence ?? 1,
  tokenCount: overrides.tokenCount ?? null,
  metadata: overrides.metadata ?? null,
  createdAt: overrides.createdAt ?? new Date("2026-03-09T00:00:00.000Z")
})

const makeSessionService = (latestRun: PromptRunMetadata | null): SessionService =>
  ({
    getSession: () =>
      Effect.succeed({
        session: makeSession(),
        messages: [makeSessionMessage()],
        latestRun
      })
  }) as unknown as SessionService

describe("getSession", () => {
  test("returns latest prompt run metadata in the session response", async () => {
    const session = makeSession()
    const message = makeSessionMessage({ sessionId: session.id })
    const request = {
      method: "GET",
      url: `http://localhost/api/sessions/${session.id}?userId=${session.userId}`,
      params: { sessionId: session.id }
    } as Bun.BunRequest<"/api/sessions/:sessionId">

    const latestRun: PromptRunMetadata = {
      resolvedMode: "review",
      selectedSkills: ["coding-standards"],
      rootAgentsLoaded: true,
      layers: [
        {
          order: 0,
          id: "base:abc",
          kind: "base",
          source: "apps/api/src/agent/prompts/malkier-base-system-prompt.md",
          sha256: "abc"
        }
      ]
    }

    const response = await Effect.runPromise(
      getSession(request).pipe(Effect.provideService(SessionServiceTag, makeSessionService(latestRun)))
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      session: {
        ...session,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString()
      },
      messages: [
        {
          ...message,
          createdAt: message.createdAt.toISOString()
        }
      ],
      latestRun
    })
  })
})
