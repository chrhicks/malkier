import { Agent, layerConfig } from "@malkier/agent"
import { Config, Effect, Fiber, Stream } from "effect"
import { PostAgentMessageRequest } from "../schema"
import { BadRequestError } from "../errors"
import { json } from "../request-utils"
import { SessionService } from "../service/session.service"

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


const makeStreamResponse = (message: string, _sessionId: string) => {
  let fiber: Fiber.RuntimeFiber<void, never> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(sseFrame(event, data))
      }

      fiber = Effect.runFork(
        Effect.gen(function* () {
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

export const postAgentStream = (request: Request) =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => request.json(),
      catch: () => new BadRequestError({ message: 'Invalid JSON body' })
    })

    const parsed = yield* Effect.try({
      try: () => PostAgentMessageRequest.parse(body),
      catch: (error) => new BadRequestError({ message: `Invalid request body: ${String(error)}` })
    })

    const sessionId = yield* SessionService.ensureSession({
      userId: parsed.userId,
      sessionId: parsed.sessionId
    })

    return makeStreamResponse(parsed.message, sessionId)
  }).pipe(
    Effect.catchTags({
      BadRequestError: (error) =>
        Effect.succeed(json(400, { error: error.message })),
      SessionOwnershipError: (error) =>
        Effect.succeed(json(400, { error: error.message })),
      InternalError: (error) =>
        Effect.succeed(json(500, { error: error.message }))
    }),
    Effect.catchAll(() =>
      Effect.succeed(json(500, { error: "Unexpected error" }))
    )
  )
