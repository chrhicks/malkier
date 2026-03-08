import { Agent, layerConfig } from "@malkier/agent"
import { Config, Effect, Fiber, Stream } from "effect"
import { Response as EffectResponse } from "@effect/ai"
import { PostAgentMessageRequest } from "../schema"
import { BadRequestError } from "../errors"
import { json } from "../request-utils"
import { SessionService } from "../service/session.service"
import { Prompt } from "@effect/ai"
import type { SessionMessage } from "../db/schema"
import { parsePersistedPromptMetadata } from "../agent/persisted-prompts"

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

const streamFailureMessage = "Agent stream failed"

const formatResult = (result: unknown): string => {
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}

const makeStreamResponse = ({
  sessionId,
  prompt,
  nextSequence,
  sessionService
}: {
  sessionId: string
  prompt: Prompt.RawInput
  nextSequence: number
  sessionService: SessionService
}) => {
  let fiber: Fiber.RuntimeFiber<void, never> | null = null
  let sequence = nextSequence

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(sseFrame(event, data))
      }

      fiber = Effect.runFork(
        Effect.gen(function* () {
          const agent = yield* Agent
          let agentText = '';

          yield* agent.runStream({ prompt }).pipe(
            Stream.runForEach((event) => {
              if (event.type === 'text-delta') {
                agentText += event.delta
                return Effect.sync(() => send('agent-event', event))
              }

              if (event.type === 'tool-call') {
                return sessionService.insertSessionMessage({
                  sessionId,
                  message: `Calling ${event.name}`,
                  role: 'assistant',
                  status: 'complete',
                  nextSequence: sequence++,
                  metadata: {
                    kind: 'assistant-tool-call',
                    id: event.id,
                    name: event.name,
                    params: event.params
                  }
                }).pipe(
                  Effect.zipRight(Effect.sync(() => send('agent-event', event)))
                )
              }

              if (event.type === 'tool-result') {
                return sessionService.insertSessionMessage({
                  sessionId,
                  message: formatResult(event.result),
                  role: 'tool',
                  status: 'complete',
                  nextSequence: sequence++,
                  metadata: {
                    kind: 'tool-result',
                    id: event.id,
                    name: event.name,
                    result: event.result,
                    isFailure: event.isFailure
                  }
                }).pipe(
                  Effect.zipRight(Effect.sync(() => send('agent-event', event)))
                )
              }

              if (event.type === 'done') {
                return sessionService.insertSessionMessage({
                  sessionId,
                  message: agentText,
                  role: 'assistant',
                  status: 'complete',
                  nextSequence: sequence++
                }).pipe(
                  Effect.zipRight(Effect.sync(() => send('agent-event', event)))
                )
              }

              if (event.type === 'error') {
                return sessionService.insertSessionMessage({
                  sessionId,
                  message: event.message,
                  role: 'assistant',
                  status: 'error',
                  nextSequence: sequence++
                }).pipe(
                  Effect.zipRight(Effect.sync(() => send('agent-event', event)))
                )
              }

              return Effect.sync(() => send('agent-event', event))
            })
          )
        }).pipe(
          Effect.provide(agentLayer),
          Effect.catchAllCause((cause) =>
            sessionService.insertSessionMessage({
              sessionId,
              message: streamFailureMessage,
              role: 'assistant',
              status: 'error',
              nextSequence: sequence++
            }).pipe(
              Effect.catchAll(() => Effect.void),
              Effect.zipRight(
                Effect.sync(() => {
                  send("agent-event", {
                    type: "error",
                    message: streamFailureMessage
                  })
                })
              )
            )
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
      "access-control-expose-headers": "x-session-id",
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-session-id": sessionId
    }
  })
}

export const collectPrompt = (messages: SessionMessage[]): Prompt.RawInput => {
  let prompt = Prompt.empty
  let responseParts: EffectResponse.AnyPart[] = []

  const flushResponseParts = () => {
    if (responseParts.length === 0) return

    prompt = Prompt.merge(prompt, Prompt.fromResponseParts(responseParts))
    responseParts = []
  }

  for (const msg of messages) {
    const meta = parsePersistedPromptMetadata(msg.metadata)
    if (meta?.kind === 'assistant-tool-call') {
      responseParts.push(EffectResponse.makePart('tool-call', {
        id: meta.id,
        name: meta.name,
        params: meta.params,
        providerExecuted: false
      }))
      continue
    }

    if (meta?.kind === 'tool-result') {
      responseParts.push(EffectResponse.makePart('tool-result', {
        id: meta.id,
        name: meta.name,
        result: meta.result,
        encodedResult: meta.result,
        isFailure: meta.isFailure,
        providerExecuted: false
      }))
      continue
    }

    if (msg.role === 'assistant' && responseParts.length > 0) {
      responseParts.push(EffectResponse.makePart('text', { text: msg.content }))
      continue
    }

    flushResponseParts()

    prompt = Prompt.merge(
      prompt,
      Prompt.fromMessages([
        Prompt.makeMessage(msg.role, {
          content: [Prompt.makePart('text', { text: msg.content })]
        })
      ])
    )
  }

  flushResponseParts()

  return prompt
}

export const createPrompt = (messages: SessionMessage[]): Prompt.RawInput =>
  collectPrompt(messages)

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

    const sessionService = yield* SessionService

    const sessionId = yield* SessionService.ensureSession({
      userId: parsed.userId,
      sessionId: parsed.sessionId
    })

    const nextSequence = yield* SessionService.nextMessageSequence(sessionId)

    yield* SessionService.insertSessionMessage({
      message: parsed.message,
      role: 'user',
      sessionId,
      status: 'complete',
      nextSequence
    })

    const session = yield* SessionService.getSession({ userId: parsed.userId, sessionId })
    const prompt = createPrompt(session.messages)

    return makeStreamResponse({
      sessionService,
      prompt,
      sessionId,
      nextSequence: nextSequence + 1
    })
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
