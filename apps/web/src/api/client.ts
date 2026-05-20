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
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function login(email: string, password: string): Promise<void> {
  const body = new URLSearchParams({ username: email, password });
  const res = await fetch(`${API}/auth/jwt/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("login failed");
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
