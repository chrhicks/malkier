export const agentModeValues = ["default", "review"] as const

export type AgentMode = (typeof agentModeValues)[number]
