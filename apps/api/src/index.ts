import { Effect, Layer } from "effect"
import { getMalkierConfig } from "./config/malkier-config"
import { HoneycombObservabilityLive } from "./observability/honeycomb"
import { dbPath } from "./db/client"
import { migrateDb } from "./db/migrate"
import { getSession } from "./handlers/get-session"
import { getSessions } from "./handlers/get-sessions"
import { json } from "./request-utils"
import { postAgentStream } from "./handlers/post-agent-stream"
import { SessionService } from "./service/session.service"

const ApiLive = Layer.mergeAll(SessionService.Default, HoneycombObservabilityLive)
const malkierConfig = getMalkierConfig()

const runApi = <A, E>(effect: Effect.Effect<A, E, SessionService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(ApiLive)))

if (malkierConfig.database.migrateOnStartup) {
  migrateDb()
}

const server = Bun.serve({
  idleTimeout: malkierConfig.api.idleTimeoutSeconds,
  port: malkierConfig.api.port,
  routes: {
    "/health": () => json(200, { ok: true }),
    "/api/sessions": {
      GET: async (request: Request) => runApi(getSessions(request))
    },
    "/api/sessions/:sessionId": {
      GET: async (request: Bun.BunRequest<"/api/sessions/:sessionId">) => runApi(getSession(request))
    },
    "/api/agent/stream": {
      POST: async (request: Request) => runApi(postAgentStream(request))
    }
  }
})

console.log(`API server listening on ${server.url} (sqlite: ${dbPath})`)
