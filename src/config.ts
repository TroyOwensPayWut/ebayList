import path from "node:path"
import process from "node:process"

import type { AppConfig, CliOptions } from "./types.js"

const SHOPIFY_STORE_DOMAIN = "paywut.myshopify.com"
const SHOPIFY_LOGIN_TIMEOUT_MS = 180000
const SHOPIFY_BROWSER_CHANNEL: "chrome" | "msedge" | undefined = "chrome"

export const parseCliOptions = () => {
  const args = process.argv.slice(2)
  const options: Partial<CliOptions> = {
    authOnly: false,
    headless: false,
    slowMoMs: 250,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === "--auth-only") {
      options.authOnly = true
      continue
    }

    if (arg === "--headless") {
      options.headless = true
      continue
    }

    if (arg === "--slow-mo") {
      const nextValue = Number(args[index + 1])

      if (!Number.isFinite(nextValue) || nextValue < 0) {
        throw new Error("--slow-mo must be a non-negative number of milliseconds")
      }

      options.slowMoMs = nextValue
      index += 1
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return options as CliOptions
}

export const buildConfig = (cliOptions: CliOptions) => {
  const profileDir = path.resolve(process.cwd(), ".auth", "profile")
  const productsUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/products`
  // Marketplace Connect eBay bulk grid — this is where the shopui.codisto.com iframe lives.
  const listingsUrl = "https://admin.shopify.com/store/paywut/apps/shopify-marketplace-connect/211238/ebay/bulk"
  const motorsListingsUrl = "https://admin.shopify.com/store/paywut/apps/shopify-marketplace-connect/240617/ebay/bulk"

  return {
    ...cliOptions,
    shopDomain: SHOPIFY_STORE_DOMAIN,
    loginTimeoutMs: SHOPIFY_LOGIN_TIMEOUT_MS,
    profileDir,
    productsUrl,
    listingsUrl,
    motorsListingsUrl,
    browserChannel: SHOPIFY_BROWSER_CHANNEL,
  } satisfies AppConfig
}
