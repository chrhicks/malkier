import * as z from 'zod'

export const PostAgentMessageRequest = z.object({
  userId: z.uuid(),
  sessionId: z.uuid().optional(),
  message: z.string().trim().min(1),
})


export type PostAgentMessageRequest = z.infer<typeof PostAgentMessageRequest>
