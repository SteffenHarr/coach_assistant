import { useState } from "react";
import { useQuery, useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { api, isLoggedIn } from "../../api/client";
import { LoginRequired } from "../../components/LoginRequired";

type LinkedRecord = { id: string; name: string };

type User = {
  id: string;
  email: string;
  role: "admin" | "coach" | "player" | string;
  is_active: boolean;
  is_verified: boolean;
  is_superuser: boolean;
  is_protected: boolean;
  // Ein Konto darf mit mehreren Spielern verknüpft sein ("Familien-Account",
  // z.B. eine Mutter, die mehrere Kinder verwaltet). Trainer bleiben 1:1.
  linked_players: LinkedRecord[];
  linked_coach_id: string | null;
  linked_coach_name: string | null;
};

type NamedRecord = { id: string; name: string; has_account?: boolean };

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  planner: "Planer",
  coach: "Trainer",
  player: "Spieler",
};

type PatchBody = Partial<Pick<User, "email" | "role" | "is_active">> & { password?: string };
type PatchMutation = UseMutationResult<User, Error, { id: string; body: PatchBody }>;
type DelMutation = UseMutationResult<void, Error, string>;
type LinkMutation = UseMutationResult<unknown, Error, { kind: "player" | "coach"; recordId: string; email: string }>;

export function UsersAdminPage() {
  const qc = useQueryClient();
  const authed = isLoggedIn();
  const me = useQuery<User>({
    queryKey: ["me"],
    queryFn: () => api<User>("/me"),
    enabled: authed,
  });

  const users = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: () => api<User[]>("/admin/users"),
    enabled: me.data?.role === "admin",
  });
  const players = useQuery<NamedRecord[]>({
    queryKey: ["players"],
    queryFn: () => api<NamedRecord[]>("/players"),
    enabled: me.data?.role === "admin",
  });
  const coaches = useQuery<NamedRecord[]>({
    queryKey: ["coaches"],
    queryFn: () => api<NamedRecord[]>("/coaches"),
    enabled: me.data?.role === "admin",
  });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "planner" | "coach" | "player">("player");
  const [err, setErr] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

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

  const patch: PatchMutation = useMutation({
    mutationFn: ({ id, body }) =>
      api<User>(`/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const del: DelMutation = useMutation({
    mutationFn: (id: string) =>
      api<void>(`/admin/users/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setExpandedId(null);
    },
  });

  const link: LinkMutation = useMutation({
    mutationFn: ({ kind, recordId, email }) =>
      api(`/${kind === "player" ? "players" : "coaches"}/${recordId}/link-account`, {
        method: "PATCH",
        body: JSON.stringify({ email }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["players"] });
      qc.invalidateQueries({ queryKey: ["coaches"] });
    },
  });

  if (!authed) return <LoginRequired />;
  if (me.isLoading) return <p>Lädt…</p>;
  if (me.data?.role !== "admin")
    return (
      <section>
        <h2>Benutzer-Verwaltung</h2>
        <p className="muted">Nur Admins können Benutzer verwalten.</p>
      </section>
    );

  const unlinkedPlayers = (players.data ?? []).filter((p) => !p.has_account);
  const unlinkedCoaches = (coaches.data ?? []).filter((c) => !c.has_account);

  const visibleUsers = (users.data ?? [])
    .filter((u) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        u.email.toLowerCase().includes(q) ||
        (ROLE_LABEL[u.role] ?? u.role).toLowerCase().includes(q) ||
        u.linked_players.some((p) => p.name.toLowerCase().includes(q)) ||
        (u.linked_coach_name ?? "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => a.email.localeCompare(b.email, "de"));

  return (
    <section className="stack">
      <h2>Benutzer-Verwaltung</h2>

      <div className="card">
        <h3 className="card__title">Neuen Benutzer anlegen</h3>
        <form
          style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-end", flexWrap: "wrap" }}
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ email, password, role });
          }}
        >
          <label style={{ flex: 1, minWidth: 180 }}>
            E-Mail
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label style={{ flex: 1, minWidth: 180 }}>
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
          <label style={{ minWidth: 130 }}>
            Rolle
            <select value={role} onChange={(e) => setRole(e.target.value as any)}>
              <option value="player">Spieler</option>
              <option value="coach">Trainer</option>
              <option value="planner">Planer</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label style={{ flexShrink: 0 }}>
            <span style={{ visibility: "hidden" }}>·</span>
            <button type="submit" disabled={create.isPending} style={{ width: "100%" }}>
              {create.isPending ? "…" : "Anlegen"}
            </button>
          </label>
        </form>
        {err && <p style={{ color: "var(--color-danger)" }}>{err}</p>}
        <p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: 8 }}>
          Tipp: Teile dem Benutzer Email + Initial-Passwort mit. Er kann sich
          dann anmelden und sollte das Passwort danach selbst ändern.
        </p>
      </div>

      <div className="card">
        <h3 className="card__title">Bestehende Benutzer</h3>
        <p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: 0, marginBottom: "var(--space-3)" }}>
          Auf eine Zeile klicken, um sie zu bearbeiten. 🔒 = geschützter Account.
        </p>
        <input
          type="text"
          placeholder={`Suche unter ${(users.data ?? []).length} Benutzern (E-Mail, Rolle, verknüpfter Name)…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: "var(--space-3)", width: "100%", maxWidth: 420 }}
        />
        {users.isLoading ? (
          <p>Lädt…</p>
        ) : (
          <div className="stack" style={{ gap: 4 }}>
            {visibleUsers.length === 0 && (
              <p className="muted">Keine Benutzer gefunden.</p>
            )}
            {visibleUsers.map((u) => (
              <UserRow
                key={u.id}
                u={u}
                meId={me.data?.id}
                expanded={expandedId === u.id}
                onToggle={() => setExpandedId((cur) => (cur === u.id ? null : u.id))}
                patch={patch}
                del={del}
                link={link}
                unlinkedPlayers={unlinkedPlayers}
                unlinkedCoaches={unlinkedCoaches}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function UserRow({
  u,
  meId,
  expanded,
  onToggle,
  patch,
  del,
  link,
  unlinkedPlayers,
  unlinkedCoaches,
}: {
  u: User;
  meId: string | undefined;
  expanded: boolean;
  onToggle: () => void;
  patch: PatchMutation;
  del: DelMutation;
  link: LinkMutation;
  unlinkedPlayers: NamedRecord[];
  unlinkedCoaches: NamedRecord[];
}) {
  const isSelf = u.id === meId;
  const locked = u.is_protected && !isSelf;

  const [emailDraft, setEmailDraft] = useState(u.email);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pickPlayer, setPickPlayer] = useState("");
  const [pickCoach, setPickCoach] = useState("");
  const pwValid = pw1.length >= 12 && pw1 === pw2;
  const emailChanged = emailDraft.trim() !== u.email && emailDraft.trim().length > 0;

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
      {/* Read-only summary row — click to expand. Fixed grid columns so a
          row with 🔒 (or with/without link badges) never shifts anything
          relative to other rows. */}
      <button
        type="button"
        onClick={onToggle}
        className="useradmin-row"
        style={{ background: expanded ? "var(--color-surface-muted)" : "transparent" }}
      >
        <span aria-hidden style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s ease" }}>
          ▶
        </span>
        <span aria-hidden title={u.is_protected ? "Geschützter Account" : undefined}>
          {u.is_protected ? "🔒" : ""}
        </span>
        <span style={{ fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {u.email}
        </span>
        <span className="pill" style={{ fontSize: "var(--text-xs)", justifySelf: "start" }}>{ROLE_LABEL[u.role] ?? u.role}</span>
        <span
          className={u.is_active ? "pill pill--success" : "pill pill--danger"}
          style={{ fontSize: "var(--text-xs)", justifySelf: "start" }}
        >
          {u.is_active ? "aktiv" : "deaktiviert"}
        </span>
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
          {u.linked_players.map((p) => (
            <span key={p.id} className="pill pill--accent" style={{ fontSize: "var(--text-xs)" }}>🎾 {p.name}</span>
          ))}
          {u.linked_coach_name && (
            <span className="pill pill--accent" style={{ fontSize: "var(--text-xs)" }}>🎓 {u.linked_coach_name}</span>
          )}
          {u.linked_players.length === 0 && !u.linked_coach_name && (
            <span className="muted" style={{ fontSize: "var(--text-xs)" }}>— nicht verknüpft</span>
          )}
        </span>
      </button>

      {expanded && (
        <div className="stack" style={{ padding: "var(--space-4)", borderTop: "1px solid var(--color-border)" }}>
          <div className="useradmin-grid">
            <label>
              E-Mail
              <input
                type="email"
                value={emailDraft}
                disabled={locked}
                onChange={(e) => setEmailDraft(e.target.value)}
              />
            </label>
            <label>
              Rolle
              <select
                value={u.role}
                disabled={isSelf || locked}
                onChange={(e) => patch.mutate({ id: u.id, body: { role: e.target.value as any } })}
              >
                <option value="player">Spieler</option>
                <option value="coach">Trainer</option>
                <option value="planner">Planer</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <label className="label--inline useradmin-checkbox">
              <input
                type="checkbox"
                checked={u.is_active}
                disabled={isSelf || locked}
                onChange={(e) => patch.mutate({ id: u.id, body: { is_active: e.target.checked } })}
              />
              Aktiv
            </label>
          </div>
          {emailChanged && !locked && (
            <button
              type="button"
              style={{ justifySelf: "start" }}
              disabled={patch.isPending}
              onClick={() => patch.mutate({ id: u.id, body: { email: emailDraft.trim() } })}
            >
              E-Mail speichern
            </button>
          )}

          <div className="useradmin-links">
            <div>
              <label style={{ display: "block", marginBottom: 6, fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>
                🎾 Spieler-Verknüpfung{u.linked_players.length > 1 ? ` (${u.linked_players.length} Kinder)` : ""}
              </label>
              {u.linked_players.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {u.linked_players.map((p) => (
                    <span key={p.id} className="pill pill--accent">{p.name}</span>
                  ))}
                </div>
              )}
              {/* Ein Konto darf mehrere Spieler haben (Familien-Account) — der
                  Picker bleibt deshalb immer sichtbar, auch wenn schon einer
                  verknüpft ist, damit weitere Kinder dazukommen können. */}
              <div className="useradmin-link-picker">
                <select value={pickPlayer} onChange={(e) => setPickPlayer(e.target.value)}>
                  <option value="">– weiteren Spieler wählen –</option>
                  {unlinkedPlayers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn--ghost"
                  disabled={!pickPlayer || link.isPending}
                  onClick={() => {
                    link.mutate({ kind: "player", recordId: pickPlayer, email: u.email });
                    setPickPlayer("");
                  }}
                >
                  verknüpfen
                </button>
              </div>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: 6, fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>
                🎓 Trainer-Verknüpfung
              </label>
              {u.linked_coach_name ? (
                <span className="pill pill--accent">{u.linked_coach_name}</span>
              ) : (
                <div className="useradmin-link-picker">
                  <select value={pickCoach} onChange={(e) => setPickCoach(e.target.value)}>
                    <option value="">– Trainer wählen –</option>
                    {unlinkedCoaches.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn--ghost"
                    disabled={!pickCoach || link.isPending}
                    onClick={() => {
                      link.mutate({ kind: "coach", recordId: pickCoach, email: u.email });
                      setPickCoach("");
                    }}
                  >
                    verknüpfen
                  </button>
                </div>
              )}
            </div>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 6, fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>
              Neues Passwort setzen
            </label>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <input
                type="password"
                placeholder="neues Passwort"
                value={pw1}
                disabled={locked}
                onChange={(e) => setPw1(e.target.value)}
                style={{ width: 160 }}
              />
              <input
                type="password"
                placeholder="bestätigen"
                value={pw2}
                disabled={locked}
                onChange={(e) => setPw2(e.target.value)}
                style={{ width: 160 }}
              />
              <button
                type="button"
                className="btn--ghost"
                disabled={locked || !pwValid || patch.isPending}
                onClick={() => {
                  patch.mutate({ id: u.id, body: { password: pw1 } });
                  setPw1("");
                  setPw2("");
                }}
              >
                setzen
              </button>
            </div>
          </div>

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button
              className="btn--danger"
              disabled={isSelf || locked}
              onClick={() => {
                if (confirm(`Benutzer ${u.email} wirklich löschen?`)) del.mutate(u.id);
              }}
            >
              Benutzer löschen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
