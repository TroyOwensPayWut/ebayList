import type { Page } from "playwright"

import type { AppConfig } from "./types.js"

/** Navigates to the Shopify products page and, if not logged in, waits for the user to finish the login/2FA in the tab. */
export const ensureLoggedIn = async (page: Page, config: AppConfig) => {
  await page.goto(config.productsUrl, { waitUntil: "domcontentloaded" })

  if (await isProductsPage(page)) {
    return
  }

  console.log("Complete the Shopify login in the Shopify tab. The session is remembered for future runs.")
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
