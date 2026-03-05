import { Data } from 'effect'

export class BadRequestError extends Data.TaggedError("BadRequestError")<{
  readonly message: string
}> { }

export class InternalError extends Data.TaggedError("InternalError")<{
  readonly message: string
}> { }

export class SessionOwnershipError extends Data.TaggedError('SessionOwnershipError')<{
  readonly message: string
}> { }