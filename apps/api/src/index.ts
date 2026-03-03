import { Agent, layerConfig } from "@malkier/agent"
import { Config, Effect, Fiber, Stream } from "effect"

const encoder = new TextEncoder()

const agentLayer = layerConfig({
  model: Config.string("MALKIER_AGENT_MODEL").pipe(
    Config.withDefault("gpt-5.3-codex")
  ),
  apiUrl: Config.string("MALKIER_AGENT_API_URL").pipe(
    Config.withDefault("https://opencode.ai/zen/v1")
  ),
  apiKey: Config.redacted("OPENCODE_ZEN_API_KEY")
})

const sseFrame = (event: string, data: unknown): Uint8Array =>
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  })

const readMessage = async (request: Request): Promise<string | null> => {
  try {
    const body = (await request.json()) as { message?: unknown }
    if (typeof body.message !== "string") {
      return null
    }
    const message = body.message.trim()
    return message.length > 0 ? message : null
  } catch {
    return null
  }
}

const server = Bun.serve({
  port: Number(Bun.env.PORT ?? 8787),
  routes: {
    "/health": () => json(200, { ok: true }),
    "/api/agent/stream": {
      POST: async (request: Request) => {
        const message = await readMessage(request)

        if (message === null) {
          return json(400, {
            error: "Invalid request body. Expected JSON with non-empty string 'message'."
          })
        }

        let fiber: Fiber.RuntimeFiber<void, never> | null = null

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const send = (event: string, data: unknown) => {
              controller.enqueue(sseFrame(event, data))
            }

            fiber = Effect.runFork(
              Effect.gen(function*() {
                const agent = yield* Agent

                yield* agent.runStream({ message }).pipe(
                  Stream.runForEach((event) =>
                    Effect.sync(() => {
                      send("agent-event", event)
                    })
                  )
                )
              }).pipe(
                Effect.provide(agentLayer),
                Effect.catchAllCause((cause) =>
                  Effect.sync(() => {
                    send("agent-event", {
                      type: "error",
                      message: cause.toString()
                    })
                  })
                ),
                Effect.ensuring(
                  Effect.sync(() => {
                    controller.close()
                  })
                )
              )
            )
          },
          cancel() {
            if (fiber !== null) {
              Effect.runFork(Fiber.interrupt(fiber))
            }
          }
        })

        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive"
          }
        })
      }
    }
  }
})

console.log(`API server listening on ${server.url}`)
