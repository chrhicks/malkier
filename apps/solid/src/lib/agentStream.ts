export type AgentEvent =
  | { readonly type: "text-delta"; readonly delta: string }
  | { readonly type: "done" }
  | { readonly type: "error"; readonly message: string }

export interface StreamAgentOptions {
  readonly userId: string
  readonly sessionId?: string
  readonly message: string
  readonly onSession?: (sessionId: string) => void
  readonly onEvent: (event: AgentEvent) => void
  readonly signal?: AbortSignal
  readonly endpoint?: string
}

const parseSseChunk = (chunk: string): Array<{ event: string; data: string }> => {
  const frames = chunk.split("\n\n")
  const parsed: Array<{ event: string; data: string }> = []

  for (const frame of frames) {
    const trimmed = frame.trim()
    if (trimmed.length === 0) {
      continue
    }

    const lines = trimmed.split("\n")
    let event = "message"
    const dataLines: string[] = []

    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim()
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim())
      }
    }

    parsed.push({ event, data: dataLines.join("\n") })
  }

  return parsed
}

export const streamAgent = async (options: StreamAgentOptions): Promise<void> => {
  const response = await fetch(options.endpoint ?? "/api/agent/stream", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ userId: options.userId, sessionId: options.sessionId, message: options.message }),
    signal: options.signal
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Agent request failed with status ${response.status}`)
  }

  const sessionId = response.headers.get("x-session-id")
  if (sessionId !== null) {
    options.onSession?.(sessionId)
  }

  if (response.body === null) {
    throw new Error("Agent stream response body is empty")
  }

  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })

    const boundary = buffer.lastIndexOf("\n\n")
    if (boundary === -1) {
      continue
    }

    const complete = buffer.slice(0, boundary)
    buffer = buffer.slice(boundary + 2)

    const frames = parseSseChunk(complete)
    for (const frame of frames) {
      if (frame.event !== "agent-event") {
        continue
      }

      const event = JSON.parse(frame.data) as AgentEvent
      options.onEvent(event)
    }
  }

  if (buffer.trim().length > 0) {
    const frames = parseSseChunk(buffer)
    for (const frame of frames) {
      if (frame.event !== "agent-event") {
        continue
      }

      const event = JSON.parse(frame.data) as AgentEvent
      options.onEvent(event)
    }
  }
}
