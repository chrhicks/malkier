import { Effect } from "effect"
import { BadRequestError } from "../errors"
import { json } from "../request-utils"
import { SessionRouteParams, SessionUserQuery } from "../schema"
import { SessionService } from "../service/session.service"

export const getSession = (request: Bun.BunRequest<"/api/sessions/:sessionId">) =>
  Effect.gen(function* () {
    const url = new URL(request.url)

    const query = yield* Effect.try({
      try: () => SessionUserQuery.parse({ userId: url.searchParams.get("userId") }),
      catch: (error) => new BadRequestError({ message: `Invalid request query: ${String(error)}` })
    })

    const params = yield* Effect.try({
      try: () => SessionRouteParams.parse(request.params),
      catch: (error) => new BadRequestError({ message: `Invalid route params: ${String(error)}` })
    })

    const session = yield* SessionService.getSession({
      userId: query.userId,
      sessionId: params.sessionId
    })

    return json(200, session)
  }).pipe(
    Effect.catchTags({
      BadRequestError: (error) =>
        Effect.succeed(json(400, { error: error.message })),
      SessionNotFoundError: (error) =>
        Effect.succeed(json(404, { error: error.message })),
      SessionOwnershipError: (error) =>
        Effect.succeed(json(404, { error: error.message })),
      InternalError: (error) =>
        Effect.succeed(json(500, { error: error.message }))
    }),
    Effect.catchAll(() =>
      Effect.succeed(json(500, { error: "Unexpected error" }))
    )
  )
