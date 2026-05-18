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
