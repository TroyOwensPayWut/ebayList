import type { Page } from "playwright"

import { launchAuthenticated } from "./shopify.js"
import type { AppConfig } from "./types.js"

/**
 * One logged-in browsing session: the Shopify admin page plus the ability to open
 * more tabs. The CLI backs this with a real Chrome window; the Electron app backs
 * it with tabs embedded in the app window (driven over CDP).
 */
export type BrowserSession = {
  shopifyPage: Page
  newPage(label?: string): Promise<Page>
  close(): Promise<void>
}

export type OpenSession = (config: AppConfig) => Promise<BrowserSession>

export const launchChromeSession: OpenSession = async (config) => {
  const context = await launchAuthenticated(config)
  return {
    shopifyPage: context.pages()[0],
    newPage: () => context.newPage(),
    close: () => context.close(),
  }
}
