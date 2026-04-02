import { For, Show } from "solid-js";
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

  const bubbleState = () => {
    if (bubble.status === "streaming") {
      return { label: "streaming", tone: "accent" as const };
    }

    if (bubble.surface.kind === "tool-call") {
      return { label: "invocation", tone: "accent" as const };
    }

    if (bubble.surface.kind === "tool-result") {
      return {
        label: bubble.surface.outcome === "failure" ? "failure" : "result",
        tone: bubble.surface.outcome === "failure" ? "danger" as const : "success" as const,
      };
    }

    if (bubble.surface.kind === "event" || bubble.status === "error") {
      return { label: "fault", tone: "danger" as const };
    }

    return null;
  };

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
        return (
          <div class="bubble-body">
            <div class="surface-head">
              <div class="surface-title">{bubble.surface.label}</div>
              <code class="surface-meta">{bubble.surface.name}</code>
            </div>
            <Show when={bubble.surface.args.length > 0} fallback={<p class="tool-empty">No arguments.</p>}>
              <dl class="tool-args">
                <For each={bubble.surface.args}>
                  {(arg) => (
                    <div class="tool-arg">
                      <dt>{arg.label}</dt>
                      <dd>{arg.value}</dd>
                    </div>
                  )}
                </For>
              </dl>
            </Show>
          </div>
        );
      case "tool-result":
        return (
          <div class="bubble-body">
            <div class="surface-head">
              <div class="surface-title">{bubble.surface.label}</div>
              <code class="surface-meta">{bubble.surface.name}</code>
            </div>
            <pre class="tool-payload">{bubble.surface.payload || "No structured output."}</pre>
          </div>
        );
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

  const state = bubbleState();

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
      <div class="bubble-chrome">
        <div class="bubble-role">{bubbleLabel(bubble.role)}</div>
        <Show when={state !== null}>
          <span
            class="bubble-state"
            classList={{
              accent: state?.tone === "accent",
              success: state?.tone === "success",
              danger: state?.tone === "danger",
            }}
          >
            {state?.label}
          </span>
        </Show>
      </div>
      {renderSurface()}
    </article>
  )
}
