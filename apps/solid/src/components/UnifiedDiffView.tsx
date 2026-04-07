import { For, createMemo } from "solid-js";

export type DiffLineKind = "meta" | "file" | "hunk" | "add" | "del" | "ctx" | "empty" | "unknown";

/** Classify a single line of unified diff text (git-style). */
export const classifyDiffLine = (line: string): DiffLineKind => {
  if (line.length === 0) {
    return "empty";
  }

  if (line.startsWith("Index:")) {
    return "meta";
  }

  if (line.startsWith("===")) {
    return "meta";
  }

  if (line.startsWith("---")) {
    return "file";
  }

  if (line.startsWith("+++")) {
    return "file";
  }

  if (line.startsWith("@@")) {
    return "hunk";
  }

  if (line.startsWith("+")) {
    return "add";
  }

  if (line.startsWith("-")) {
    return "del";
  }

  if (line.startsWith(" ") || line.startsWith("\t")) {
    return "ctx";
  }

  return "unknown";
};

export function UnifiedDiffView(props: { readonly text: string }) {
  const lines = createMemo(() => props.text.split(/\r?\n/));

  return (
    <div class="tool-patch-diff tool-diff-panel">
      <div class="tool-diff-lines" role="region" aria-label="Unified diff">
        <For each={lines()}>
          {(line) => {
            const kind = classifyDiffLine(line);
            return (
              <div
                class="tool-diff-line"
                classList={{
                  "tool-diff-line-meta": kind === "meta",
                  "tool-diff-line-file": kind === "file",
                  "tool-diff-line-hunk": kind === "hunk",
                  "tool-diff-line-add": kind === "add",
                  "tool-diff-line-del": kind === "del",
                  "tool-diff-line-ctx": kind === "ctx",
                  "tool-diff-line-empty": kind === "empty",
                  "tool-diff-line-unknown": kind === "unknown",
                }}
              >
                <span class="tool-diff-line-text">{kind === "empty" ? "\u00a0" : line}</span>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
