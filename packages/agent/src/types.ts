export interface AgentInput {
  readonly message: string
}

export type AgentEvent =
  | { readonly type: "text-delta"; readonly delta: string }
  | { readonly type: "done" }
  | { readonly type: "error"; readonly message: string }