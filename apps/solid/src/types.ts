import type { SessionMessageRole, SessionMessageStatus } from "./lib/sessions";

export type Bubble = {
  role: SessionMessageRole;
  content: string;
  status: SessionMessageStatus;
};
