import { Effect } from "effect"
import { BadRequestError, InternalError } from "../errors"
import { json } from "../request-utils"
import { SessionUserQuery } from "../schema"
import withHttpObservability from "../server/http-observability"
import { SessionService } from "../service/session.service"

export const getSessions = (request: Request) =>
  withHttpObservability(
    "http.get-sessions",
    {
      "http.request.method": request.method,
      "http.route": "/api/sessions",
      "url.full": request.url
    },
    Effect.gen(function* () {
      const url = new URL(request.url)

      const parsed = yield* Effect.try({
        try: () => SessionUserQuery.parse({ userId: url.searchParams.get("userId") }),
        catch: (error) => new BadRequestError({ message: `Invalid request query: ${String(error)}` })
      })

      yield* Effect.annotateCurrentSpan("user.id", parsed.userId)

      const sessions = yield* SessionService.listSessions(parsed.userId)

      yield* Effect.annotateCurrentSpan("session.list.count", sessions.length)

      return json(200, { sessions })
    })
  ).pipe(
    Effect.catchTags({
      BadRequestError: (error) =>
        Effect.succeed(json(400, { error: error.message })),
      InternalError: (error) =>
        Effect.succeed(json(500, { error: error.message }))
    }),
    Effect.catchAll(() =>
      Effect.succeed(json(500, { error: "Unexpected error" }))
    )
  )
