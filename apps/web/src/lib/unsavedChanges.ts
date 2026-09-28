// Shared "is it OK to navigate away right now?" guard. Pages with an
// unsaved-changes draft (e.g. PlayerEditorPage) register a check here while
// dirty; every in-app navigation trigger (nav menu, subnav tabs, top bar
// links) asks before actually leaving. Without a data router (this app uses
// plain <BrowserRouter>), there's no built-in `useBlocker` for SPA route
// changes, so this fills that gap for the navigation entry points that
// exist in the shell.
type Guard = () => boolean; // true = OK to navigate, false = cancel

let guard: Guard | null = null;

export function setNavigationGuard(fn: Guard | null): void {
  guard = fn;
}

export function confirmNavigation(): boolean {
  return !guard || guard();
}
