import { For, Show } from "solid-js";
import {
  humanizeApplyPatchReason,
  parseApplyPatchToolDisplay,
  parseReadFileToolSuccessDisplay,
} from "../lib/format.util";
import type { SessionMessageRole } from "../lib/sessions";
import type { Bubble } from "../types";
import { UnifiedDiffView } from "./UnifiedDiffView";

const countLines = (value: string) => value.split(/\r?\n/).length;

const truncateInline = (value: string, maxLength = 160) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
};

const summarizeToolCall = (args: { label: string; value: string }[]) => {
  if (args.length === 0) {
    return "No arguments.";
  }

  const [firstArg] = args;
  return `${args.length} arg${args.length === 1 ? "" : "s"} | ${firstArg.label}: ${truncateInline(firstArg.value, 96)}`;
};

const summarizeToolResult = (payload: string) => {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const message = typeof parsed.message === "string" ? parsed.message : null;
    const status = typeof parsed.status === "string" ? parsed.status : typeof parsed.kind === "string" ? parsed.kind : null;

    if (status !== null && message !== null) {
      return `${status}: ${message}`;
    }

    if (message !== null) {
      return message;
    }
  } catch {
    // Fall back to the first visible line when the payload is not JSON.
  }

  const firstLine = payload
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstLine ? truncateInline(firstLine) : "No structured output.";
};

const shouldExpandToolCall = (args: { label: string; value: string }[]) =>
  args.length === 0 || (args.length <= 2 && args.every((arg) => arg.value.length <= 96));

const shouldExpandToolResult = (payload: string) => payload.length <= 320 && countLines(payload) <= 10;

const shouldExpandReadFileResult = (content: string) => countLines(content) <= 48 && content.length <= 16000;

const shouldExpandApplyPatchResult = (patch: NonNullable<ReturnType<typeof parseApplyPatchToolDisplay>>) => {
  if (patch.kind === "guidance") {
    return true;
  }
  const diffChars = patch.files.reduce((sum, f) => sum + (f.unifiedDiff?.length ?? 0), 0);
  return patch.files.length <= 8 && diffChars <= 14_000;
};

const truncateSnapshotId = (id: string) => (id.length <= 14 ? id : `${id.slice(0, 10)}…`);

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
          <details class="tool-surface" open={shouldExpandToolCall(bubble.surface.args)}>
            <summary class="tool-summary">
              <div class="surface-head">
                <div class="surface-title">{bubble.surface.label}</div>
                <code class="surface-meta">{bubble.surface.name}</code>
              </div>
              <p class="tool-summary-copy">{summarizeToolCall(bubble.surface.args)}</p>
            </summary>
            <div class="tool-surface-panel">
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
          </details>
        );
      case "tool-result": {
        const payload = bubble.surface.payload;
        const readFile = parseReadFileToolSuccessDisplay(bubble.surface.name, payload);
        const applyPatch =
          readFile === null ? parseApplyPatchToolDisplay(bubble.surface.name, payload) : null;

        const panelOpen =
          readFile !== null
            ? shouldExpandReadFileResult(readFile.content)
            : applyPatch !== null
              ? shouldExpandApplyPatchResult(applyPatch)
              : shouldExpandToolResult(payload);

        const summaryMeta =
          readFile !== null
            ? `${countLines(readFile.content)} lines`
            : applyPatch !== null
              ? `${applyPatch.files.length} file${applyPatch.files.length === 1 ? "" : "s"}`
              : `${countLines(payload)} lines`;

        return (
          <details
            class="tool-surface"
            classList={{ "tool-surface-guidance": applyPatch?.kind === "guidance" }}
            open={panelOpen}
          >
            <summary class="tool-summary">
              <div class="surface-head">
                <div class="surface-title">{bubble.surface.label}</div>
                <code class="surface-meta">{bubble.surface.name}</code>
              </div>
              <div class="tool-summary-row">
                <p class="tool-summary-copy">{summarizeToolResult(payload)}</p>
                <span class="tool-summary-meta">{summaryMeta}</span>
              </div>
            </summary>
            <div class="tool-surface-panel">
              {readFile ? (
                <>
                  <div class="tool-file-source">
                    <code class="tool-file-path">{readFile.path || "—"}</code>
                    <span class="tool-file-lines">
                      L{readFile.startLine}–{readFile.endLine} of {readFile.totalLines}
                    </span>
                    <Show when={readFile.truncated}>
                      <span class="tool-file-truncated">truncated</span>
                    </Show>
                  </div>
                  <pre class="tool-payload tool-payload-file">
                    <code>{readFile.content}</code>
                  </pre>
                </>
              ) : applyPatch?.kind === "success" ? (
                <ul class="tool-patch-file-list">
                  <For each={applyPatch.files}>
                    {(file) => (
                      <li class="tool-patch-file-row">
                        <div class="tool-patch-file-head">
                          <code class="tool-file-path">{file.path}</code>
                          <div class="tool-patch-metrics" title="Lines added / removed">
                            <span class="tool-patch-added">+{file.addedLines}</span>
                            <span class="tool-patch-removed">−{file.removedLines}</span>
                          </div>
                          <code class="tool-patch-snapshot" title={file.snapshotId}>
                            {truncateSnapshotId(file.snapshotId)}
                          </code>
                        </div>
                        <Show when={file.unifiedDiff}>{(getDiff) => <UnifiedDiffView text={getDiff()} />}</Show>
                      </li>
                    )}
                  </For>
                </ul>
              ) : applyPatch?.kind === "guidance" ? (
                <>
                  <p class="tool-patch-lead tool-patch-lead-warn">{applyPatch.message}</p>
                  <p class="tool-patch-primary-reason">{humanizeApplyPatchReason(applyPatch.primaryReason)}</p>
                  <dl class="tool-patch-guidance-list">
                    <For each={applyPatch.files}>
                      {(file) => (
                        <div class="tool-patch-guidance-row">
                          <dt>
                            <code class="tool-file-path">{file.path}</code>
                          </dt>
                          <dd>{humanizeApplyPatchReason(file.reason)}</dd>
                        </div>
                      )}
                    </For>
                  </dl>
                </>
              ) : (
                <pre class="tool-payload">{payload || "No structured output."}</pre>
              )}
            </div>
          </details>
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
