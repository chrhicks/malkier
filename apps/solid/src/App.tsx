import { createMemo, createSignal, For, Show, onMount } from "solid-js";
import { streamAgent } from "./lib/agentStream";
import {
  getSession,
  getStoredActiveSessionId,
  getStoredUserId,
  listSessions,
  setStoredActiveSessionId,
  type SessionMessage,
  type SessionMessageRole,
  type SessionMessageStatus,
  type SessionSummary,
} from "./lib/sessions";
import { formatMetadata, formatToolContent } from "./lib/format.util";

type Bubble = {
  role: SessionMessageRole;
  content: string;
  status: SessionMessageStatus;
};

const sessionTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const fallbackSessionTitle = (message: string) => {
  const normalized = message.trim().replace(/\s+/g, " ");
  return normalized.length <= 44 ? normalized : `${normalized.slice(0, 41).trimEnd()}...`;
};

const formatSessionTitle = (session: SessionSummary | null) => session?.title?.trim() || "New session";

const formatSessionTimestamp = (value: string) => sessionTimestampFormatter.format(new Date(value));

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

const fromSessionMessage = (message: SessionMessage): Bubble => {
  const formatted = formatMetadata(message.metadata)

  return ({
    role: message.role,
    content: message.status === "error" ? `Error: ${message.content}` : formatted ?? message.content,
    status: message.status,
  })
}

const sortSessions = (items: SessionSummary[]) =>
  [...items].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());

const upsertSession = (items: SessionSummary[], nextSession: SessionSummary) =>
  sortSessions([nextSession, ...items.filter((session) => session.id !== nextSession.id)]);

export function App() {
  let prompt!: HTMLInputElement;
  let sessionLoadVersion = 0;

  const userId = getStoredUserId();
  const [sessions, setSessions] = createSignal<SessionSummary[]>([]);
  const [bubbles, setBubbles] = createSignal<Bubble[]>([]);
  const [activeBubble, setActiveBubble] = createSignal<Bubble | null>(null);
  const [activeSessionId, setActiveSessionId] = createSignal<string | null>(getStoredActiveSessionId());
  const [pending, setPending] = createSignal(false);
  const [loadingSessions, setLoadingSessions] = createSignal(true);
  const [loadingConversation, setLoadingConversation] = createSignal(false);
  const [statusLine, setStatusLine] = createSignal("Loading persisted sessions...");
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

  const activeSession = createMemo(() => sessions().find((session) => session.id === activeSessionId()) ?? null);

  const rememberActiveSession = (sessionId: string | null) => {
    setActiveSessionId(sessionId);
    setStoredActiveSessionId(sessionId);
  };

  const startNewSession = (focusComposer = true) => {
    sessionLoadVersion += 1;
    rememberActiveSession(null);
    setBubbles([]);
    setActiveBubble(null);
    setErrorMessage(null);
    setStatusLine("New session ready. Send a prompt to create it.");

    if (focusComposer) {
      prompt?.focus();
    }
  };

  const refreshSessions = async () => {
    const nextSessions = sortSessions(await listSessions(userId));
    setSessions(nextSessions);
    return nextSessions;
  };

  const loadSession = async (sessionId: string) => {
    const currentLoad = ++sessionLoadVersion;

    rememberActiveSession(sessionId);
    setLoadingConversation(true);
    setActiveBubble(null);
    setBubbles([]);
    setErrorMessage(null);
    setStatusLine("Loading selected session...");

    try {
      const detail = await getSession(userId, sessionId);

      if (currentLoad !== sessionLoadVersion) {
        return;
      }

      setSessions((previous) => upsertSession(previous, detail.session));
      setBubbles(detail.messages.map(fromSessionMessage));
      setStatusLine(`Loaded ${formatSessionTitle(detail.session)}.`);
    } catch (error) {
      console.error(error)
      if (currentLoad !== sessionLoadVersion) {
        return;
      }

      const message = error instanceof Error ? error.message : "Unknown error";
      setErrorMessage(message);
      setStatusLine("Unable to load the selected session.");
    } finally {
      if (currentLoad === sessionLoadVersion) {
        setLoadingConversation(false);
      }
    }
  };

  onMount(() => {
    void (async () => {
      setLoadingSessions(true);

      try {
        const nextSessions = await refreshSessions();
        const storedSessionId = activeSessionId();
        const initialSessionId =
          storedSessionId !== null && nextSessions.some((session) => session.id === storedSessionId)
            ? storedSessionId
            : nextSessions[0]?.id ?? null;

        if (initialSessionId !== null) {
          await loadSession(initialSessionId);
        } else {
          startNewSession(false);
          setStatusLine("No saved sessions yet. Send a prompt to create one.");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        setErrorMessage(message);
        setStatusLine("Unable to load saved sessions.");
      } finally {
        setLoadingSessions(false);
      }
    })();
  });

  const submitPrompt = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!prompt || pending()) return;

    const text = prompt.value.trim();
    if (!text) return;

    let resolvedSessionId = activeSessionId();
    let assistantText = "";
    let streamErrorMessage: string | null = null;

    setErrorMessage(null);
    setBubbles((previous) => [...previous, { role: "user", content: text, status: "complete" }]);
    setActiveBubble({ role: "assistant", content: "", status: "streaming" });
    setPending(true);
    setStatusLine(resolvedSessionId === null ? "Creating a new session..." : "Streaming response...");
    prompt.value = "";

    const commitAssistantText = () => {
      if (assistantText.trim().length > 0) {
        setBubbles((previous) => [
          ...previous,
          {
            role: 'assistant', content: assistantText, status: 'complete'
          }
        ])
        assistantText = ''
      }
      setActiveBubble(null)
    }

    try {
      const abortController = new AbortController();

      await streamAgent({
        userId,
        sessionId: resolvedSessionId ?? undefined,
        message: text,
        onSession: (sessionId) => {
          resolvedSessionId = sessionId;
          rememberActiveSession(sessionId);
          setSessions((previous) => {
            const existing = previous.find((session) => session.id === sessionId) ?? null;

            return upsertSession(previous, {
              id: sessionId,
              userId,
              title: existing?.title ?? fallbackSessionTitle(text),
              status: existing?.status ?? "active",
              createdAt: existing?.createdAt ?? new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          });
          setStatusLine("Session established. Streaming response...");
        },
        onEvent: (streamEvent) => {
          if (streamEvent.type === "text-delta") {
            assistantText += streamEvent.delta;
            setActiveBubble({ role: "assistant", content: assistantText, status: "streaming" });
            return;
          }

          if (streamEvent.type === 'tool-call') {
            commitAssistantText()
            setBubbles((previous) => [...previous, {
              role: 'assistant',
              content: formatToolContent(streamEvent),
              status: 'complete'
            }])
            return
          }

          if (streamEvent.type === 'tool-result') {
            commitAssistantText()
            setBubbles((previous) => [...previous, {
              role: 'tool',
              content: formatToolContent(streamEvent),
              status: 'complete'
            }])
            return
          }

          if (streamEvent.type === "error") {
            commitAssistantText()
            streamErrorMessage = streamEvent.message;
          }
        },
        signal: abortController.signal,
      });

      commitAssistantText()

      if (streamErrorMessage !== null) {
        setBubbles((previous) => [
          ...previous,
          { role: "assistant", content: `Error: ${streamErrorMessage}`, status: "error" },
        ]);
        setErrorMessage(streamErrorMessage);
        setStatusLine("Stream finished with an error.");
      } else {
        setStatusLine("Response complete. Refreshing persisted session data...");
      }

      try {
        const nextSessions = await refreshSessions();
        const sessionToHydrate =
          resolvedSessionId !== null && nextSessions.some((session) => session.id === resolvedSessionId)
            ? resolvedSessionId
            : nextSessions[0]?.id ?? null;

        if (sessionToHydrate !== null) {
          await loadSession(sessionToHydrate);
        } else {
          startNewSession(false);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        setErrorMessage(message);
        setStatusLine("The stream finished, but refreshing saved sessions failed.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setBubbles((previous) => [
        ...previous,
        { role: "assistant", content: `Error: ${message}`, status: "error" },
      ]);
      setActiveBubble(null);
      setErrorMessage(message);
      setStatusLine("Request failed before the stream could finish.");
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
        <div class="meta">sqlite-backed sessions | solid chat console</div>
      </header>

      <main class="layout">
        <section class="panel chat-panel">
          <div class="panel-title panel-title-row">
            <span>{formatSessionTitle(activeSession())}</span>
            <span class="panel-note">
              {pending() ? "streaming" : loadingConversation() ? "loading" : `${bubbles().length} saved messages`}
            </span>
          </div>

          <div class="chat-log">
            <Show
              when={!loadingConversation() || bubbles().length > 0 || activeBubble() !== null}
              fallback={<p class="empty-state">Loading the selected session...</p>}
            >
              <Show
                when={bubbles().length > 0 || activeBubble() !== null}
                fallback={<p class="empty-state">No conversation yet. Start a new session from the prompt below.</p>}
              >
                <For each={bubbles()}>
                  {(bubble) => (
                    <article
                      class="bubble"
                      classList={{
                        user: bubble.role === "user",
                        assistant: bubble.role === "assistant",
                        system: bubble.role === "system",
                        tool: bubble.role === "tool",
                        error: bubble.status === "error",
                      }}
                    >
                      <div class="bubble-role">{bubbleLabel(bubble.role)}</div>
                      <p>{bubble.content}</p>
                    </article>
                  )}
                </For>
                <Show when={activeBubble() !== null}>
                  <article class="bubble assistant active-stream">
                    <div class="bubble-role">agent</div>
                    <p>{activeBubble()?.content || "Waiting for response..."}</p>
                  </article>
                </Show>
              </Show>
            </Show>
          </div>

          <form class="composer" onSubmit={submitPrompt}>
            <input
              ref={prompt}
              placeholder="Ask Malkier to explain code, debug, or ship a fix"
              disabled={pending()}
            />
            <button type="submit" disabled={pending()}>{pending() ? "running" : "dispatch"}</button>
          </form>
        </section>

        <aside class="stack">
          <section class="panel session-panel">
            <div class="panel-title panel-title-row">
              <span>Sessions</span>
              <button type="button" class="ghost-button" onClick={() => startNewSession()} disabled={pending()}>
                New session
              </button>
            </div>

            <div class="session-list">
              <Show
                when={!loadingSessions()}
                fallback={<p class="empty-state">Loading saved sessions...</p>}
              >
                <Show
                  when={sessions().length > 0}
                  fallback={<p class="empty-state">No persisted sessions yet. Your first prompt will create one.</p>}
                >
                  <For each={sessions()}>
                    {(session) => (
                      <button
                        type="button"
                        class="session-card"
                        classList={{ active: session.id === activeSessionId() }}
                        disabled={pending()}
                        onClick={() => {
                          void loadSession(session.id);
                        }}
                      >
                        <span class="session-title">{formatSessionTitle(session)}</span>
                        <span class="session-meta">updated {formatSessionTimestamp(session.updatedAt)}</span>
                      </button>
                    )}
                  </For>
                </Show>
              </Show>
            </div>
          </section>

          <section class="panel">
            <div class="panel-title">Session Status</div>
            <dl class="facts">
              <div class="fact">
                <dt>Current</dt>
                <dd>{activeSessionId() ?? "unsaved"}</dd>
              </div>
              <div class="fact">
                <dt>User</dt>
                <dd>{userId}</dd>
              </div>
              <div class="fact">
                <dt>Mode</dt>
                <dd>{pending() ? "streaming" : activeSession() ? activeSession()!.status : "draft"}</dd>
              </div>
              <div class="fact">
                <dt>Messages</dt>
                <dd>{bubbles().length + (activeBubble() !== null ? 1 : 0)}</dd>
              </div>
            </dl>
          </section>

          <section class="panel">
            <div class="panel-title">Persistence Notes</div>
            <div class="status-copy">{statusLine()}</div>
            <Show when={errorMessage() !== null}>
              <div class="status-copy danger">{errorMessage()}</div>
            </Show>
            <div class="status-copy muted">
              Sessions now load from SQLite, keep their own message history, and can be revisited from the sidebar.
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}

export default App;