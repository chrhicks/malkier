import { Agent, layerConfig } from "@malkier/agent"
import { Tracer as OtelTracer } from "@effect/opentelemetry"
import { Config, Effect, Fiber, Layer, Option, Stream } from "effect"
import { Response as EffectResponse } from "@effect/ai"
import type { SpanContext } from "@opentelemetry/api"
import { PostAgentMessageRequest } from "../schema"
import { BadRequestError, InternalError, SessionOwnershipError, StreamTimeoutError } from "../errors"
import { annotateCurrentSpanAttributes } from "../observability/span-attributes"
import { json } from "../request-utils"
import { SessionService, type SessionMessageWithMetadata } from "../service/session.service"
import { Prompt } from "@effect/ai"
import { getAgentTools } from "../agent/tools"
import { HoneycombObservabilityLive } from "../observability/honeycomb"
import withHttpObservability from "../server/http-observability"

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

const withEventSpan = <A, E, R>(
  name: string,
  attributes: Record<string, string | number | boolean | undefined>,
  effect: Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    yield* annotateCurrentSpanAttributes(attributes)
    return yield* effect
  }).pipe(Effect.withSpan(name))

const makeStreamResponse = ({
  userId,
  sessionId,
  prompt,
  promptMessageCount,
  nextSequence,
  sessionService,
  parentSpanContext
}: {
  userId: string
  sessionId: string
  prompt: Prompt.RawInput
  promptMessageCount: number
  nextSequence: number
  sessionService: SessionService
  parentSpanContext?: SpanContext
}) => {
  let fiber: Fiber.RuntimeFiber<void, never> | null = null
  let sequence = nextSequence

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(sseFrame(event, data))
      }

      send('heartbeat', { ok: true })

      const baseStreamEffect = Effect.gen(function* () {
        yield* annotateCurrentSpanAttributes({
          "session.id": sessionId,
          "user.id": userId,
          "agent.stream.sequence_start": nextSequence,
          "agent.prompt.message_count": promptMessageCount
        })

        const agent = yield* Agent
        let agentText = '';
        const toolkit = yield* getAgentTools(userId, sessionService)
        yield* agent.runStream({ prompt, toolkit }).pipe(
          Stream.runForEach((event) => {
            if (event.type === 'text-delta') {
              agentText += event.delta
              return Effect.sync(() => send('agent-event', event))
            }

            if (event.type === 'tool-call') {
              return withEventSpan(
                'agent.tool-call',
                {
                  "session.id": sessionId,
                  "user.id": userId,
                  "tool.name": event.name,
                  "tool.call.id": event.id
                },
                sessionService.insertSessionMessage({
                  sessionId,
                  message: `Calling ${event.name}`,
                  role: 'assistant',
                  status: 'complete',
                  nextSequence: sequence++,
                  metadata: {
                    kind: 'tool-call',
                    id: event.id,
                    name: event.name,
                    params: event.params
                  }
                }).pipe(
                  Effect.zipRight(Effect.sync(() => send('agent-event', event)))
                )
              )
            }

            if (event.type === 'tool-result') {
              return withEventSpan(
                'agent.tool-result',
                {
                  "session.id": sessionId,
                  "user.id": userId,
                  "tool.name": event.name,
                  "tool.call.id": event.id,
                  "tool.result.is_failure": event.isFailure
                },
                sessionService.insertSessionMessage({
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
              return withEventSpan(
                'agent.error',
                {
                  "session.id": sessionId,
                  "user.id": userId,
                  "error.type": 'agent-event',
                  "error.message": event.message
                },
                sessionService.insertSessionMessage({
                  sessionId,
                  message: event.message,
                  role: 'assistant',
                  status: 'error',
                  nextSequence: sequence++
                }).pipe(
                  Effect.zipRight(Effect.sync(() => send('agent-event', event)))
                )
              )
            }

            return Effect.sync(() => send('agent-event', event))
          })
        )
      }).pipe(Effect.withSpan('agent.stream'))

      const streamEffect = parentSpanContext === undefined
        ? baseStreamEffect
        : OtelTracer.withSpanContext(baseStreamEffect, parentSpanContext)

      fiber = Effect.runFork(
        streamEffect.pipe(
          Effect.timeoutFail({
            duration: '20 seconds',
            onTimeout: () => new StreamTimeoutError({ message: 'Request stream timeout after 20 seconds' })
          }),
          Effect.withSpan('request.stream'),
          Effect.provide(Layer.mergeAll(agentLayer, HoneycombObservabilityLive)),
          Effect.catchTags({
            StreamTimeoutError: (cause) =>
              annotateCurrentSpanAttributes({
                "error.type": 'stream-timeout',
                "error.message": cause.message
              }).pipe(
                Effect.zipRight(Effect.sync(() => send('agent-event', { type: 'error', message: cause.message })))
              )
          }),
          // TODO: Add catch tags to handle timeout errors. Letting catchAllCause so i can see stacks in browser
          Effect.catchAllCause((cause) =>
            annotateCurrentSpanAttributes({
              "error.type": 'stream-failure',
              "error.message": cause.toString()
            }).pipe(
              Effect.zipRight(
                sessionService.insertSessionMessage({
                  sessionId,
                  message: cause.toString(),
                  role: 'assistant',
                  status: 'error',
                  nextSequence: sequence++
                }).pipe(
                  Effect.catchAll(() => Effect.void),
                  Effect.zipRight(
                    Effect.sync(() => {
                      send("agent-event", {
                        type: "error",
                        message: cause.toString()
                      })
                    })
                  )
                )
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

export const collectPrompt = (messages: SessionMessageWithMetadata[]): Prompt.RawInput => {
  let prompt = Prompt.empty
  let responseParts: EffectResponse.AnyPart[] = []

  const flushResponseParts = () => {
    if (responseParts.length === 0) return

    prompt = Prompt.merge(prompt, Prompt.fromResponseParts(responseParts))
    responseParts = []
  }

  for (const msg of messages) {
    if (msg.metadata?.kind === 'tool-call') {
      responseParts.push(EffectResponse.makePart('tool-call', {
        id: msg.metadata?.id,
        name: msg.metadata?.name,
        params: msg.metadata?.params,
        providerExecuted: false
      }))
      continue
    }

    if (msg.metadata?.kind === 'tool-result') {
      responseParts.push(EffectResponse.makePart('tool-result', {
        id: msg.metadata?.id,
        name: msg.metadata?.name,
        result: msg.metadata?.result,
        encodedResult: msg.metadata?.result,
        isFailure: msg.metadata?.isFailure,
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

export const createPrompt = (messages: SessionMessageWithMetadata[]): Prompt.RawInput =>
  collectPrompt(messages)

export const postAgentStream = (request: Request) =>
  withHttpObservability(
    'http.post-agent-stream',
    {
      "http.request.method": request.method,
      "http.route": "/api/agent/stream",
      "url.full": request.url
    },
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

      const session = yield* SessionService.ensureSession({
        userId: parsed.userId,
        sessionId: parsed.sessionId
      })

      yield* annotateCurrentSpanAttributes({
        "user.id": parsed.userId,
        "session.id": session.sessionId,
        "session.is_new": session.isNew,
        "message.role": 'user'
      })

      const nextSequence = yield* SessionService.nextMessageSequence(session.sessionId)

      yield* SessionService.insertSessionMessage({
        message: parsed.message,
        role: 'user',
        sessionId: session.sessionId,
        status: 'complete',
        nextSequence
      })

      const loadedSession = yield* SessionService.getSession({
        userId: parsed.userId,
        sessionId: session.sessionId
      })
      const prompt = createPrompt(loadedSession.messages)
      const parentSpan = yield* OtelTracer.currentOtelSpan.pipe(
        Effect.map((span) => span.spanContext()),
        Effect.option
      )

      return makeStreamResponse({
        sessionService,
        prompt,
        promptMessageCount: loadedSession.messages.length,
        userId: parsed.userId,
        sessionId: session.sessionId,
        nextSequence: nextSequence + 1,
        parentSpanContext: Option.match(parentSpan, {
          onNone: () => undefined,
          onSome: (spanContext) => spanContext
        })
      })
    })
  ).pipe(
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
