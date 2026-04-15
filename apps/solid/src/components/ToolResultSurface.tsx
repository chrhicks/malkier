import { For, Show, createMemo } from "solid-js";
import {
  humanizeApplyPatchReason,
  parseApplyPatchToolDisplay,
  parseReadFileToolSuccessDisplay,
  type ApplyPatchToolDisplay,
  type ReadFileToolSuccessDisplay,
} from "../lib/format.util";
import { UnifiedDiffView } from "./UnifiedDiffView";

type ToolResultState = "ok" | "warn" | "fail";

export type ToolResultDisplay = {
  kind: "read-file" | "apply-patch-success" | "apply-patch-guidance" | "generic";
  summary: string;
  meta: string;
  state: ToolResultState;
  defaultOpen: boolean;
  payload: string;
  readFile: ReadFileToolSuccessDisplay | null;
  applyPatch: ApplyPatchToolDisplay | null;
};

const countLines = (value: string) => value.split(/\r?\n/).length;

const truncateInline = (value: string, maxLength = 160) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
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

const shouldExpandToolResult = (payload: string) => payload.length <= 320 && countLines(payload) <= 10;

const shouldExpandReadFileResult = (content: string) => countLines(content) <= 48 && content.length <= 16000;

const shouldExpandApplyPatchResult = (patch: ApplyPatchToolDisplay) => {
  if (patch.kind === "guidance") {
    return true;
  }

  const diffChars = patch.files.reduce((sum, file) => sum + (file.unifiedDiff?.length ?? 0), 0);
  return patch.files.length <= 8 && diffChars <= 14_000;
};

const truncateSnapshotId = (id: string) => (id.length <= 14 ? id : `${id.slice(0, 10)}...`);

export const getToolResultDisplay = (
  toolName: string,
  payload: string,
  outcome: "success" | "failure",
): ToolResultDisplay => {
  const readFile = parseReadFileToolSuccessDisplay(toolName, payload);
  const applyPatch = readFile === null ? parseApplyPatchToolDisplay(toolName, payload) : null;

  if (readFile !== null) {
    return {
      kind: "read-file",
      summary: summarizeToolResult(payload),
      meta: `${countLines(readFile.content)} lines`,
      state: outcome === "failure" ? "fail" : "ok",
      defaultOpen: shouldExpandReadFileResult(readFile.content),
      payload,
      readFile,
      applyPatch: null,
    };
  }

  if (applyPatch?.kind === "success") {
    return {
      kind: "apply-patch-success",
      summary: summarizeToolResult(payload),
      meta: `${applyPatch.files.length} file${applyPatch.files.length === 1 ? "" : "s"}`,
      state: outcome === "failure" ? "fail" : "ok",
      defaultOpen: shouldExpandApplyPatchResult(applyPatch),
      payload,
      readFile: null,
      applyPatch,
    };
  }

  if (applyPatch?.kind === "guidance") {
    return {
      kind: "apply-patch-guidance",
      summary: summarizeToolResult(payload),
      meta: `${applyPatch.files.length} file${applyPatch.files.length === 1 ? "" : "s"}`,
      state: "warn",
      defaultOpen: true,
      payload,
      readFile: null,
      applyPatch,
    };
  }

  return {
    kind: "generic",
    summary: summarizeToolResult(payload),
    meta: `${countLines(payload)} lines`,
    state: outcome === "failure" ? "fail" : "ok",
    defaultOpen: shouldExpandToolResult(payload),
    payload,
    readFile: null,
    applyPatch: null,
  };
};

export function ToolResultBody(props: { display: ToolResultDisplay }) {
  const display = props.display;

  if (display.kind === "read-file" && display.readFile !== null) {
    const readFile = display.readFile;

    return (
      <>
        <div class="tool-file-source">
          <code class="tool-file-path">{readFile.path || "-"}</code>
          <span class="tool-file-lines">
            L{readFile.startLine}-{readFile.endLine} of {readFile.totalLines}
          </span>
          <Show when={readFile.truncated}>
            <span class="tool-file-truncated">truncated</span>
          </Show>
        </div>
        <pre class="tool-payload tool-payload-file">
          <code>{readFile.content}</code>
        </pre>
      </>
    );
  }

  if (display.kind === "apply-patch-success" && display.applyPatch?.kind === "success") {
    const applyPatch = display.applyPatch;

    return (
      <ul class="tool-patch-file-list">
        <For each={applyPatch.files}>
          {(file) => (
            <li class="tool-patch-file-row">
              <div class="tool-patch-file-head">
                <code class="tool-file-path">{file.path}</code>
                <div class="tool-patch-metrics" title="Lines added / removed">
                  <span class="tool-patch-added">+{file.addedLines}</span>
                  <span class="tool-patch-removed">-{file.removedLines}</span>
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
    );
  }

  if (display.kind === "apply-patch-guidance" && display.applyPatch?.kind === "guidance") {
    const applyPatch = display.applyPatch;

    return (
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
    );
  }

  return <pre class="tool-payload">{display.payload || "No structured output."}</pre>;
}

export function ToolResultStandalone(props: {
  label: string;
  toolName: string;
  payload: string;
  outcome: "success" | "failure";
}) {
  const display = createMemo(() => getToolResultDisplay(props.toolName, props.payload, props.outcome));

  return (
    <details
      class="tool-surface"
      classList={{ "tool-surface-guidance": display().kind === "apply-patch-guidance" }}
      open={display().state !== "ok" || display().defaultOpen}
    >
      <summary class="tool-summary">
        <div class="surface-head">
          <div class="surface-title">{props.label}</div>
          <code class="surface-meta">{props.toolName}</code>
        </div>
        <div class="tool-summary-row">
          <p class="tool-summary-copy">{display().summary}</p>
          <span class="tool-summary-meta">{`${display().meta} | ${display().state}`}</span>
        </div>
      </summary>
      <div class="tool-surface-panel">
        <ToolResultBody display={display()} />
      </div>
    </details>
  );
}
