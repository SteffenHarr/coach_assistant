import { useState } from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
  style?: React.CSSProperties;
  id?: string;
};

/**
 * Password input with a show/hide toggle — used wherever an admin/coach
 * sets a password *for someone else* (new player/coach account) and needs
 * to read it back to communicate it, not just type it blind like a login
 * form. Defaults to hidden either way, so nothing changes for plain login
 * use if this ever gets reused there.
 */
export function PasswordField({ value, onChange, autoComplete, placeholder, style, id }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        style={{ ...style, width: "100%", paddingRight: 34 }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        title={visible ? "Passwort verbergen" : "Passwort anzeigen"}
        style={{
          position: "absolute",
          right: 4,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "2px 6px",
          fontSize: 14,
          lineHeight: 1,
          color: "var(--color-text-muted)",
        }}
      >
        {visible ? "🙈" : "👁"}
      </button>
    </div>
  );
}
