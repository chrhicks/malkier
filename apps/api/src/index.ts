import { Effect } from "effect"
import { dbPath } from "./db/client"
import { getSession } from "./handlers/get-session"
import { getSessions } from "./handlers/get-sessions"
import { json } from "./request-utils"
import { postAgentStream } from "./handlers/post-agent-stream"
import { SessionService } from "./service/session.service"

const server = Bun.serve({
  port: Number(Bun.env.PORT ?? 8787),
  routes: {
    "/health": () => json(200, { ok: true }),
    "/api/sessions": {
      GET: async (request: Request) =>
        Effect.runPromise(
          getSessions(request).pipe(
            Effect.provide(SessionService.Default)
          )
        )
    },
    "/api/sessions/:sessionId": {
      GET: async (request: Bun.BunRequest<"/api/sessions/:sessionId">) =>
        Effect.runPromise(
          getSession(request).pipe(
            Effect.provide(SessionService.Default)
          )
        )
    },
    "/api/agent/stream": {
      POST: async (request: Request) =>
        Effect.runPromise(
          postAgentStream(request).pipe(
            Effect.provide(SessionService.Default)
          )
        )
    }
  }
})

console.log(`API server listening on ${server.url} (sqlite: ${dbPath})`)
