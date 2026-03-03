function App() {
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
            <article class="bubble assistant">
              <div class="bubble-role">agent</div>
              <p>
                Command deck online. Ask me to explain code or run a bug-fix flow. Try: fix
                flaky health-check test in payments module.
              </p>
            </article>

            <article class="bubble user">
              <div class="bubble-role">you</div>
              <p>Fix flaky health-check test in payments module.</p>
            </article>

            <article class="bubble assistant">
              <div class="bubble-role">agent</div>
              <p>
                Copy. I will inspect the bug, propose a plan, patch it, then run tests.
              </p>
            </article>
          </div>

          <form class="composer">
            <input placeholder="Ask to explain codebase or fix a bug" />
            <button type="button">dispatch</button>
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
