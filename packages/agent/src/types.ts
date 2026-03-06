import type { Prompt } from "@effect/ai";

export interface AgentInput {
  readonly prompt: Prompt.RawInput
}

export type AgentEvent =
  | { readonly type: "text-delta"; readonly delta: string }
  | { readonly type: "done" }
  | { readonly type: "error"; readonly message: string }