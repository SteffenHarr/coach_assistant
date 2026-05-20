import { useEffect, useRef, useState } from "react";
import { postStream } from "../../api/client";

type Msg = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "coach.chat.dock.open";
const HISTORY_KEY = "coach.chat.history";
const TOKEN_KEY = "access_token";

function hasToken(): boolean {
  return !!sessionStorage.getItem(TOKEN_KEY);
}

export function ChatDock() {
  const [authed, setAuthed] = useState<boolean>(hasToken);

  // Re-check auth state on tab focus, storage change, and every 2s while open.
  useEffect(() => {
    const refresh = () => setAuthed(hasToken());
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    const id = window.setInterval(refresh, 2000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
      window.clearInterval(id);
    };
  }, []);

  const [open, setOpen] = useState<boolean>(() => {
    return localStorage.getItem(STORAGE_KEY) === "1";
  });
  const [history, setHistory] = useState<Msg[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
  }, [open]);
  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  async function send() {
    if (!input.trim() || busy) return;
    const userMsg = input.trim();
    const baseHistory: Msg[] = [...history, { role: "user", content: userMsg }];
    // Add an empty assistant bubble that we'll fill incrementally.
    setHistory([...baseHistory, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    try {
      // Only send the last few turns to keep the LLM prompt short.
      const sentHistory = history.slice(-6);
      let acc = "";
      await postStream(
        "/chat/stream",
        { message: userMsg, history: sentHistory },
        (chunk) => {
          acc += chunk;
          setHistory([...baseHistory, { role: "assistant", content: acc }]);
        },
      );
      // If the model returned nothing, replace the empty bubble with a hint.
      if (!acc.trim()) {
        setHistory([
          ...baseHistory,
          { role: "assistant", content: "(keine Antwort erhalten)" },
        ]);
      }
    } catch (e) {
      const msg = (e as Error).message;
      const friendly = msg.startsWith("401")
        ? "Du bist nicht angemeldet. Bitte klicke oben rechts auf 'Anmelden' und logge dich ein."
        : "Fehler: " + msg;
      setHistory([...baseHistory, { role: "assistant", content: friendly }]);
    } finally {
      setBusy(false);
    }
  }

  function clearHistory() {
    if (confirm("Chat-Verlauf wirklich löschen?")) setHistory([]);
  }

  // Hide the dock completely when the user is not logged in.
  if (!authed) return null;

  return (
    <>
      {!open && (
        <button
          className="chatdock__toggle"
          onClick={() => setOpen(true)}
          aria-label="Chat öffnen"
          title="Chat-Assistent öffnen"
        >
          💬
        </button>
      )}

      <aside
        className={"chatdock" + (open ? " chatdock--open" : "")}
        aria-hidden={!open}
      >
        <header className="chatdock__header">
          <div className="chatdock__title">
            <span className="app-nav__brand-dot" aria-hidden />
            Coach-Assistent
          </div>
          <div className="row" style={{ gap: 4 }}>
            <button
              className="btn--ghost"
              onClick={clearHistory}
              title="Verlauf löschen"
              style={{ padding: "4px 8px" }}
            >
              🗑
            </button>
            <button
              className="btn--ghost"
              onClick={() => setOpen(false)}
              title="Einklappen"
              aria-label="Chat schließen"
              style={{ padding: "4px 10px" }}
            >
              ✕
            </button>
          </div>
        </header>

        <div className="chatdock__body">
          {history.length === 0 && (
            <div className="chatdock__empty">
              <p className="muted">
                Hi! Ich bin dein Coach-Assistent. Ich kenne deine Trainer,
                Spieler, Plätze, Verfügbarkeiten und Pläne und kann dir das
                Programm erklären.
              </p>
              <p className="muted" style={{ fontSize: "var(--text-xs)" }}>
                Beispiele:
              </p>
              <ul className="clean" style={{ fontSize: "var(--text-xs)" }}>
                <li>{'• "Welche Trainer haben wir?"'}</li>
                <li>{'• "Erstelle 3 Plan-Varianten für Saison Sommer 2026."'}</li>
                <li>{'• "Wie funktioniert der Saisonwechsel?"'}</li>
              </ul>
            </div>
          )}
          {history.map((m, i) => (
            <div
              key={i}
              className={
                "chatdock__msg chatdock__msg--" +
                (m.role === "user" ? "user" : "assistant")
              }
            >
              <div className="chatdock__msg-role">
                {m.role === "user" ? "Du" : "Assistent"}
              </div>
              <div className="chatdock__msg-text">
                {m.content || (
                  <span className="muted">denkt nach…</span>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <footer className="chatdock__footer">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Frage stellen… (Enter = senden, Shift+Enter = neue Zeile)"
            rows={2}
            disabled={busy}
          />
          <button onClick={send} disabled={busy || !input.trim()}>
            Senden
          </button>
        </footer>
      </aside>
    </>
  );
}
