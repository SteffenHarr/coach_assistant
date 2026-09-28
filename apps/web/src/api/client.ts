// Minimal typed REST client. Auth-token is read from sessionStorage so it
// is cleared automatically when the tab closes (defence-in-depth).

const API = (import.meta as any).env?.VITE_API_BASE_URL ?? "/api";

// Requests never wait longer than this. Without a timeout, a dropped
// connection (e.g. a hiccup on the Cloudflare Tunnel) leaves fetch()
// pending forever — the UI just hangs (e.g. the login button stuck on
// "Anmelden…") instead of showing an error the user can act on.
const REQUEST_TIMEOUT_MS = 20_000;

function authHeader(): Record<string, string> {
  const token = sessionStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ``timeoutMs`` overrides the default 20s — needed for genuinely
 * long-running operations (e.g. plan generation, which runs the solver
 * synchronously and can legitimately take a minute or two).
 */
export async function api<T>(path: string, init: RequestInit = {}, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<T> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${API}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...authHeader(),
        ...(init.headers ?? {}),
      },
      credentials: "same-origin",
    }, timeoutMs);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("Zeitüberschreitung — der Server antwortet nicht. Bitte nochmal versuchen.");
    }
    throw new Error("Server nicht erreichbar — bitte Verbindung prüfen oder später nochmal versuchen.");
  }
  if (!res.ok) {
    // 401/403 → the session is no longer valid. Wipe local state
    // immediately so the nav bar flips from "Abmelden" to "Anmelden"
    // and downstream pages stop retrying.
    if (res.status === 401 || res.status === 403) {
      if (sessionStorage.getItem("access_token")) {
        sessionStorage.removeItem("access_token");
        sessionStorage.removeItem("user_role");
        sessionStorage.removeItem("privacy_accepted");
        window.dispatchEvent(new StorageEvent("storage", { key: "access_token" }));
      }
    }
    // Try to extract a human-readable message from the API's standard
    // FastAPI error envelope ``{ "detail": "..." }`` or the field-level
    // validation envelope ``{ "detail": [ { msg, loc, ... } ] }``.
    let detail = res.statusText;
    let parsedBody: any = undefined;
    try {
      const body = await res.json();
      parsedBody = body;
      if (typeof body?.detail === "string") {
        detail = body.detail;
      } else if (Array.isArray(body?.detail)) {
        detail = body.detail
          .map((d: any) =>
            d?.msg
              ? `${(d.loc ?? []).slice(-1).join(".") || "Feld"}: ${d.msg}`
              : JSON.stringify(d),
          )
          .join("; ");
      } else if (body?.detail && typeof body.detail === "object" && typeof body.detail.message === "string") {
        // Structured conflict payloads (e.g. { message, existing_id, ... })
        detail = body.detail.message;
      }
    } catch {
      /* body was not JSON — keep statusText */
    }
    const friendly = friendlyError(res.status, detail);
    const err = new Error(friendly);
    (err as any).status = res.status;
    // Full parsed body (if any) so callers can read structured detail
    // payloads, e.g. err.body.detail.existing_id for 409 conflicts.
    (err as any).body = parsedBody;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function friendlyError(status: number, detail: string): string {
  // If the API already provided a sentence-like message, just use it.
  if (detail && /[\s.äöüß]/i.test(detail) && detail.length > 3) return detail;
  switch (status) {
    case 400:
      return "Eingabe ungültig: " + detail;
    case 401:
      return "Nicht angemeldet. Bitte melde dich erneut an.";
    case 403:
      return "Keine Berechtigung für diese Aktion.";
    case 404:
      return "Der angefragte Datensatz wurde nicht gefunden.";
    case 409:
      return "Konflikt: " + (detail || "Der Datensatz existiert bereits.");
    case 422:
      return "Eingabe konnte nicht verarbeitet werden: " + detail;
    case 429:
      return "Zu viele Anfragen — bitte einen Moment warten.";
    case 500:
    case 502:
    case 503:
    case 504:
      return "Server-Fehler. Bitte später nochmal versuchen.";
    default:
      return `Fehler ${status}${detail ? ": " + detail : ""}`;
  }
}

export async function login(email: string, password: string): Promise<void> {
  const body = new URLSearchParams({ username: email, password });
  let res: Response;
  try {
    res = await fetchWithTimeout(`${API}/auth/jwt/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }, REQUEST_TIMEOUT_MS);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("Zeitüberschreitung — der Server antwortet nicht. Bitte nochmal versuchen.");
    }
    throw new Error("Server nicht erreichbar — bitte Verbindung prüfen oder später nochmal versuchen.");
  }
  if (!res.ok) {
    if (res.status === 400 || res.status === 401)
      throw new Error("E-Mail oder Passwort falsch.");
    throw new Error(`Anmeldung fehlgeschlagen (${res.status}).`);
  }
  const json = await res.json();
  sessionStorage.setItem("access_token", json.access_token);

  // Notify same-tab listeners (e.g. ChatDock) that auth state changed. Do
  // this BEFORE the role/privacy check below and don't await that check —
  // login() must resolve immediately once the token is in, or a slow/stuck
  // network hiccup on that follow-up request would freeze the "Anmelden"
  // button itself (that's exactly what happened when this was awaited
  // here). The check still starts right away, it just isn't part of the
  // critical path anymore.
  window.dispatchEvent(new StorageEvent("storage", { key: "access_token" }));
  void checkRoleAndPrivacy();
}

/**
 * Fetches role + Datenschutz-Zustimmung right after login (or whenever
 * AuthNavLink's periodic refresh calls it) and stores both in
 * sessionStorage. Deliberately fire-and-forget with its own short timeout —
 * see the comment in login() above for why this must never block anything.
 * Best effort: on failure it just leaves things as they are; the periodic
 * refresh will retry a few seconds later anyway.
 */
async function checkRoleAndPrivacy(): Promise<void> {
  const tokenAtRequest = sessionStorage.getItem("access_token");
  try {
    const me = await api<{ role: string; privacy_accepted_at: string | null }>("/me", {}, 8_000);
    // Falls zwischenzeitlich schon wieder ab-/angemeldet wurde, gehört
    // diese Antwort nicht mehr zum aktuellen Konto.
    if (sessionStorage.getItem("access_token") !== tokenAtRequest) return;
    sessionStorage.setItem("user_role", me.role);
    sessionStorage.setItem("privacy_accepted", me.privacy_accepted_at ? "1" : "0");
    window.dispatchEvent(new Event("storage"));
  } catch {
    // Bestes Bemühen — der normale periodische Refresh (AuthNavLink) holt
    // Rolle/Status in spätestens 15s nach. PrivacyConsentGate fällt bis
    // dahin sicherheitshalber auf "noch nicht akzeptiert" zurück (siehe
    // dort) — zeigt die Sperre also im Zweifel einmal zu oft statt gar
    // nicht, blockiert dabei aber nie den Login selbst.
  }
}

export function logout(): void {
  sessionStorage.removeItem("access_token");
  sessionStorage.removeItem("user_role");
  sessionStorage.removeItem("privacy_accepted");
  window.dispatchEvent(new StorageEvent("storage", { key: "access_token" }));
}

export function isLoggedIn(): boolean {
  return !!sessionStorage.getItem("access_token");
}

/**
 * POST a JSON body and stream the response back as text chunks. The
 * callback ``onChunk`` is invoked with each decoded UTF-8 segment as it
 * arrives. Resolves once the stream ends; rejects on HTTP errors.
 */
export async function postStream(
  path: string,
  body: unknown,
  onChunk: (text: string) => void,
): Promise<void> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader(),
    },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  if (!res.ok || !res.body) {
    if (res.status === 401 || res.status === 403) {
      if (sessionStorage.getItem("access_token")) {
        sessionStorage.removeItem("access_token");
        sessionStorage.removeItem("user_role");
        sessionStorage.removeItem("privacy_accepted");
        window.dispatchEvent(new StorageEvent("storage", { key: "access_token" }));
      }
    }
    const friendly = friendlyError(res.status, res.statusText);
    const err = new Error(friendly);
    (err as any).status = res.status;
    throw err;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value && value.length > 0) onChunk(decoder.decode(value, { stream: true }));
  }
  // Flush any remaining buffered bytes.
  const tail = decoder.decode();
  if (tail) onChunk(tail);
}

/**
 * Downloads a file from an authenticated endpoint (e.g. an Excel/PDF/CSV
 * export) and saves it locally. A plain `<a href>` can't be used here —
 * the API needs the Bearer token, which the browser only sends for actual
 * fetch() requests, not for a top-level navigation.
 */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await fetchWithTimeout(`${API}${path}`, { headers: { ...authHeader() } }, 60_000);
  if (!res.ok) {
    const friendly = friendlyError(res.status, res.statusText);
    throw new Error(friendly);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
