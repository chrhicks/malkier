import { Effect, Schema } from "effect"
import { MetadataJsonError, MetadataShapeError } from "../errors"

export const ToolCall = Schema.Struct({
  kind: Schema.Literal('tool-call'),
  id: Schema.String,
  name: Schema.String,
  params: Schema.Unknown
})

export const ToolCallResult = Schema.Struct({
  kind: Schema.Literal('tool-result'),
  id: Schema.String,
  name: Schema.String,
  result: Schema.Unknown,
  isFailure: Schema.Boolean
})

export const PromptMetadata = Schema.Union(
  ToolCall,
  ToolCallResult
)

export type PromptMetadata = Schema.Schema.Type<typeof PromptMetadata>

export const decodeToolMetadata = (metadata: string) =>
  Effect.try({
    try: () => JSON.parse(metadata),
    catch: (cause) =>
      new MetadataJsonError({
        message: `Invalid persisted metadata JSON: ${String(cause)}`
      })
  }).pipe(
    Effect.flatMap((parsed) =>
      Schema.decodeUnknown(PromptMetadata)(parsed).pipe(
        Effect.mapError(
          () =>
            new MetadataShapeError({
              message: `Persisted metadata does not match PromptMetadata schema`
            })
        )
      )
    )
  )
