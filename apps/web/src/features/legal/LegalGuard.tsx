// Placeholder marker so it's obvious in the rendered page (and in a text
// search of this file) exactly which parts still need real content.
export const TODO = (label: string) => (
  <span style={{ color: "var(--color-danger)", fontWeight: 600 }}>[{label}]</span>
);

// Impressum/Datenschutz müssen ohne Login erreichbar sein (gesetzliche Pflicht).
export function LegalGuard({ children }: { title: string; children: React.ReactNode }) {
  return <section className="stack">{children}</section>;
}
