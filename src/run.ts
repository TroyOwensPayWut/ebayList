import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"

import type { BrowserContext, Page } from "playwright"

import { DEFAULT_FILTERS } from "./config.js"
import { activateFilters } from "./filters.js"
import { enableEbayProduct } from "./listings.js"
import { setEbayCategory } from "./categories.js"
import { applyReturnPolicyToAllProducts } from "./returnPolicies.js"
import { findNextAvailableEbaySku } from "./nextAvailableProduct.js"
import { launchAuthenticated } from "./shopify.js"
import { waitForFrameSettled } from "./pageLoad.js"
import type { AppConfig } from "./types.js"

export const runListingLoop = async (config: AppConfig) => {
  console.log("Launching authenticated browser...")
  const context = await launchAuthenticated(config)
  console.log("Browser ready.")
  const rl = readline.createInterface({ input, output })

  try {
    console.log(`Opening search tab at ${config.listingsUrl} (waiting for Marketplace Connect to load)...`)
    // Reuse the existing login-check tab so we don't leave a stray products page open.
    const searchPage = await openCodistoPage(context, config.listingsUrl, context.pages()[0]) // finder scrolls here
    console.log("Search tab ready. Opening edit tab...")
    const editPage = await openCodistoPage(context, config.listingsUrl) // SKU search + edit here
    console.log("Edit tab ready.")
    const googlePage = await context.newPage() // reused each loop for the category lookup

    console.log(`Activating filters: ${DEFAULT_FILTERS.join(", ")}...`)
    await waitForFrameSettled(searchPage)
    const filters = await activateFilters(searchPage, DEFAULT_FILTERS)
    if (!filters.ok) {
      throw new Error(`${filters.error}. Available filters: ${filters.availableFilters.join(", ")}`)
    }
    console.log(`Filters active: ${filters.activated.join(", ")}.`)

    console.log("Applying return policy to all products...")
    await waitForFrameSettled(searchPage)
    const policy = await applyReturnPolicyToAllProducts(searchPage)
    if (!policy.ok) {
      throw new Error(policy.error)
    }
    console.log(`Applied return policy "${policy.policyName}" to all products.`)

    let lastSku: string | undefined
    let listedCount = 0

    for (;;) {
      console.log(`\nScanning for next available product${lastSku ? ` after ${lastSku}` : ""}...`)
      await waitForFrameSettled(searchPage)
      const next = await findNextAvailableEbaySku(searchPage, lastSku)
      if (!next.ok) {
        console.log(next.error)
        break
      }

      const { sku, title } = next
      console.log(`Found ${sku} — ${title || "(no title)"}. Looking up eBay category on Google...`)
      await googlePage.goto(`https://www.google.com/search?q=${encodeURIComponent(`eBay category for ${title}`)}`)

      const answer = (await rl.question(`\n${sku} — ${title || "(no title)"}\ncategory / skip / quit > `)).trim()

      if (/^quit$/i.test(answer)) {
        console.log(`Quitting. Listed ${listedCount} product(s) this run.`)
        break
      }

      if (!answer || /^skip$/i.test(answer)) {
        console.log(`Skipped ${sku}.`)
        lastSku = sku
        continue
      }

      console.log(`Setting category "${answer}" for ${sku}...`)
      await waitForFrameSettled(editPage)
      const category = await setEbayCategory(editPage, sku, answer)
      if (!category.ok) {
        console.error(`Category failed for ${sku}: ${category.error}`)
        lastSku = sku
        continue
      }

      console.log(`Category set. Enabling ${sku} on eBay...`)
      await waitForFrameSettled(editPage)
      const enabled = await enableEbayProduct(editPage, sku)
      if (enabled.ok) {
        listedCount += 1
        console.log(`Listed ${sku} under "${answer}". (${listedCount} listed this run)`)
      } else {
        console.error(`Enable failed for ${sku}: ${enabled.error}`)
      }

      lastSku = sku
    }
  } finally {
    console.log("Closing browser...")
    rl.close()
    await context.close()
  }
}

const openCodistoPage = async (context: BrowserContext, productsUrl: string, existingPage?: Page): Promise<Page> => {
  const page = existingPage ?? (await context.newPage())
  await page.goto(productsUrl, { waitUntil: "domcontentloaded" })
  await page.locator("iframe").first().waitFor({ state: "attached", timeout: 30000 })
  return page
}
