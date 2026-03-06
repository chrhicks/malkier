import { Effect } from "effect"
import { BadRequestError, InternalError } from "../errors"
import { json } from "../request-utils"
import { SessionUserQuery } from "../schema"
import { SessionService } from "../service/session.service"

export const getSessions = (request: Request) =>
  Effect.gen(function* () {
    const url = new URL(request.url)

    const parsed = yield* Effect.try({
      try: () => SessionUserQuery.parse({ userId: url.searchParams.get("userId") }),
      catch: (error) => new BadRequestError({ message: `Invalid request query: ${String(error)}` })
    })

    const sessions = yield* SessionService.listSessions(parsed.userId)

    return json(200, { sessions })
  }).pipe(
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
