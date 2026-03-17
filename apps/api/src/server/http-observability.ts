import { Effect } from "effect"


const withHttpObservability = <A, E, R>(
  name: string,
  annotationns: Record<string, unknown>,
  effect: Effect.Effect<A, E, R>
) =>
  effect.pipe(
    Effect.withSpan(name),
    Effect.annotateLogs(annotationns),
    Effect.tapErrorCause((cause) =>
      Effect.logError(name, cause)
    )
  )

export default withHttpObservability