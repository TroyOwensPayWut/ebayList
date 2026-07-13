import type { Page } from "playwright"

import type { AppConfig } from "./types.js"

/**
 * One logged-in browsing session: the Shopify admin page plus the ability to open
 * more tabs. The Electron app backs this with tabs embedded in the app window
 * (its own Chromium, driven over CDP — see electron/main.js openElectronSession).
 */
export type BrowserSession = {
  shopifyPage: Page
  newPage(label?: string): Promise<Page>
  close(): Promise<void>
}

export type OpenSession = (config: AppConfig) => Promise<BrowserSession>
