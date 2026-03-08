import { Effect } from "effect"
import { db } from "../db/client"
import { sessionMessages, sessions, type SessionMessageRole, type SessionMessageStatus } from "../db/schema"
import { asc, desc, eq, max } from "drizzle-orm"
import { InternalError, SessionNotFoundError, SessionOwnershipError } from "../errors"
import type { PersistedAssistantToolCall, PersistedToolResult } from "../agent/persisted-prompts"

const makeSessionTitle = (message: string) => {
  const normalized = message.trim().replace(/\s+/g, " ")

  if (normalized.length <= 72) {
    return normalized
  }

  return `${normalized.slice(0, 69).trimEnd()}...`
}

export class SessionService extends Effect.Service<SessionService>()("SessionService", {
  accessors: true,
  effect: Effect.gen(function* () {
    const ensureSession = Effect.fn("SessionService.ensureSession")(function* ({
      userId,
      sessionId
    }: {
      userId: string,
      sessionId?: string
    }) {
      const now = new Date()
      const resolvedSessionId = sessionId ?? crypto.randomUUID()

      const existing = yield* Effect.tryPromise({
        try: () =>
          db.query.sessions.findFirst({
            where: eq(sessions.id, resolvedSessionId)
          }),
        catch: (error) => new InternalError({ message: `Failed to load session: ${String(error)}` })
      })

      if (existing != null && existing.userId !== userId) {
        return yield* Effect.fail(
          new SessionOwnershipError({
            message: `Invalid session id for user: ${String(userId)}, sessionId: ${String(sessionId)}`
          })
        )
      }

      if (existing == null) {
        yield* Effect.tryPromise({
          try: () =>
            db.insert(sessions).values({
              id: resolvedSessionId,
              userId,
              status: 'active',
              createdAt: now,
              updatedAt: now
            }),
          catch: (error) => new InternalError({ message: `Failed to create session: ${String(error)}` })
        })
      }

      return resolvedSessionId
    })

    const nextMessageSequence = Effect.fn('SessionService.nextMessageSequence')(function* (
      sessionId: string
    ) {
      const row = yield* Effect.tryPromise({
        try: () => db
          .select({ maxSeq: max(sessionMessages.sequence) })
          .from(sessionMessages)
          .where(eq(sessionMessages.sessionId, sessionId)),
        catch: (error) => new InternalError({ message: `Failed to get next sequence id for message: ${String(error)} ` })
      })

      return (row[0]?.maxSeq ?? 0) + 1
    })

    const listSessions = Effect.fn("SessionService.listSessions")(function* (userId: string) {
      return yield* Effect.tryPromise({
        try: () =>
          db.select().from(sessions).where(eq(sessions.userId, userId)).orderBy(desc(sessions.updatedAt)),
        catch: (error) => new InternalError({ message: `Failed to list sessions: ${String(error)}` })
      })
    })

    const getSession = Effect.fn("SessionService.getSession")(function* ({
      userId,
      sessionId
    }: {
      userId: string,
      sessionId: string
    }) {
      const session = yield* Effect.tryPromise({
        try: () =>
          db.query.sessions.findFirst({
            where: eq(sessions.id, sessionId)
          }),
        catch: (error) => new InternalError({ message: `Failed to load session: ${String(error)}` })
      })

      if (session == null) {
        return yield* Effect.fail(
          new SessionNotFoundError({
            message: `Session not found: ${sessionId}`
          })
        )
      }

      if (session.userId !== userId) {
        return yield* Effect.fail(
          new SessionOwnershipError({
            message: `Invalid session id for user: ${String(userId)}, sessionId: ${String(sessionId)}`
          })
        )
      }

      const messages = yield* Effect.tryPromise({
        try: () =>
          db.select().from(sessionMessages).where(eq(sessionMessages.sessionId, sessionId)).orderBy(asc(sessionMessages.sequence)),
        catch: (error) => new InternalError({ message: `Failed to load session messages: ${String(error)}` })
      })

      return {
        session,
        messages
      }
    })

    const insertSessionMessage = Effect.fn('SessionService.insertSessionMessage')(function* ({
      sessionId,
      message,
      nextSequence,
      role,
      status,
      metadata
    }: {
      sessionId: string,
      message: string,
      nextSequence: number,
      role: SessionMessageRole,
      status: NonNullable<SessionMessageStatus>,
      metadata?: PersistedAssistantToolCall | PersistedToolResult
    }) {
      const now = new Date()

      yield* Effect.tryPromise({
        try: () => db.insert(sessionMessages).values({
          id: crypto.randomUUID(),
          sessionId,
          role,
          content: message,
          status,
          sequence: nextSequence,
          createdAt: now,
          metadata: JSON.stringify(metadata)
        }),
        catch: (error) => new InternalError({ message: `Failed to insert sessionMessage: ${String(error)} ` })
      })

      const existingSession = role === "user"
        ? yield* Effect.tryPromise({
          try: () =>
            db.query.sessions.findFirst({
              columns: {
                title: true
              },
              where: eq(sessions.id, sessionId)
            }),
          catch: (error) => new InternalError({ message: `Failed to load session metadata: ${String(error)}` })
        })
        : null

      yield* Effect.tryPromise({
        try: () =>
          db.update(sessions)
            .set({
              updatedAt: now,
              ...(role === "user" && (existingSession?.title == null || existingSession.title.trim().length === 0)
                ? { title: makeSessionTitle(message) }
                : {})
            })
            .where(eq(sessions.id, sessionId)),
        catch: (error) => new InternalError({ message: `Failed to update session metadata: ${String(error)}` })
      })
    })

    return {
      ensureSession,
      getSession,
      nextMessageSequence,
      insertSessionMessage,
      listSessions,
    }
  })
}) { }
