import type { AppConfig, LaunchOptions } from "./types.js"

const SHOPIFY_STORE_DOMAIN = "paywut.myshopify.com"
const SHOPIFY_LOGIN_TIMEOUT_MS = 180000

export const buildConfig = (options: LaunchOptions) => {
  const productsUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/products`
  // Marketplace Connect eBay bulk grid — this is where the shopui.codisto.com iframe lives.
  const listingsUrl = "https://admin.shopify.com/store/paywut/apps/shopify-marketplace-connect/211238/ebay/bulk"
  const motorsListingsUrl = "https://admin.shopify.com/store/paywut/apps/shopify-marketplace-connect/240617/ebay/bulk"

  return {
    ...options,
    shopDomain: SHOPIFY_STORE_DOMAIN,
    loginTimeoutMs: SHOPIFY_LOGIN_TIMEOUT_MS,
    productsUrl,
    listingsUrl,
    motorsListingsUrl,
  } satisfies AppConfig
}
