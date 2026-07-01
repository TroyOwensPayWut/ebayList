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
import type { AppConfig } from "./types.js"

export const runListingLoop = async (config: AppConfig) => {
  const context = await launchAuthenticated(config)
  const rl = readline.createInterface({ input, output })

  try {
    const searchPage = await openCodistoPage(context, config.productsUrl) // finder scrolls here
    const editPage = await openCodistoPage(context, config.productsUrl) // SKU search + edit here
    const googlePage = await context.newPage() // reused each loop for the category lookup

    const filters = await activateFilters(searchPage, DEFAULT_FILTERS)
    if (!filters.ok) {
      throw new Error(`${filters.error}. Available filters: ${filters.availableFilters.join(", ")}`)
    }

    const policy = await applyReturnPolicyToAllProducts(searchPage)
    if (!policy.ok) {
      throw new Error(policy.error)
    }
    console.log(`Applied return policy "${policy.policyName}" to all products.`)

    let lastSku: string | undefined

    for (;;) {
      const next = await findNextAvailableEbaySku(searchPage, lastSku)
      if (!next.ok) {
        console.log(next.error)
        break
      }

      const { sku, title } = next
      await googlePage.goto(`https://www.google.com/search?q=${encodeURIComponent(`eBay category for ${title}`)}`)

      const answer = (await rl.question(`\n${sku} — ${title || "(no title)"}\ncategory / skip / quit > `)).trim()

      if (/^quit$/i.test(answer)) {
        break
      }

      if (!answer || /^skip$/i.test(answer)) {
        lastSku = sku
        continue
      }

      const category = await setEbayCategory(editPage, sku, answer)
      if (!category.ok) {
        console.error(`Category failed for ${sku}: ${category.error}`)
        lastSku = sku
        continue
      }

      const enabled = await enableEbayProduct(editPage, sku)
      if (enabled.ok) {
        console.log(`Listed ${sku} under "${answer}".`)
      } else {
        console.error(`Enable failed for ${sku}: ${enabled.error}`)
      }

      lastSku = sku
    }
  } finally {
    rl.close()
    await context.close()
  }
}

const openCodistoPage = async (context: BrowserContext, productsUrl: string): Promise<Page> => {
  const page = await context.newPage()
  await page.goto(productsUrl, { waitUntil: "domcontentloaded" })
  await page.locator("iframe").first().waitFor({ state: "attached", timeout: 30000 })
  return page
}
