import { createMemo } from "solid-js";
import type { BubbleArgument } from "../types";
import { getToolResultDisplay, ToolResultBody } from "./ToolResultSurface";

const quoteArg = (value: string) => {
  if (value.length === 0) {
    return '""';
  }

  if (!/\s|["'=]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
};

const formatArgsInline = (args: BubbleArgument[]) =>
  args
    .map((arg) => `${arg.label}=${quoteArg(arg.value)}`)
    .join(" ");

export function ToolComboRow(props: {
  toolName: string;
  args: BubbleArgument[];
  resultPayload: string;
  outcome: "success" | "failure";
}) {
  const summaryLine = createMemo(() => {
    const argsText = formatArgsInline(props.args);
    return `${props.toolName}:${argsText.length > 0 ? ` ${argsText}` : ""}`;
  });

  const resultDisplay = createMemo(() => getToolResultDisplay(props.toolName, props.resultPayload, props.outcome));

  return (
    <details
      class="tool-combo"
      classList={{
        failure: resultDisplay().state === "fail",
        warning: resultDisplay().state === "warn",
      }}
      open={resultDisplay().state !== "ok"}
    >
      <summary class="tool-combo-summary">
        <span class="tool-combo-line">{summaryLine()}</span>
        <span class="tool-combo-status">{resultDisplay().state}</span>
        <span class="tool-combo-caret" aria-hidden="true" />
      </summary>
      <div class="tool-combo-body">
        <ToolResultBody display={resultDisplay()} />
      </div>
    </details>
  );
}
