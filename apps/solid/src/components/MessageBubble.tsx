import type { Bubble } from "../types";
import { ToolResultStandalone } from "./ToolResultSurface";

const truncateInline = (value: string, maxLength = 160) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
};

const findArg = (args: { label: string; value: string }[], label: string) =>
  args.find((arg) => arg.label.toLowerCase() === label.toLowerCase())?.value;

const summarizeToolCall = (toolName: string, args: { label: string; value: string }[]) => {
  const lowerName = toolName.toLowerCase();
  const path = findArg(args, "path");
  const query = findArg(args, "query");
  const pattern = findArg(args, "pattern");
  const command = findArg(args, "command");

  if (lowerName.includes("read_file") && path) {
    return `read ${truncateInline(path, 120)}`;
  }

  if (lowerName.includes("search_code") && query) {
    return `search ${truncateInline(query, 120)}`;
  }

  if (lowerName.includes("glob") && pattern) {
    return `glob ${truncateInline(pattern, 120)}`;
  }

  if ((lowerName.includes("shell") || lowerName.includes("bash")) && command) {
    return `run ${truncateInline(command, 120)}`;
  }

  if (args.length === 0) {
    return "no arguments";
  }

  const [firstArg] = args;
  return `${firstArg.label}: ${truncateInline(firstArg.value, 120)}`;
};

export function MessageBubble({ bubble }: { bubble: Bubble }) {
  const renderSurface = () => {
    switch (bubble.surface.kind) {
      case "text":
        return (
          <p class="bubble-text">
            {bubble.status === "streaming" && bubble.surface.text.length === 0
              ? "Waiting for response..."
              : bubble.surface.text}
          </p>
        );
      case "tool-call":
        return <p class="tool-inline-copy">{summarizeToolCall(bubble.surface.name, bubble.surface.args)}</p>;
      case "tool-result": {
        return (
          <ToolResultStandalone
            label={bubble.surface.label}
            toolName={bubble.surface.name}
            payload={bubble.surface.payload}
            outcome={bubble.surface.outcome}
          />
        );
      }
      case "event":
        return (
          <div class="bubble-body">
            <div class="surface-head">
              <div class="surface-title">{bubble.surface.label}</div>
            </div>
            <p class="bubble-text">{bubble.surface.detail || "No additional detail."}</p>
          </div>
        );
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
        streaming: bubble.status === "streaming",
        "surface-text": bubble.surface.kind === "text",
        "surface-tool-call": bubble.surface.kind === "tool-call",
        "surface-tool-result": bubble.surface.kind === "tool-result",
        "surface-event": bubble.surface.kind === "event",
      }}
    >
      {renderSurface()}
    </article>
  )
}
