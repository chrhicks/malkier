import { Data } from "effect"

export class StreamTimeoutError extends Data.TaggedError('StreamTimeoutError')<{
  readonly message: string
}> { }

export class TurnTimeoutError extends Data.TaggedError('TurnTimeoutError')<{
  readonly message: string
}> { }

export class AgentMaxTurnsExceededError extends Data.TaggedError('AgentMaxTurnsExceededError')<{
  readonly maxTurns: number,
  readonly message: string
}> { }