import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

type User = {
  id: string;
  email: string;
  role: "admin" | "coach" | "player" | string;
  is_active: boolean;
  is_verified: boolean;
  is_superuser: boolean;
};

export function UsersAdminPage() {
  const qc = useQueryClient();
  const me = useQuery<User>({
    queryKey: ["me"],
    queryFn: () => api<User>("/me"),
  });

  const users = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: () => api<User[]>("/admin/users"),
    enabled: me.data?.role === "admin",
  });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "coach" | "player">("player");
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: { email: string; password: string; role: string }) =>
      api<User>("/admin/users", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setEmail("");
      setPassword("");
      setRole("player");
      setErr(null);
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<User> }) =>
      api<User>(`/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const del = useMutation({
    mutationFn: (id: string) =>
      api<void>(`/admin/users/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  if (me.isLoading) return <p>Lädt…</p>;
  if (me.data?.role !== "admin")
    return (
      <section>
        <h2>Benutzer-Verwaltung</h2>
        <p className="muted">Nur Admins können Benutzer verwalten.</p>
      </section>
    );

  return (
    <section className="stack">
      <h2>Benutzer-Verwaltung</h2>

      <div className="card">
        <h3 className="card__title">Neuen Benutzer anlegen</h3>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ email, password, role });
          }}
        >
          <label style={{ flex: 1 }}>
            E-Mail
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label style={{ flex: 1 }}>
            Initial-Passwort
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={12}
              required
              placeholder="mindestens 12 Zeichen"
            />
          </label>
          <label>
            Rolle
            <select value={role} onChange={(e) => setRole(e.target.value as any)}>
              <option value="player">Spieler</option>
              <option value="coach">Trainer</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button type="submit" disabled={create.isPending}>
            {create.isPending ? "…" : "Anlegen"}
          </button>
        </form>
        {err && <p style={{ color: "var(--color-danger)" }}>{err}</p>}
        <p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: 8 }}>
          Tipp: Teile dem Benutzer Email + Initial-Passwort mit. Er kann sich
          dann anmelden und sollte das Passwort danach selbst ändern.
        </p>
      </div>

      <div className="card">
        <h3 className="card__title">Bestehende Benutzer</h3>
        {users.isLoading ? (
          <p>Lädt…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>E-Mail</th>
                <th>Rolle</th>
                <th>Aktiv?</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {(users.data ?? []).map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>
                    <select
                      value={u.role}
                      disabled={u.id === me.data?.id}
                      onChange={(e) =>
                        patch.mutate({
                          id: u.id,
                          body: { role: e.target.value as any },
                        })
                      }
                    >
                      <option value="player">Spieler</option>
                      <option value="coach">Trainer</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={u.is_active}
                      disabled={u.id === me.data?.id}
                      onChange={(e) =>
                        patch.mutate({
                          id: u.id,
                          body: { is_active: e.target.checked },
                        })
                      }
                    />
                  </td>
                  <td>
                    <button
                      className="btn--danger"
                      disabled={u.id === me.data?.id}
                      onClick={() => {
                        if (confirm(`Benutzer ${u.email} wirklich löschen?`))
                          del.mutate(u.id);
                      }}
                    >
                      Löschen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
