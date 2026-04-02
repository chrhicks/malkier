import { createMemo, createSignal, For, Show, onMount } from "solid-js";
import { streamAgent, type AgentEvent } from "./lib/agentStream";
import {
  getSession,
  getStoredActiveSessionId,
  getStoredUserId,
  listSessions,
  setStoredActiveSessionId,
  type SessionSummary,
} from "./lib/sessions";
import { bubbleFromAgentEvent, bubblesFromSessionMessages, errorBubble, textBubble } from "./lib/format.util";
import type { Bubble } from "./types";
import { MessageBubble } from "./components/MessageBubble";

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


const sortSessions = (items: SessionSummary[]) =>
  [...items].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());

const upsertSession = (items: SessionSummary[], nextSession: SessionSummary) =>
  sortSessions([nextSession, ...items.filter((session) => session.id !== nextSession.id)]);

const resolveSessionToHydrate = (items: SessionSummary[], preferredSessionId: string | null) =>
  preferredSessionId !== null && items.some((session) => session.id === preferredSessionId)
    ? preferredSessionId
    : items[0]?.id ?? null;

const createAssistantStreamController = (options: {
  appendBubble: (bubble: Bubble) => void;
  setActiveBubble: (bubble: Bubble | null) => void;
}) => {
  let assistantText = "";
  let streamErrorMessage: string | null = null;

  const flushText = () => {
    if (assistantText.trim().length > 0) {
      options.appendBubble(textBubble("assistant", assistantText, "complete"));
      assistantText = "";
    }

    options.setActiveBubble(null);
  };

  return {
    start() {
      assistantText = "";
      streamErrorMessage = null;
      options.setActiveBubble(textBubble("assistant", "", "streaming"));
    },
    handleEvent(event: AgentEvent) {
      if (event.type === "text-delta") {
        assistantText += event.delta;
        options.setActiveBubble(textBubble("assistant", assistantText, "streaming"));
        return;
      }

      if (event.type === "tool-call" || event.type === "tool-result") {
        flushText();
        const bubble = bubbleFromAgentEvent(event);
        if (bubble !== null) {
          options.appendBubble(bubble);
        }
        return;
      }

      if (event.type === "error") {
        flushText();
        streamErrorMessage = event.message;
      }
    },
    finish() {
      flushText();
      const detail = streamErrorMessage;
      streamErrorMessage = null;
      return detail;
    },
    clear() {
      assistantText = "";
      streamErrorMessage = null;
      options.setActiveBubble(null);
    },
  };
};

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

  const resetConversationState = () => {
    setBubbles([]);
    setActiveBubble(null);
    setErrorMessage(null);
  };

  const appendBubble = (bubble: Bubble) => {
    setBubbles((previous) => [...previous, bubble]);
  };

  const startNewSession = (
    focusComposer = true,
    nextStatusLine = "New session ready. Send a prompt to create it.",
  ) => {
    sessionLoadVersion += 1;
    rememberActiveSession(null);
    resetConversationState();
    setStatusLine(nextStatusLine);

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
    resetConversationState();
    setStatusLine("Loading selected session...");

    try {
      const detail = await getSession(userId, sessionId);

      if (currentLoad !== sessionLoadVersion) {
        return;
      }

      setSessions((previous) => upsertSession(previous, detail.session));
      setBubbles(bubblesFromSessionMessages(detail.messages));
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

  const refreshAndHydrateSession = async (
    preferredSessionId: string | null,
    emptyStatusLine = "New session ready. Send a prompt to create it.",
  ) => {
    const nextSessions = await refreshSessions();
    const sessionToHydrate = resolveSessionToHydrate(nextSessions, preferredSessionId);

    if (sessionToHydrate !== null) {
      await loadSession(sessionToHydrate);
      return;
    }

    startNewSession(false, emptyStatusLine);
  };

  onMount(() => {
    void (async () => {
      setLoadingSessions(true);

      try {
        await refreshAndHydrateSession(activeSessionId(), "No saved sessions yet. Send a prompt to create one.");
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
    const streamController = createAssistantStreamController({
      appendBubble,
      setActiveBubble,
    });

    setErrorMessage(null);
    appendBubble(textBubble("user", text, "complete"));
    streamController.start();
    setPending(true);
    setStatusLine(resolvedSessionId === null ? "Creating a new session..." : "Streaming response...");
    prompt.value = "";

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
          streamController.handleEvent(streamEvent);
        },
        signal: abortController.signal,
      });

      const streamErrorMessage = streamController.finish();

      if (streamErrorMessage !== null) {
        appendBubble(errorBubble("assistant", streamErrorMessage));
        setErrorMessage(streamErrorMessage);
        setStatusLine("Stream finished with an error.");
      } else {
        setStatusLine("Response complete. Refreshing persisted session data...");
      }

      try {
        await refreshAndHydrateSession(resolvedSessionId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        setErrorMessage(message);
        setStatusLine("The stream finished, but refreshing saved sessions failed.");
      }
    } catch (error) {
      streamController.clear();
      const message = error instanceof Error ? error.message : "Unknown error";
      appendBubble(errorBubble("assistant", message));
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
        <h1 class="brand">
          <span class="status-dot" />
          Malkier Command Deck
        </h1>
        <div class="meta">sqlite-backed sessions | solid chat console</div>
      </header>

      <main class="layout">
        <section class="panel chat-panel" aria-busy={loadingConversation() || pending()} aria-labelledby="conversation-heading">
          <div class="panel-title panel-title-row">
            <h2 id="conversation-heading" class="panel-heading">{formatSessionTitle(activeSession())}</h2>
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
                    <MessageBubble bubble={bubble} />
                  )}
                </For>
                <Show when={activeBubble() !== null}>
                  <MessageBubble bubble={activeBubble()!} />
                </Show>
              </Show>
            </Show>
          </div>

          <form class="composer" onSubmit={submitPrompt}>
            <label class="sr-only" for="prompt-input">Message Malkier</label>
            <input
              id="prompt-input"
              ref={prompt}
              placeholder="Ask Malkier to explain code, debug, or ship a fix"
              disabled={pending()}
            />
            <button type="submit" disabled={pending()}>{pending() ? "running" : "dispatch"}</button>
          </form>
        </section>

        <aside class="stack">
          <section class="panel session-panel" aria-labelledby="sessions-heading">
            <div class="panel-title panel-title-row">
              <h2 id="sessions-heading" class="panel-heading">Sessions</h2>
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

          <section class="panel" aria-labelledby="session-status-heading">
            <h2 id="session-status-heading" class="panel-title panel-heading">Session Status</h2>
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

          <section class="panel" aria-labelledby="persistence-notes-heading">
            <h2 id="persistence-notes-heading" class="panel-title panel-heading">Persistence Notes</h2>
            <div class="status-copy" role="status" aria-live="polite" aria-atomic="true">{statusLine()}</div>
            <Show when={errorMessage() !== null}>
              <div class="status-copy danger" role="alert" aria-atomic="true">{errorMessage()}</div>
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
