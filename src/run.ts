import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"

import type { BrowserContext, Page } from "playwright"

import { applyStandardFilters } from "./filters.js"
import { enableEbayProduct } from "./listings.js"
import { isValidCategoryId, setEbayCategory } from "./categories.js"
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

    console.log("Applying standard filters (Has images, quantity >= 1, payment policy not set)...")
    await waitForFrameSettled(searchPage)
    const filters = await applyStandardFilters(searchPage)
    if (!filters.ok) {
      throw new Error(filters.error)
    }
    console.log("Filters applied.")

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

      const choice = await promptAction(rl, sku, title)

      if (choice.action === "quit") {
        console.log(`Quitting. Listed ${listedCount} product(s) this run.`)
        break
      }

      if (choice.action === "skip") {
        console.log(`Skipped ${sku}.`)
        lastSku = sku
        continue
      }

      const answer = choice.category
      console.log(`Setting category #${answer} for ${sku}...`)
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
        console.log(`Listed ${sku} under category #${answer}. (${listedCount} listed this run)`)
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

type Action = { action: "category"; category: string } | { action: "skip" } | { action: "quit" }

/** Shows a numbered menu for a product and returns the chosen action. */
const promptAction = async (
  rl: readline.Interface,
  sku: string,
  title: string,
): Promise<Action> => {
  const prefix = `\n${sku} — ${title || "(no title)"}`

  for (;;) {
    const answer = (
      await rl.question(`${prefix}\n  1) Enter category number\n  2) Skip\n  3) Quit\nSelect 1-3: `)
    ).trim()

    if (answer === "1") {
      const category = (await rl.question("Enter eBay category number: ")).trim()

      if (!isValidCategoryId(category)) {
        console.log("Enter a positive eBay category number (digits only).")
        continue
      }

      return { action: "category", category }
    }

    if (answer === "2") {
      return { action: "skip" }
    }

    if (answer === "3") {
      return { action: "quit" }
    }

    console.log("Invalid selection; enter 1, 2, or 3.")
  }
}

const openCodistoPage = async (context: BrowserContext, productsUrl: string, existingPage?: Page): Promise<Page> => {
  const page = existingPage ?? (await context.newPage())
  await page.goto(productsUrl, { waitUntil: "domcontentloaded" })
  await page.locator("iframe").first().waitFor({ state: "attached", timeout: 30000 })
  return page
}
