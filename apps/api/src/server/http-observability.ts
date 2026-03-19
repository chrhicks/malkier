import { Effect } from "effect"
import { annotateCurrentSpanAttributes } from "../observability/span-attributes"

const isSpanAnnotationValue = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"

const normalizeSpanAnnotations = (annotations: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(annotations).flatMap(([key, value]) =>
      isSpanAnnotationValue(value)
        ? [[key, value] as const]
        : []
    )
  )

const annotateResponseStatus = (value: unknown) =>
  value instanceof Response
    ? annotateCurrentSpanAttributes({
        "http.response.status_code": value.status
      })
    : Effect.void

const withHttpObservability = <A, E, R>(
  name: string,
  annotations: Record<string, unknown>,
  effect: Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const spanAnnotations = normalizeSpanAnnotations(annotations)

    yield* annotateCurrentSpanAttributes(spanAnnotations)
    const result = yield* effect
    yield* annotateResponseStatus(result)
    return result
  }).pipe(
    Effect.withSpan(name),
    Effect.annotateLogs(annotations),
    Effect.tapErrorCause((cause) =>
      Effect.logError(name, cause)
    )
  )

export default withHttpObservability
