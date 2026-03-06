import * as z from 'zod'

export const PostAgentMessageRequest = z.object({
  userId: z.uuid(),
  sessionId: z.uuid().optional(),
  message: z.string().trim().min(1),
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
