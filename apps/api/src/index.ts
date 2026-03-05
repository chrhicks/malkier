import { Effect } from "effect"
import { dbPath } from "./db/client"
import { json } from "./request-utils"
import { postAgentStream } from "./handlers/post-agent-stream"
import { SessionService } from "./service/session.service"

const server = Bun.serve({
  port: Number(Bun.env.PORT ?? 8787),
  routes: {
    "/health": () => json(200, { ok: true }),
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
