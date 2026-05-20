// Minimal typed REST client. Auth-token is read from sessionStorage so it
// is cleared automatically when the tab closes (defence-in-depth).

const API = (import.meta as any).env?.VITE_API_BASE_URL ?? "/api";

function authHeader(): Record<string, string> {
  const token = sessionStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeader(),
      ...(init.headers ?? {}),
    },
    credentials: "same-origin",
  });
  if (!res.ok) {
    // Try to extract a human-readable message from the API's standard
    // FastAPI error envelope ``{ "detail": "..." }`` or the field-level
    // validation envelope ``{ "detail": [ { msg, loc, ... } ] }``.
    let detail = res.statusText;
    try {
      const body = await res.json();
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
      }
    } catch {
      /* body was not JSON — keep statusText */
    }
    const friendly = friendlyError(res.status, detail);
    const err = new Error(friendly);
    (err as any).status = res.status;
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
  const res = await fetch(`${API}/auth/jwt/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    if (res.status === 400 || res.status === 401)
      throw new Error("E-Mail oder Passwort falsch.");
    throw new Error(`Anmeldung fehlgeschlagen (${res.status}).`);
  }
  const json = await res.json();
  sessionStorage.setItem("access_token", json.access_token);
  // Notify same-tab listeners (e.g. ChatDock) that auth state changed.
  window.dispatchEvent(new StorageEvent("storage", { key: "access_token" }));
}

export function logout(): void {
  sessionStorage.removeItem("access_token");
  sessionStorage.removeItem("user_role");
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
    throw new Error(`${res.status} ${res.statusText}`);
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
