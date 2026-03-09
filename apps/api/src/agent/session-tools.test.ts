import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Session, SessionMessage } from "../db/schema"
import { InternalError, SessionNotFoundError, SessionOwnershipError } from "../errors"
import type { SessionService } from "../service/session.service"
import { getSessionTools } from "./session-tools"

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: overrides.id ?? "session-1",
  userId: overrides.userId ?? "user-1",
  title: overrides.title ?? null,
  status: overrides.status ?? "active",
  createdAt: overrides.createdAt ?? new Date("2026-03-09T00:00:00.000Z"),
  updatedAt: overrides.updatedAt ?? new Date("2026-03-09T00:00:00.000Z")
})

const makeSessionMessage = (overrides: Partial<SessionMessage> = {}): SessionMessage => ({
  id: overrides.id ?? "message-1",
  sessionId: overrides.sessionId ?? "session-1",
  role: overrides.role ?? "user",
  content: overrides.content ?? "Hello",
  status: overrides.status ?? "complete",
  sequence: overrides.sequence ?? 1,
  tokenCount: overrides.tokenCount ?? null,
  metadata: overrides.metadata ?? null,
  createdAt: overrides.createdAt ?? new Date("2026-03-09T00:00:00.000Z")
})

const makeSessionService = (overrides: {
  listSessions?: SessionService["listSessions"]
  getSession?: SessionService["getSession"]
}): SessionService =>
  ({
    listSessions: overrides.listSessions ?? (() => Effect.succeed([])),
    getSession:
      overrides.getSession ??
      (() =>
        Effect.fail(
          new SessionNotFoundError({
            message: "Session not found"
          })
        ))
  }) as unknown as SessionService

describe("getSessionTools", () => {
  test("maps list_sessions service results into tool summaries", async () => {
    const sessionService = makeSessionService({
      listSessions: (userId) => {
        expect(userId).toBe("user-1")

        return Effect.succeed([
          makeSession({
            id: "session-1",
            title: null,
            updatedAt: new Date("2026-03-09T12:00:00.000Z")
          }),
          makeSession({
            id: "session-2",
            title: "Debugging tools",
            updatedAt: new Date("2026-03-09T13:00:00.000Z")
          })
        ])
      }
    })

    const toolkit = await Effect.runPromise(getSessionTools("user-1", sessionService))
    const result = await Effect.runPromise(toolkit.handle("list_sessions", {}))

    expect(result).toEqual({
      isFailure: false,
      result: [
        {
          id: "session-1",
          title: "Untitled session",
          updatedAt: "2026-03-09T12:00:00.000Z"
        },
        {
          id: "session-2",
          title: "Debugging tools",
          updatedAt: "2026-03-09T13:00:00.000Z"
        }
      ],
      encodedResult: [
        {
          id: "session-1",
          title: "Untitled session",
          updatedAt: "2026-03-09T12:00:00.000Z"
        },
        {
          id: "session-2",
          title: "Debugging tools",
          updatedAt: "2026-03-09T13:00:00.000Z"
        }
      ]
    })
  })

  test("maps get_session service results into tool details", async () => {
    const sessionService = makeSessionService({
      getSession: ({ userId, sessionId }) => {
        expect(userId).toBe("user-1")
        expect(sessionId).toBe("session-2")

        return Effect.succeed({
          session: makeSession({
            id: "session-2",
            title: null
          }),
          messages: [
            makeSessionMessage({
              sessionId: "session-2",
              role: "user",
              content: "Show me the last session",
              sequence: 1
            }),
            makeSessionMessage({
              id: "message-2",
              sessionId: "session-2",
              role: "assistant",
              content: "Here it is",
              sequence: 2
            })
          ]
        })
      }
    })

    const toolkit = await Effect.runPromise(getSessionTools("user-1", sessionService))
    const result = await Effect.runPromise(
      toolkit.handle("get_session", { sessionId: "session-2" })
    )

    expect(result).toEqual({
      isFailure: false,
      result: {
        id: "session-2",
        title: "Untitled session",
        messages: [
          { role: "user", content: "Show me the last session" },
          { role: "assistant", content: "Here it is" }
        ]
      },
      encodedResult: {
        id: "session-2",
        title: "Untitled session",
        messages: [
          { role: "user", content: "Show me the last session" },
          { role: "assistant", content: "Here it is" }
        ]
      }
    })
  })

  test("returns structured tool failures for get_session errors", async () => {
    const cases = [
      {
        error: new SessionNotFoundError({ message: "Session not found: missing" }),
        expected: { kind: "not-found", message: "Session not found: missing" }
      },
      {
        error: new SessionOwnershipError({ message: "Invalid session id" }),
        expected: { kind: "forbidden", message: "That session is not available." }
      },
      {
        error: new InternalError({ message: "DB offline" }),
        expected: { kind: "internal", message: "Unable to load session data right now." }
      }
    ] as const

    for (const testCase of cases) {
      const sessionService = makeSessionService({
        getSession: () => Effect.fail(testCase.error)
      })

      const toolkit = await Effect.runPromise(getSessionTools("user-1", sessionService))
      const result = await Effect.runPromise(
        toolkit.handle("get_session", { sessionId: "session-404" })
      )

      expect(result).toEqual({
        isFailure: true,
        result: testCase.expected,
        encodedResult: testCase.expected
      })
    }
  })

  test("returns structured tool failures for list_sessions internal errors", async () => {
    const sessionService = makeSessionService({
      listSessions: () =>
        Effect.fail(
          new InternalError({
            message: "DB offline"
          })
        )
    })

    const toolkit = await Effect.runPromise(getSessionTools("user-1", sessionService))
    const result = await Effect.runPromise(toolkit.handle("list_sessions", {}))

    expect(result).toEqual({
      isFailure: true,
      result: {
        kind: "internal",
        message: "Unable to load session data right now."
      },
      encodedResult: {
        kind: "internal",
        message: "Unable to load session data right now."
      }
    })
  })
})
