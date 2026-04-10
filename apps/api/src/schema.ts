import * as z from 'zod'
import { agentModeValues } from './agent/agent-mode'

export const PostAgentMessageRequest = z.object({
  userId: z.uuid(),
  sessionId: z.uuid().optional(),
  message: z.string().trim().min(1),
  mode: z.enum(agentModeValues).optional(),
  selectedSkills: z.array(z.string().trim().min(1)).optional(),
})


export const SessionUserQuery = z.object({
  userId: z.uuid(),
})


export const SessionRouteParams = z.object({
  sessionId: z.uuid(),
})


export type PostAgentMessageRequest = z.infer<typeof PostAgentMessageRequest>
export type SessionUserQuery = z.infer<typeof SessionUserQuery>
export type SessionRouteParams = z.infer<typeof SessionRouteParams>
