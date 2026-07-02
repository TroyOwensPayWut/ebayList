import type { Page } from "playwright"

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
