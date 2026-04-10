import { Agent, layerConfig } from "@malkier/agent"
import { Tracer as OtelTracer } from "@effect/opentelemetry"
import { Cause, Config, Effect, Fiber, Layer, Option, Stream } from "effect"
import type { SpanContext } from "@opentelemetry/api"
import { PostAgentMessageRequest } from "../schema"
import { BadRequestError, InternalError, SessionOwnershipError, StreamTimeoutError } from "../errors"
import { annotateCurrentSpanAttributes } from "../observability/span-attributes"
import { json } from "../request-utils"
import { SessionService } from "../service/session.service"
import { Prompt } from "@effect/ai"
import { getAgentTools } from "../agent/tools"
import { PromptAssembler } from "../agent/prompt-assembler"
import { createPromptRunMetadata } from "../agent/prompt-run-metadata"
import { HoneycombObservabilityLive } from "../observability/honeycomb"
import withHttpObservability from "../server/http-observability"

const encoder = new TextEncoder()
const requestStreamTimeoutDuration = '5 minutes'
const requestStreamTimeoutMessage = `Request stream timeout after ${requestStreamTimeoutDuration}`

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

type StreamStopReason =
  | 'done'
  | 'agent-event-error'
  | 'stream-timeout'
  | 'stream-failure'
  | 'client-cancel'
  | 'server-interrupt'

const getInterruptedStreamStopReason = (cancelledByClient: boolean): Exclude<StreamStopReason, 'done'> =>
  cancelledByClient ? 'client-cancel' : 'server-interrupt'

const getStreamStopReasonFromCause = (
  cause: Cause.Cause<unknown>,
  cancelledByClient: boolean
): Exclude<StreamStopReason, 'done'> =>
  Cause.isInterruptedOnly(cause)
    ? getInterruptedStreamStopReason(cancelledByClient)
    : 'stream-failure'

const getStreamStopMessage = (reason: Exclude<StreamStopReason, 'done'>, cause?: Cause.Cause<unknown>) => {
  switch (reason) {
    case 'agent-event-error':
      return streamFailureMessage
    case 'client-cancel':
      return 'Stream cancelled by client'
    case 'server-interrupt':
      return 'Stream interrupted on server'
    case 'stream-timeout':
      return requestStreamTimeoutMessage
    case 'stream-failure':
      return cause?.toString() ?? streamFailureMessage
  }
}

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
  let agentText = ''
  let cancelledByClient = false
  let streamClosed = false

  const assistantOutputMetadata = (reason: Exclude<StreamStopReason, 'done'>) => ({
    kind: 'assistant-output' as const,
    state: 'partial' as const,
    reason
  })

  const streamErrorMetadata = (reason: Exclude<StreamStopReason, 'done'>) => ({
    kind: 'stream-error' as const,
    reason
  })

  const persistAssistantText = ({
    reason
  }: {
    reason: StreamStopReason
  }) =>
    agentText.length === 0
      ? Effect.succeed(false)
      : sessionService.insertSessionMessage({
        sessionId,
        message: agentText,
        role: 'assistant',
        status: 'complete',
        nextSequence: sequence++,
        metadata: reason === 'done' ? undefined : assistantOutputMetadata(reason)
      }).pipe(
        Effect.as(true)
      )

  const persistStreamError = (reason: Exclude<StreamStopReason, 'done'>, message: string) =>
    sessionService.insertSessionMessage({
      sessionId,
      message,
      role: 'assistant',
      status: 'error',
      nextSequence: sequence++,
      metadata: streamErrorMetadata(reason)
    })

  const annotateStreamOutcome = ({
    reason,
    partialTextPersisted
  }: {
    reason: StreamStopReason
    partialTextPersisted: boolean
  }) =>
    annotateCurrentSpanAttributes({
      'stream.stop_reason': reason,
      'stream.cancelled_by_client': cancelledByClient,
      'stream.partial_text_persisted': partialTextPersisted,
      'stream.partial_text_length': agentText.length,
      'stream.sequence_end': sequence - 1
    })

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (streamClosed) {
          return
        }

        try {
          controller.enqueue(sseFrame(event, data))
        } catch {
          streamClosed = true
        }
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
        const toolkit = yield* getAgentTools(userId, sessionService)
        const toolNames = Object.values(toolkit.tools).map((tool) => tool.name)

        yield* annotateCurrentSpanAttributes({
          "agent.tool.available_count": toolNames.length,
          "agent.tool.names": toolNames.join(",")
        })

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
              return persistAssistantText({ reason: 'done' }).pipe(
                Effect.tap((partialTextPersisted) =>
                  annotateStreamOutcome({
                    reason: 'done',
                    partialTextPersisted
                  })
                ),
                Effect.zipRight(Effect.sync(() => send('agent-event', event)))
              )
            }

            if (event.type === 'error') {
              const message = event.message.length > 0
                ? event.message
                : getStreamStopMessage('agent-event-error')

              return withEventSpan(
                'agent.error',
                {
                  "session.id": sessionId,
                  "user.id": userId,
                  "error.type": 'agent-event',
                  "error.message": message
                },
                persistAssistantText({ reason: 'agent-event-error' }).pipe(
                  Effect.flatMap((partialTextPersisted) =>
                    annotateStreamOutcome({
                      reason: 'agent-event-error',
                      partialTextPersisted
                    }).pipe(
                      Effect.zipRight(persistStreamError('agent-event-error', message))
                    )
                  ),
                  Effect.zipRight(Effect.sync(() => send('agent-event', { ...event, message })))
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
            duration: requestStreamTimeoutDuration,
            onTimeout: () => new StreamTimeoutError({ message: requestStreamTimeoutMessage })
          }),
          Effect.withSpan('request.stream'),
          Effect.provide(Layer.mergeAll(agentLayer, HoneycombObservabilityLive)),
          Effect.catchTags({
            StreamTimeoutError: (cause) =>
              persistAssistantText({ reason: 'stream-timeout' }).pipe(
                Effect.flatMap((partialTextPersisted) =>
                  annotateCurrentSpanAttributes({
                    'error.type': 'stream-timeout',
                    'error.message': cause.message
                  }).pipe(
                    Effect.zipRight(
                      annotateStreamOutcome({
                        reason: 'stream-timeout',
                        partialTextPersisted
                      })
                    ),
                    Effect.zipRight(persistStreamError('stream-timeout', cause.message)),
                    Effect.zipRight(Effect.sync(() => send('agent-event', { type: 'error', message: cause.message })))
                  )
                )
              )
          }),
          Effect.catchAllCause((cause) =>
            Effect.gen(function* () {
              const reason = getStreamStopReasonFromCause(cause, cancelledByClient)
              const message = getStreamStopMessage(reason, cause)
              const partialTextPersisted = yield* persistAssistantText({ reason }).pipe(
                Effect.catchAll(() => Effect.succeed(false))
              )

              yield* annotateCurrentSpanAttributes({
                'error.type': reason,
                'error.message': message,
                'stream.interrupted': Cause.isInterrupted(cause)
              })
              yield* annotateStreamOutcome({ reason, partialTextPersisted })

              yield* persistStreamError(reason, message).pipe(
                Effect.catchAll(() => Effect.void)
              )

              if (reason !== 'client-cancel') {
                yield* Effect.sync(() => {
                  send('agent-event', {
                    type: 'error',
                    message
                  })
                })
              }
            })
          ),
          Effect.ensuring(
            Effect.sync(() => {
              if (!streamClosed) {
                streamClosed = true
                controller.close()
              }
            })
          )
        )
      )
    },
    cancel() {
      cancelledByClient = true
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
        "message.role": 'user',
        "agent.mode.requested": parsed.mode,
        "agent.skills.requested": parsed.selectedSkills?.join(",")
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
      const assembledPrompt = yield* PromptAssembler.assemble({
        messages: loadedSession.messages,
        explicitMode: parsed.mode,
        selectedSkills: parsed.selectedSkills
      }).pipe(Effect.provide(PromptAssembler.Default))
      const promptRunMetadata = createPromptRunMetadata(assembledPrompt)
      yield* SessionService.insertSessionRun({
        sessionId: session.sessionId,
        metadata: promptRunMetadata
      })
      yield* annotateCurrentSpanAttributes({
        "agent.mode.resolved": assembledPrompt.resolvedMode,
        "agent.skills.resolved": assembledPrompt.selectedSkills.join(","),
        "prompt.layer.count": promptRunMetadata.layers.length,
        "prompt.repo.loaded": promptRunMetadata.rootAgentsLoaded
      })
      const parentSpan = yield* OtelTracer.currentOtelSpan.pipe(
        Effect.map((span) => span.spanContext()),
        Effect.option
      )

      return makeStreamResponse({
        sessionService,
        prompt: assembledPrompt.prompt,
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
