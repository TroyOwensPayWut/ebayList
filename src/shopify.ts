import fs from "node:fs/promises"

import { chromium, type BrowserContext, type Page } from "playwright"

import type { AppConfig } from "./types.js"

// Launch the persistent Chromium profile, ensure Shopify is logged in, and return
// the OPEN context. Caller owns closing it (used by the listing loop, which keeps
// the browser open across many tabs). checkAuth/runAuthOnly below close their own.
export const launchAuthenticated = async (config: AppConfig): Promise<BrowserContext> => {
  await fs.mkdir(config.profileDir, { recursive: true })

  const context = await chromium.launchPersistentContext(config.profileDir, {
    channel: config.browserChannel,
    headless: config.headless,
    slowMo: config.slowMoMs,
    viewport: { width: 1440, height: 960 },
    chromiumSandbox: true,
    args: ["--disable-blink-features=AutomationControlled"],
  })

  try {
    await context.addInitScript("window.__name = function(fn) { return fn; };")
    const page = context.pages()[0] ?? (await context.newPage())
    await ensureLoggedIn(page, config)
    return context
  } catch (error) {
    await context.close()
    throw error
  }
}

export const runAuthOnly = async (config: AppConfig) => {
  await fs.mkdir(config.profileDir, { recursive: true })

  const context = await chromium.launchPersistentContext(config.profileDir, {
    channel: config.browserChannel,
    headless: false,
    slowMo: config.slowMoMs,
    viewport: { width: 1440, height: 960 },
    chromiumSandbox: true,
    args: ["--disable-blink-features=AutomationControlled"],
  })

  try {
    await context.addInitScript("window.__name = function(fn) { return fn; };")
    const page = context.pages()[0] ?? (await context.newPage())
    await ensureLoggedIn(page, { ...config, headless: false })
  } finally {
    await context.close()
  }
}

const ensureLoggedIn = async (page: Page, config: AppConfig) => {
  await page.goto(config.productsUrl, { waitUntil: "domcontentloaded" })

  if (await isProductsPage(page)) {
    return
  }

  if (config.headless) {
    throw new Error("Shopify is not authenticated. Re-run without --headless and complete the login manually.")
  }

  console.log("Complete the Shopify login in the opened browser window. The local browser profile will remember the session for future runs.")
  await waitForAuthenticatedAdmin(page, config)
}

const waitForAuthenticatedAdmin = async (page: Page, config: AppConfig) => {
  const startedAt = Date.now()

  while (Date.now() - startedAt < config.loginTimeoutMs) {
    if (await isProductsPage(page)) {
      return
    }

    const challengeVisible = await page.getByText(/code|verify|two-step|2-step|authenticator|security check/i).first().isVisible().catch(() => false)

    if (challengeVisible) {
      console.log("Waiting for Shopify verification to finish in the browser...")
    }

    await page.waitForTimeout(2000)
  }

  throw new Error("Timed out waiting for Shopify admin login to finish")
}

const isProductsPage = async (page: Page) => {
  const url = page.url()

  if (/\/admin\/products/i.test(url)) {
    return true
  }

  return page.getByRole("heading", { name: /products/i }).first().isVisible().catch(() => false)
}
