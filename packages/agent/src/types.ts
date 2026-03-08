import type { Prompt } from "@effect/ai";
import type * as Tool from '@effect/ai/Tool'
import type * as Toolkit from '@effect/ai/Toolkit'

export interface AgentInput<Tools extends Record<string, Tool.Any> = {}> {
  readonly prompt: Prompt.RawInput
  readonly toolkit?: Toolkit.WithHandler<Tools>
}

export type AgentEvent =
  | { readonly type: "text-delta"; readonly delta: string }
  | { readonly type: "done" }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: 'tool-call'; readonly id: string; readonly name: string; readonly params: unknown }
  | { readonly type: 'tool-result'; readonly id: string; readonly name: string; readonly result: unknown; readonly isFailure: boolean }