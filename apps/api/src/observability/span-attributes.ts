import { Effect } from "effect"

export type SpanAttributeValue = string | number | boolean | undefined

export const annotateCurrentSpanAttributes = (
  attributes: Record<string, SpanAttributeValue>
) =>
  Effect.forEach(
    Object.entries(attributes),
    ([key, value]) =>
      value === undefined
        ? Effect.void
        : Effect.annotateCurrentSpan(key, value),
    { discard: true }
  )
