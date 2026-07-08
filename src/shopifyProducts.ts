import type { Page } from "playwright"

import { TIMEOUT_MS } from "./timeout.js"

// Searches the Shopify admin products page for a SKU by editing the URL,
// the same way amzList does (products index honors ?query=).
export const searchShopifyProductsBySku = async (
  page: Page,
  productsUrl: string,
  sku: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  try {
    await page.goto(`${productsUrl}?query=${encodeURIComponent(sku)}`, { waitUntil: "domcontentloaded" })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// Product detail links look like .../products/<numeric id>; this excludes the
// "Products" nav item (no id) and "Add product" (/products/new). Exported for
// the self-check in shopifyProducts.test.ts.
export const pickFirstProductHref = (hrefs: string[]): string | undefined =>
  hrefs.find((href) => /\/products\/\d+([/?#]|$)/.test(href))

// Clicks the first product in the search results, landing on its detail page.
// Call after searchShopifyProductsBySku; polls because results render client-side.
export const openFirstShopifyProduct = async (
  page: Page,
  timeoutMs = TIMEOUT_MS,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  try {
    const deadline = Date.now() + timeoutMs
    let href: string | undefined

    // ponytail: poll-in-node instead of waitForFunction so href picking stays a testable pure function
    for (;;) {
      const hrefs = await page.$$eval('a[href*="/products/"]', (links) =>
        links.map((link) => link.getAttribute("href") ?? ""),
      )
      href = pickFirstProductHref(hrefs)
      if (href || Date.now() >= deadline) break
      await page.waitForTimeout(500)
    }

    if (!href) {
      return { ok: false, error: "No product results found to click" }
    }

    await page.locator(`a[href="${href}"]`).first().click()
    await page.waitForURL(/\/products\/\d+/, { timeout: timeoutMs })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
