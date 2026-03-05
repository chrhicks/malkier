import { streamAgent } from "./lib/agentStream";
import { createSignal, For, Show } from "solid-js";

type Bubble = {
  role: "assistant" | "user";
  content: string;
};

export function App() {
  let prompt!: HTMLInputElement;
  const [bubbles, setBubbles] = createSignal<Bubble[]>([]);
  const [activeBubble, setActiveBubble] = createSignal<Bubble | null>(null);
  const [pending, setPending] = createSignal<boolean>(false);

  const submitPrompt = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!prompt || pending()) return;

    const text = prompt.value.trim();
    if (!text) return;

    setBubbles(prev => [...prev, { role: "user", content: text }]);
    setActiveBubble({ role: "assistant", content: "" });
    setPending(true);
    prompt.value = "";

    try {
      const abortController = new AbortController();
      await streamAgent({
        userId: "a311151e-d40a-4369-94ec-c86fcff67d7c",
        sessionId: "8c4529c2-1d70-4abe-b255-fba16baa15fb",
        message: text,
        onEvent: (event) => {
          if (event.type === "text-delta") {

            setActiveBubble(prev => (
              prev && { ...prev, content: prev.content + event.delta }
            ));
          }
          if (event.type === "done") {
            if (activeBubble()) {
              setBubbles(prev => [...prev, activeBubble()!]);
            }
            setActiveBubble(null);
            setPending(false);
          }
          if (event.type === "error") {
            setBubbles(prev => [...prev, { role: "assistant", content: `Error: ${event.message}` }]);
            setActiveBubble(null);
            setPending(false);
          }
        },
        signal: abortController.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setBubbles(prev => [...prev, { role: "assistant", content: `Error: ${message}` }]);
      setActiveBubble(null);
      setPending(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <div class="deck variant-e">
      <div class="ambient" aria-hidden="true" />

      <header class="topbar">
        <div class="brand">
          <span class="status-dot" />
          Malkier Command Deck
        </div>
        <div class="meta">static solid shell | chat-first agent</div>
      </header>

      <main class="layout">
        <section class="panel chat-panel">
          <div class="panel-title">Agent Session</div>
          <div class="chat-log">
            <For each={bubbles()}>
              {(bubble) => (
                <article class="bubble" classList={{ user: bubble.role === "user", assistant: bubble.role === "assistant" }}>
                  <div class="bubble-role">{bubble.role === "assistant" ? "agent" : "you"}</div>
                  <p>{bubble.content}</p>
                </article>
              )}
            </For>
            <Show when={activeBubble() !== null}>
              <article class="bubble assistant">
                <div class="bubble-role">agent</div>
                <p>{activeBubble()?.content}</p>
              </article>
            </Show>
          </div>

          <form class="composer" onSubmit={submitPrompt}>
            <input ref={prompt} placeholder="Ask to explain codebase or fix a bug" disabled={pending()} />
            <button type="submit" disabled={pending()}>{pending() ? "running" : "dispatch"}</button>
          </form>
        </section>

        <aside class="stack">
          <section class="panel">
            <div class="panel-title">Task Queue 50%</div>
            <ul class="tasks">
              <li class="task completed">
                <span class="task-chip">completed</span>
                <span>Inspect failing area</span>
              </li>
              <li class="task in_progress">
                <span class="task-chip">in progress</span>
                <span>Propose fix plan</span>
              </li>
              <li class="task pending">
                <span class="task-chip">pending</span>
                <span>Apply code edits</span>
              </li>
              <li class="task pending">
                <span class="task-chip">pending</span>
                <span>Run tests</span>
              </li>
            </ul>
          </section>

          <section class="panel">
            <div class="panel-title">Terminal Output</div>
            <div class="terminal">
              <p class="line cmd">$ rg "health" packages/payments/src</p>
              <p class="line out">health.ts
                health.test.ts
                health-client.ts</p>
              <p class="line ok">Patched 2 files successfully</p>
            </div>
          </section>

          <section class="panel">
            <div class="panel-title">Diff Preview</div>
            <div class="diff-grid">
              <article class="diff-file">
                <div class="diff-head">
                  <span>packages/payments/src/health.ts</span>
                  <span>+14 -6</span>
                </div>
                <pre>
                  <code class="ctx">@@ export async function waitForHealthyService(...) @@</code>
                  <code class="remove">-const timeoutMs = 500;</code>
                  <code class="add">+const timeoutMs = opts.timeoutMs ?? 1500;</code>
                  <code class="remove">-if (status === 'ready') return true;</code>
                  <code class="add">+if (status === 'ready' || status === 'warm') return true;</code>
                  <code class="add">+await jitteredBackoff(attempt);</code>
                </pre>
              </article>

              <article class="diff-file">
                <div class="diff-head">
                  <span>packages/payments/src/health.test.ts</span>
                  <span>+11 -1</span>
                </div>
                <pre>
                  <code class="ctx">@@ test('returns true during warm transition') @@</code>
                  <code class="add">+it('accepts warm state before ready', async () =&gt; &#123;</code>
                  <code class="add">
                    + const result = await waitForHealthyService(mockClient, &#123; timeoutMs: 1200 &#125;);
                  </code>
                  <code class="add">+ expect(result).toBe(true);</code>
                  <code class="add">+&#125;);</code>
                </pre>
              </article>
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}

export default App;
