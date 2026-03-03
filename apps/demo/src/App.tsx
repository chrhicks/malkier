import { useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./styles.css";

type Role = "user" | "assistant";
type TaskState = "pending" | "in_progress" | "completed";

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
};

type TodoItem = {
  id: string;
  label: string;
  state: TaskState;
};

type TerminalLine = {
  id: string;
  kind: "cmd" | "out" | "ok";
  text: string;
};

type DiffFile = {
  path: string;
  summary: string;
  patch: string[];
};

const initialMessage: ChatMessage = {
  id: "boot",
  role: "assistant",
  content:
    "Command deck online. Ask me to explain code or run a bug-fix flow. Try: fix flaky health-check test in payments module.",
};

const initialTasks: TodoItem[] = [
  { id: "inspect", label: "Inspect failing area", state: "pending" },
  { id: "plan", label: "Propose fix plan", state: "pending" },
  { id: "patch", label: "Apply code edits", state: "pending" },
  { id: "verify", label: "Run tests", state: "pending" },
];

const demoDiff: DiffFile[] = [
  {
    path: "packages/payments/src/health.ts",
    summary: "+14 -6",
    patch: [
      "@@ export async function waitForHealthyService(...) @@",
      "-const timeoutMs = 500;",
      "+const timeoutMs = opts.timeoutMs ?? 1500;",
      "-if (status === 'ready') return true;",
      "+if (status === 'ready' || status === 'warm') return true;",
      "+await jitteredBackoff(attempt);",
    ],
  },
  {
    path: "packages/payments/src/health.test.ts",
    summary: "+11 -1",
    patch: [
      "@@ test('returns true during warm transition') @@",
      "+it('accepts warm state before ready', async () => {",
      "+  const result = await waitForHealthyService(mockClient, { timeoutMs: 1200 });",
      "+  expect(result).toBe(true);",
      "+});",
    ],
  },
];

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function App() {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage]);
  const [tasks, setTasks] = useState<TodoItem[]>(initialTasks);
  const [terminal, setTerminal] = useState<TerminalLine[]>([]);
  const [diff, setDiff] = useState<DiffFile[]>([]);
  const idRef = useRef(0);

  const completion = useMemo(() => {
    const done = tasks.filter(item => item.state === "completed").length;
    return Math.round((done / tasks.length) * 100);
  }, [tasks]);

  const nextId = () => {
    idRef.current += 1;
    return `${idRef.current}`;
  };

  const pushMessage = (role: Role, content: string) => {
    setMessages(prev => [...prev, { id: nextId(), role, content }]);
  };

  const pushTerminal = (kind: TerminalLine["kind"], text: string) => {
    setTerminal(prev => [...prev, { id: nextId(), kind, text }]);
  };

  const markTask = (id: string, state: TaskState) => {
    setTasks(prev => prev.map(task => (task.id === id ? { ...task, state } : task)));
  };

  const runScenario = async (userPrompt: string) => {
    setBusy(true);
    setTasks(initialTasks);
    setTerminal([]);
    setDiff([]);

    pushMessage("assistant", "Copy. I will inspect the bug, propose a plan, patch it, then run tests.");

    markTask("inspect", "in_progress");
    pushTerminal("cmd", "$ rg \"health\" packages/payments/src");
    await wait(900);
    pushTerminal("out", "health.ts\nhealth.test.ts\nhealth-client.ts");
    markTask("inspect", "completed");

    markTask("plan", "in_progress");
    await wait(700);
    pushMessage(
      "assistant",
      "Plan: widen the readiness condition to include warm state, increase timeout tolerance, then add one regression test.",
    );
    markTask("plan", "completed");

    markTask("patch", "in_progress");
    pushTerminal("cmd", "$ apply patch to health.ts and health.test.ts");
    await wait(900);
    setDiff(demoDiff);
    pushTerminal("ok", "Patched 2 files successfully");
    markTask("patch", "completed");

    markTask("verify", "in_progress");
    pushTerminal("cmd", "$ bun test packages/payments/src/health.test.ts");
    await wait(950);
    pushTerminal("out", "4 passed, 0 failed, 18 assertions");
    pushTerminal("ok", "Test command exited with code 0");
    markTask("verify", "completed");

    pushMessage(
      "assistant",
      `Done. I fixed the flaky readiness logic and added a regression test. Request: ${userPrompt}`,
    );
    setBusy(false);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || busy) return;

    setMessages(prev => [...prev, { id: nextId(), role: "user", content: text }]);
    setPrompt("");
    void runScenario(text);
  };

  return (
    <div className="deck variant-e">
      <div className="ambient" aria-hidden />

      <header className="topbar">
        <div className="brand">
          <span className="status-dot" />
          Malkier Command Deck
        </div>
        <div className="meta">mocked session | chat-first agent</div>
      </header>

      <main className="layout">
        <section className="panel chat-panel">
          <div className="panel-title">Agent Session</div>
          <div className="chat-log">
            {messages.map(item => (
              <article key={item.id} className={`bubble ${item.role}`}>
                <div className="bubble-role">{item.role === "assistant" ? "agent" : "you"}</div>
                <p>{item.content}</p>
              </article>
            ))}
          </div>

          <form className="composer" onSubmit={submit}>
            <input
              value={prompt}
              onChange={event => setPrompt(event.target.value)}
              placeholder="Ask to explain codebase or fix a bug"
              disabled={busy}
            />
            <button type="submit" disabled={busy}>
              {busy ? "running" : "dispatch"}
            </button>
          </form>
        </section>

        <aside className="stack">
          <section className="panel">
            <div className="panel-title">Task Queue {completion}%</div>
            <ul className="tasks">
              {tasks.map(task => (
                <li key={task.id} className={`task ${task.state}`}>
                  <span className="task-chip">{task.state.replace("_", " ")}</span>
                  <span>{task.label}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <div className="panel-title">Terminal Output</div>
            <div className="terminal">
              {terminal.length === 0 && <p className="placeholder">No commands executed yet.</p>}
              {terminal.map(line => (
                <p key={line.id} className={`line ${line.kind}`}>
                  {line.text}
                </p>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">Diff Preview</div>
            <div className="diff-grid">
              {diff.length === 0 && <p className="placeholder">Patched files will appear here.</p>}
              {diff.map(file => (
                <article key={file.path} className="diff-file">
                  <div className="diff-head">
                    <span>{file.path}</span>
                    <span>{file.summary}</span>
                  </div>
                  <pre>
                    {file.patch.map(line => (
                      <code
                        key={`${file.path}-${line}`}
                        className={line.startsWith("+") ? "add" : line.startsWith("-") ? "remove" : "ctx"}
                      >
                        {line}
                      </code>
                    ))}
                  </pre>
                </article>
              ))}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
