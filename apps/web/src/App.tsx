import { ReactNode } from "react";

export function App({ children }: { children: ReactNode }) {
  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto", fontFamily: "system-ui" }}>
      <h1>Coach Assistant</h1>
      {children}
    </main>
  );
}
