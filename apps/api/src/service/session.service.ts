import { Effect } from "effect"
import { annotateCurrentSpanAttributes } from "../observability/span-attributes"
import { db } from "../db/client"
import { sessionMessages, sessionRuns, sessions, type SessionMessage, type SessionMessageRole, type SessionMessageStatus } from "../db/schema"
import { asc, desc, eq, max } from "drizzle-orm"
import { InternalError, SessionNotFoundError, SessionOwnershipError } from "../errors"
import { decodeToolMetadata, type PromptMetadata } from "../agent/persisted-prompts"
import { decodePromptRunMetadata, type PromptRunMetadata } from "../agent/prompt-run-metadata"

const makeSessionTitle = (message: string) => {
  const normalized = message.trim().replace(/\s+/g, " ")

  if (normalized.length <= 72) {
    return normalized
  }

  return `${normalized.slice(0, 69).trimEnd()}...`
}

export type SessionMessageWithMetadata = Omit<SessionMessage, 'metadata'> & {
  metadata: PromptMetadata | null
}

const decodeMetadata = (metadata: string | null) =>
  metadata == null
    ? Effect.succeed(null)
    : decodeToolMetadata(metadata)

const decodeRunMetadata = (metadata: string) =>
  decodePromptRunMetadata(metadata).pipe(
    Effect.mapError((error) => new InternalError({ message: `Failed to decode prompt run metadata: ${String(error)}` }))
  )

const decodeMessage = (message: SessionMessage) =>
  Effect.gen(function* () {
    return {
      ...message,
      metadata: yield* decodeMetadata(message.metadata)
    }
  })

const withDbSpan = <A, E, R>(
  name: string,
  attributes: Record<string, string | number | boolean | undefined>,
  effect: Effect.Effect<A, E, R>,
  onSuccess?: (value: A) => Effect.Effect<void>
) =>
  Effect.gen(function* () {
    yield* annotateCurrentSpanAttributes(attributes)
    const value = yield* effect

    if (onSuccess !== undefined) {
      yield* onSuccess(value)
    }

    return value
  }).pipe(Effect.withSpan(name))

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

      const existing = yield* withDbSpan(
        "db.sessions.find_first",
        {
          "db.operation": "select",
          "db.table": "sessions",
          "session.id": resolvedSessionId,
          "user.id": userId
        },
        Effect.tryPromise({
          try: () =>
            db.query.sessions.findFirst({
              where: eq(sessions.id, resolvedSessionId)
            }),
          catch: (error) => new InternalError({ message: `Failed to load session: ${String(error)}` })
        }),
        (session) =>
          annotateCurrentSpanAttributes({
            "db.row_count": session == null ? 0 : 1
          })
      )

      if (existing != null && existing.userId !== userId) {
        return yield* Effect.fail(
          new SessionOwnershipError({
            message: `Invalid session id for user: ${String(userId)}, sessionId: ${String(sessionId)}`
          })
        )
      }

      if (existing == null) {
        yield* withDbSpan(
          "db.sessions.insert",
          {
            "db.operation": "insert",
            "db.table": "sessions",
            "session.id": resolvedSessionId,
            "user.id": userId
          },
          Effect.tryPromise({
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
        )
      }

      return {
        sessionId: resolvedSessionId,
        isNew: existing == null
      }
    })

    const nextMessageSequence = Effect.fn('SessionService.nextMessageSequence')(function* (
      sessionId: string
    ) {
      const row = yield* withDbSpan(
        "db.session_messages.select",
        {
          "db.operation": "select",
          "db.table": "session_messages",
          "session.id": sessionId
        },
        Effect.tryPromise({
          try: () => db
            .select({ maxSeq: max(sessionMessages.sequence) })
            .from(sessionMessages)
            .where(eq(sessionMessages.sessionId, sessionId)),
          catch: (error) => new InternalError({ message: `Failed to get next sequence id for message: ${String(error)} ` })
        }),
        (rows) =>
          annotateCurrentSpanAttributes({
            "db.row_count": rows.length
          })
      )

      return (row[0]?.maxSeq ?? 0) + 1
    })

    const listSessions = Effect.fn("SessionService.listSessions")(function* (userId: string) {
      return yield* withDbSpan(
        "db.sessions.select",
        {
          "db.operation": "select",
          "db.table": "sessions",
          "user.id": userId
        },
        Effect.tryPromise({
          try: () =>
            db.select().from(sessions).where(eq(sessions.userId, userId)).orderBy(desc(sessions.updatedAt)),
          catch: (error) => new InternalError({ message: `Failed to list sessions: ${String(error)}` })
        }),
        (rows) =>
          annotateCurrentSpanAttributes({
            "db.row_count": rows.length
          })
      )
    })

    const getSession = Effect.fn("SessionService.getSession")(function* ({
      userId,
      sessionId
    }: {
      userId: string,
      sessionId: string
    }) {
      const session = yield* withDbSpan(
        "db.sessions.find_first",
        {
          "db.operation": "select",
          "db.table": "sessions",
          "session.id": sessionId,
          "user.id": userId
        },
        Effect.tryPromise({
          try: () =>
            db.query.sessions.findFirst({
              where: eq(sessions.id, sessionId)
            }),
          catch: (error) => new InternalError({ message: `Failed to load session: ${String(error)}` })
        }),
        (value) =>
          annotateCurrentSpanAttributes({
            "db.row_count": value == null ? 0 : 1
          })
      )

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

      const dbMessages = yield* withDbSpan(
        "db.session_messages.select",
        {
          "db.operation": "select",
          "db.table": "session_messages",
          "session.id": sessionId,
          "user.id": userId
        },
        Effect.tryPromise({
          try: () =>
            db.select()
              .from(sessionMessages)
              .where(eq(sessionMessages.sessionId, sessionId))
              .orderBy(asc(sessionMessages.sequence)),
          catch: (error) => new InternalError({ message: `Failed to load session messages: ${String(error)}` })
        }),
        (rows) =>
          annotateCurrentSpanAttributes({
            "db.row_count": rows.length
          })
      )

      const messages = yield* Effect.forEach(dbMessages, decodeMessage)

      const latestRunRow = yield* withDbSpan(
        "db.session_runs.find_first",
        {
          "db.operation": "select",
          "db.table": "session_runs",
          "session.id": sessionId,
          "user.id": userId
        },
        Effect.tryPromise({
          try: () =>
            db.select()
              .from(sessionRuns)
              .where(eq(sessionRuns.sessionId, sessionId))
              .orderBy(desc(sessionRuns.createdAt))
              .limit(1),
          catch: (error) => new InternalError({ message: `Failed to load session runs: ${String(error)}` })
        }),
        (rows) =>
          annotateCurrentSpanAttributes({
            "db.row_count": rows.length
          })
      )

      const latestRun = latestRunRow[0] == null
        ? null
        : yield* decodeRunMetadata(latestRunRow[0].metadata)

      return {
        session,
        messages,
        latestRun
      }
    })

    const insertSessionRun = Effect.fn("SessionService.insertSessionRun")(function* ({
      sessionId,
      metadata
    }: {
      sessionId: string,
      metadata: PromptRunMetadata
    }) {
      const now = new Date()

      yield* withDbSpan(
        "db.session_runs.insert",
        {
          "db.operation": "insert",
          "db.table": "session_runs",
          "session.id": sessionId,
          "prompt.layer.count": metadata.layers.length,
          "agent.mode.resolved": metadata.resolvedMode
        },
        Effect.tryPromise({
          try: () =>
            db.insert(sessionRuns).values({
              id: crypto.randomUUID(),
              sessionId,
              metadata: JSON.stringify(metadata),
              createdAt: now
            }),
          catch: (error) => new InternalError({ message: `Failed to insert session run metadata: ${String(error)}` })
        })
      )
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
      metadata?: PromptMetadata
    }) {
      const now = new Date()

      yield* withDbSpan(
        "db.session_messages.insert",
        {
          "db.operation": "insert",
          "db.table": "session_messages",
          "session.id": sessionId,
          "message.role": role,
          "message.sequence": nextSequence
        },
        Effect.tryPromise({
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
      )

      const existingSession = role === "user"
        ? yield* withDbSpan(
          "db.sessions.find_first",
          {
            "db.operation": "select",
            "db.table": "sessions",
            "session.id": sessionId
          },
          Effect.tryPromise({
            try: () =>
              db.query.sessions.findFirst({
                columns: {
                  title: true
                },
                where: eq(sessions.id, sessionId)
              }),
            catch: (error) => new InternalError({ message: `Failed to load session metadata: ${String(error)}` })
          }),
          (session) =>
            annotateCurrentSpanAttributes({
              "db.row_count": session == null ? 0 : 1
            })
        )
        : null

      yield* withDbSpan(
        "db.sessions.update",
        {
          "db.operation": "update",
          "db.table": "sessions",
          "session.id": sessionId,
          "message.role": role
        },
        Effect.tryPromise({
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
      )
    })

    return {
      ensureSession,
      getSession,
      nextMessageSequence,
      insertSessionMessage,
      insertSessionRun,
      listSessions,
    }
  })
}) { }
