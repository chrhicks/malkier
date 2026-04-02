import type { SessionMessageRole, SessionMessageStatus } from "./lib/sessions";

export type BubbleArgument = {
  label: string;
  value: string;
};

export type BubbleSurface =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "tool-call";
      label: string;
      name: string;
      args: BubbleArgument[];
    }
  | {
      kind: "tool-result";
      label: string;
      name: string;
      payload: string;
      outcome: "success" | "failure";
    }
  | {
      kind: "event";
      label: string;
      detail: string;
    };

export type Bubble = {
  role: SessionMessageRole;
  status: SessionMessageStatus;
  surface: BubbleSurface;
};
