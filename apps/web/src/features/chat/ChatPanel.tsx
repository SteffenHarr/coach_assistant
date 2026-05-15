import { useState } from "react";
import { api } from "../../api/client";

type Msg = { role: "user" | "assistant"; content: string };

export function ChatPanel() {
  const [history, setHistory] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!input.trim() || busy) return;
    const next: Msg[] = [...history, { role: "user", content: input }];
    setHistory(next);
    setInput("");
    setBusy(true);
    try {
      const r = await api<{ reply: string }>("/chat", {
        method: "POST",
        body: JSON.stringify({ message: input, history }),
      });
      setHistory([...next, { role: "assistant", content: r.reply }]);
    } catch (e) {
      setHistory([...next, { role: "assistant", content: `Fehler: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Chat-Agent</h2>
      <p style={{ color: "#666" }}>
        Lokales LLM via Ollama. Schreibende Aktionen erfordern explizite Bestätigung.
      </p>
      <div style={{ border: "1px solid #ccc", borderRadius: 8, padding: 12, minHeight: 240 }}>
        {history.map((m, i) => (
          <div key={i} style={{ margin: "6px 0" }}>
            <strong>{m.role === "user" ? "Du" : "Agent"}:</strong> {m.content}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Frag den Coach Assistant..."
          style={{ flex: 1, padding: 8 }}
          disabled={busy}
        />
        <button onClick={send} disabled={busy}>
          {busy ? "..." : "Senden"}
        </button>
      </div>
    </section>
  );
}
