import type { SessionMessageRole } from "../lib/sessions";
import type { Bubble } from "../types";

export function MessageBubble({ bubble }: { bubble: Bubble }) {
  const bubbleLabel = (role: SessionMessageRole) => {
    switch (role) {
      case "assistant":
        return "agent";
      case "tool":
        return "tool";
      case "system":
        return "system";
      case "user":
        return "you";
    }
  };

  return (
    <article
      class="bubble"
      classList={{
        user: bubble.role === "user",
        assistant: bubble.role === "assistant",
        system: bubble.role === "system",
        tool: bubble.role === "tool",
        error: bubble.status === "error",
      }}
    >
      <div class="bubble-role">{bubbleLabel(bubble.role)}</div>
      <p>{bubble.content}</p>
    </article>
  )
}