import { Data, Schema } from 'effect'
import { extend } from 'zod/mini'

export class BadRequestError extends Data.TaggedError("BadRequestError")<{
  readonly message: string
}> { }

export class InternalError extends Data.TaggedError("InternalError")<{
  readonly message: string
}> { }

export class SessionOwnershipError extends Data.TaggedError('SessionOwnershipError')<{
  readonly message: string
}> { }

export class SessionNotFoundError extends Data.TaggedError('SessionNotFoundError')<{
  readonly message: string
}> { }

export class MetadataJsonError extends Schema.TaggedError<MetadataJsonError>()(
  'MetadataJsonError',
  {
    message: Schema.String
  }
) { }

export class MetadataShapeError extends Schema.TaggedError<MetadataShapeError>()(
  'MetadataShapeError',
  {
    message: Schema.String
  }
) { }

export class StreamTimeoutError extends Data.TaggedError("StreamTimeoutError")<{
  readonly message: string
}> { }
