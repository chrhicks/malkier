import { Tool, Toolkit } from "@effect/ai";
import { Effect, Schema } from "effect";
import type { SessionService } from "../../service/session.service";

const SessionToolFailure = Schema.Struct({
  kind: Schema.Literal('not-found', 'forbidden', 'internal'),
  message: Schema.String
})

const ListSessions = Tool.make('list_sessions', {
  description: `List the current user's recent chat sessions with ids, titles, and update times`,
  success: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      updatedAt: Schema.String
    })
  ),
  failure: SessionToolFailure,
  failureMode: 'return'
})

const GetSession = Tool.make('get_session', {
  description: 'Get a single chat session by id, including its saved message history',
  parameters: {
    sessionId: Schema.String
  },
  success: Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    messages: Schema.Array(
      Schema.Struct({
        role: Schema.String,
        content: Schema.String
      })
    )
  }),
  failure: SessionToolFailure,
  failureMode: 'return'
})


const toSessionToolFailure = (error: {
  _tag: 'SessionNotFoundError' | 'SessionOwnershipError' | 'InternalError' | 'MetadataJsonError' | 'MetadataShapeError',
  message: string
}): {
  kind: 'not-found' | 'forbidden' | 'internal',
  message: string
} => {
  switch (error._tag) {
    case 'SessionNotFoundError':
      return { kind: 'not-found' as const, message: error.message }
    case 'SessionOwnershipError':
      return { kind: 'forbidden' as const, message: 'That session is not available.' }
    case 'InternalError':
      return { kind: 'internal' as const, message: 'Unable to load session data right now.' }
    case 'MetadataJsonError':
    case 'MetadataShapeError':
      return { kind: 'internal' as const, message: 'Unable to read session message data right now.' }

  }
}

export const SessionToolkit = Toolkit.make(ListSessions, GetSession)

export const makeSessionToolkitLayer = (userId: string, sessionService: SessionService) =>
  SessionToolkit.toLayer({
    list_sessions: () =>
      sessionService.listSessions(userId).pipe(
        Effect.map((sessions) => sessions.map(session => ({
          id: session.id,
          title: session.title ?? "Untitled session",
          updatedAt: session.updatedAt.toISOString()
        }))),
        Effect.catchTags({
          InternalError: (error) => Effect.fail(toSessionToolFailure(error))
        })
      ),

    get_session: ({ sessionId }) =>
      sessionService.getSession({ userId, sessionId }).pipe(
        Effect.map(({ session, messages }) => ({
          id: session.id,
          title: session.title ?? 'Untitled session',
          messages: messages.map(message => ({
            role: message.role,
            content: message.content
          }))
        })),
        Effect.catchTags({
          SessionNotFoundError: (error) => Effect.fail(toSessionToolFailure(error)),
          SessionOwnershipError: (error) => Effect.fail(toSessionToolFailure(error)),
          InternalError: (error) => Effect.fail(toSessionToolFailure(error)),
          MetadataJsonError: (error) => Effect.fail(toSessionToolFailure(error)),
          MetadataShapeError: (error) => Effect.fail(toSessionToolFailure(error))
        })
      )
  })