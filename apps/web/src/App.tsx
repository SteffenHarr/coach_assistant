import { ReactNode } from "react";

export function App({ children }: { children: ReactNode }) {
  return (
    <main className="app-main">
      {children}
    </main>
  );
}
