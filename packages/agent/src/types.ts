import type { AiError, Prompt } from "@effect/ai";
import type * as Tool from '@effect/ai/Tool'
import type * as Toolkit from '@effect/ai/Toolkit'
import type { AgentMaxTurnsExceededError, StreamTimeoutError, TurnTimeoutError } from "./errors";

export interface AgentInput<Tools extends Record<string, Tool.Any> = {}> {
  readonly prompt: Prompt.RawInput
  readonly toolkit?: Toolkit.WithHandler<Tools>
  readonly toolChoice?: "auto" | "none" | "required" | {
    readonly tool: string
  } | {
    readonly mode?: "auto" | "required"
    readonly oneOf: ReadonlyArray<string>
  }
}

export type AgentEvent =
  | { readonly type: "text-delta"; readonly delta: string }
  | { readonly type: "done"; }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: 'tool-call'; readonly id: string; readonly name: string; readonly params: unknown }
  | { readonly type: 'tool-result'; readonly id: string; readonly name: string; readonly result: unknown; readonly isFailure: boolean }

export type AgentStreamError =
  | AiError.AiError
  | StreamTimeoutError
  | TurnTimeoutError
  | AgentMaxTurnsExceededError
