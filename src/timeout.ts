// Single global timeout for the whole app. Set as the Playwright context default
// (covers every locator/navigation wait) and used by the manual poll loops.
export const TIMEOUT_MS = 30_000
