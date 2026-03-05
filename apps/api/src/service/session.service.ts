import { Effect } from "effect"
import { db } from "../db/client"
import { sessionMessages, sessions, type SessionMessageRole, type SessionMessageStatus } from "../db/schema"
import { and, eq, max } from "drizzle-orm"
import { InternalError, SessionOwnershipError } from "../errors"

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

      if (existing !== null && existing?.userId !== userId) {
        yield* Effect.fail(
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

    const insertSessionMessage = Effect.fn('SessionService.insertSessionMessage')(function* ({
      sessionId,
      message,
      nextSequence,
      role,
      status
    }: {
      sessionId: string,
      message: string,
      nextSequence: number,
      role: SessionMessageRole,
      status: NonNullable<SessionMessageStatus>
    }) {
      yield* Effect.tryPromise({
        try: () => db.insert(sessionMessages).values({
          id: crypto.randomUUID(),
          sessionId,
          role,
          content: message,
          status,
          sequence: nextSequence,
          createdAt: new Date()
        }),
        catch: (error) => new InternalError({ message: `Failed to insert sessionMessage: ${String(error)} ` })
      })
    })

    return {
      ensureSession,
      nextMessageSequence,
      insertSessionMessage,
    }
  })
}) { }

