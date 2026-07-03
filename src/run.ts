import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"

import type { BrowserContext, Frame, Page } from "playwright"

import { applyStandardFilters } from "./filters.js"
import { STATUS_ENABLED } from "./listings.js"
import { isValidCategoryId } from "./categories.js"
import { applyReturnPolicyToAllProducts } from "./returnPolicies.js"
import { resolveImmediatePayPolicyId } from "./paymentPolicies.js"
import { findNextAvailableEbaySku } from "./nextAvailableProduct.js"
import { commitGrid, findRowIndex, getListingsFrame, searchForSku, setAndCommit } from "./grid.js"
import { openFirstShopifyProduct, searchShopifyProductsBySku } from "./shopifyProducts.js"
import { extractProductWeightLb } from "./productWeight.js"
import { resolveShippingPolicyId, shippingPolicyForWeightLb } from "./shippingPolicies.js"
import { launchAuthenticated } from "./shopify.js"
import { waitForFrameSettled } from "./pageLoad.js"
import type { AppConfig } from "./types.js"

// Per-product order (defaults STAGE on BOTH grids before the prompt so the user can
// override them in either grid; one commit on the chosen grid saves it all):
// find product > google category lookup > get weight
// > search both edit tabs + stage defaults (shipping, payment, enabled) on each
// > wait for user (marketplace + category / skip / quit)
// > stage category on chosen grid > save chosen > discard the other grid's staged defaults.
export const runListingLoop = async (config: AppConfig) => {
  console.log("Launching authenticated browser...")
  const context = await launchAuthenticated(config)
  console.log("Browser ready.")
  const rl = readline.createInterface({ input, output })

  try {
    // The auth check already left the first tab on the Shopify products page — reuse it as the product search tab.
    const shopifyPage = context.pages()[0] // reused each loop for the Shopify admin product search
    console.log(`Opening search tab at ${config.listingsUrl} (waiting for Marketplace Connect to load)...`)
    const searchPage = await openCodistoPage(context, config.listingsUrl) // finder scrolls here
    console.log("Search tab ready. Opening eBay edit tab...")
    const editPage = await openCodistoPage(context, config.listingsUrl) // SKU search + edit here
    console.log("eBay edit tab ready. Opening eBay Motors edit tab...")
    const motorsEditPage = await openCodistoPage(context, config.motorsListingsUrl) // Motors SKU search + edit
    console.log("eBay Motors edit tab ready.")
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
    // The bulk "Update" only stages the policy in the grid's dataSet — commit to save it.
    console.log(`Applied return policy "${policy.policyName}" to all products. Saving...`)
    const policySaved = await commitGrid(await getListingsFrame(searchPage))
    if (!policySaved.ok) {
      throw new Error(`Saving return policy failed: ${policySaved.error}`)
    }
    console.log("Return policy saved.")

    let lastSku: string | undefined
    let listedCount = 0

    for (;;) {
      // 1. Find the next product.
      console.log(`\nScanning for next available product${lastSku ? ` after ${lastSku}` : ""}...`)
      await waitForFrameSettled(searchPage)
      const next = await findNextAvailableEbaySku(searchPage, lastSku)
      if (!next.ok) {
        console.log(next.error)
        break
      }

      const { sku, title } = next

      // 2. Category lookup on Google.
      console.log(`Found ${sku} — ${title || "(no title)"}. Looking up eBay category ID on Google...`)
      await googlePage.goto(`https://www.google.com/search?q=${encodeURIComponent(`eBay category ID for ${title}`)}`)

      // 3. Get the weight from Shopify (failures are non-fatal — set shipping manually).
      let weightLb: number | undefined
      const shopifySearch = await searchShopifyProductsBySku(shopifyPage, config.productsUrl, sku)
      if (!shopifySearch.ok) {
        console.error(`Shopify admin search failed for ${sku}: ${shopifySearch.error}`)
      } else {
        const opened = await openFirstShopifyProduct(shopifyPage)
        if (!opened.ok) {
          console.error(`Could not open Shopify product for ${sku}: ${opened.error}`)
        } else {
          const weight = await extractProductWeightLb(shopifyPage)
          if (weight.ok) {
            weightLb = weight.weightLb
          } else {
            console.error(`Could not extract weight for ${sku}: ${weight.error}`)
          }
        }
      }

      // 4. Search both edit tabs and stage the defaults (shipping, payment, enabled) on each,
      // so the user can see AND override them in either grid before choosing where to list.
      console.log(`Searching eBay and eBay Motors edit tabs for ${sku} and staging defaults...`)
      await waitForFrameSettled(editPage)
      const ebayEditFrame = await getListingsFrame(editPage)
      await searchForSku(ebayEditFrame, sku)
      await stageDefaults(ebayEditFrame, "eBay", sku, weightLb)
      await waitForFrameSettled(motorsEditPage)
      const motorsEditFrame = await getListingsFrame(motorsEditPage)
      await searchForSku(motorsEditFrame, sku)
      await stageDefaults(motorsEditFrame, "eBay Motors", sku, weightLb)

      // 5. Wait for the user (marketplace + category, skip, or quit). The user may
      // edit any staged default in either grid here — those edits stage on top and win.
      const choice = await promptAction(rl, sku, title)

      if (choice.action === "quit") {
        // context.close() drops all staged (client-side) changes — no discard needed.
        console.log(`Quitting. Listed ${listedCount} product(s) this run.`)
        break
      }

      if (choice.action === "skip") {
        console.log(`Skipped ${sku}.`)
        await discardStaged(editPage)
        await discardStaged(motorsEditPage)
        lastSku = sku
        continue
      }

      // 6. Stage only the category on the chosen grid (everything else is already staged).
      const marketplaceLabel = choice.marketplace === "motors" ? "eBay Motors" : "eBay"
      const targetPage = choice.marketplace === "motors" ? motorsEditPage : editPage
      const otherPage = choice.marketplace === "motors" ? editPage : motorsEditPage
      const editFrame = choice.marketplace === "motors" ? motorsEditFrame : ebayEditFrame

      console.log(`Staging category #${choice.category} for ${sku}...`)
      const category = await stageRowValue(editFrame, sku, "primarycategoryid", Number(choice.category))
      if (!category.ok) {
        console.error(`Category failed for ${sku}: ${category.error}`)
        await discardStaged(targetPage)
        await discardStaged(otherPage)
        lastSku = sku
        continue
      }

      // 7. Save — one commit persists shipping + category + payment + enabled (with any
      // user overrides) together, then drop the unchosen grid's staged defaults.
      console.log(`Saving ${sku}...`)
      const saved = await commitGrid(editFrame)
      if (saved.ok) {
        listedCount += 1
        console.log(`Listed ${sku} on ${marketplaceLabel} under category #${choice.category}. (${listedCount} listed this run)`)
      } else {
        console.error(`Save failed for ${sku}: ${saved.error}`)
        await discardStaged(targetPage)
      }
      await discardStaged(otherPage)

      lastSku = sku
    }
  } finally {
    console.log("Closing browser...")
    rl.close()
    await context.close()
  }
}

/**
 * Stages the defaults (weight-tier shipping, payment policy, enabled) on the SKU's row —
 * no commit, so the user can override any of them in the grid before choosing.
 * Failures are non-fatal: they're logged and the user can set the value manually.
 */
const stageDefaults = async (frame: Frame, label: string, sku: string, weightLb: number | undefined) => {
  if (weightLb !== undefined) {
    const shipping = await stageShippingPolicy(frame, sku, weightLb)
    if (shipping.ok) {
      console.log(`${label}: weight ${weightLb} lb → shipping policy "${shipping.policyName}" staged.`)
    } else {
      console.error(`${label}: shipping policy failed for ${sku}: ${shipping.error}`)
    }
  }

  const paymentPolicyId = await resolveImmediatePayPolicyId(frame)
  const stages: Array<[label: string, column: string, value: unknown]> = [
    ["Payment policy", "paymentpolicyid", paymentPolicyId],
    ["Enable", "status", STATUS_ENABLED],
  ]
  for (const [stageLabel, column, value] of stages) {
    const result = await stageRowValue(frame, sku, column, value)
    if (!result.ok) {
      console.error(`${label}: ${stageLabel} failed for ${sku}: ${result.error}`)
    }
  }
}

/** Stage one column on the SKU's row without committing (the final save commits everything). */
const stageRowValue = async (
  frame: Frame,
  sku: string,
  column: string,
  value: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const located = await findRowIndex(frame, sku)
  if (located.status === "nogrid") return { ok: false, error: "Codisto grid was not found on the page" }
  if (located.status === "notfound") return { ok: false, error: `No listing found for SKU '${sku}'` }
  if (located.status === "multiple") return { ok: false, error: `Found ${located.count} listings for SKU '${sku}'` }

  await setAndCommit(frame, located.index, column, value, false)
  return { ok: true }
}

/** Picks the weight tier and stages it as the SKU's shipping policy (no commit). */
const stageShippingPolicy = async (
  frame: Frame,
  sku: string,
  weightLb: number,
): Promise<{ ok: true; policyName: string } | { ok: false; error: string }> => {
  const policyName = shippingPolicyForWeightLb(weightLb)
  if (!policyName) {
    return { ok: false, error: `No shipping policy tier for weight ${weightLb} lb` }
  }

  const policyId = await resolveShippingPolicyId(frame, policyName)
  if (!policyId) {
    return { ok: false, error: `Policy "${policyName}" not found in the grid's shipping policy list` }
  }

  const staged = await stageRowValue(frame, sku, "shippingpolicyid", policyId)
  return staged.ok ? { ok: true, policyName } : staged
}

// A reload is the only reliable way to drop staged-but-uncommitted grid changes
// (grid.ts: staged data rides along with the NEXT commit otherwise).
const discardStaged = async (page: Page) => {
  console.log("Discarding staged changes...")
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.locator("iframe").first().waitFor({ state: "attached", timeout: 30000 })
  await waitForFrameSettled(page)
}

type Action =
  | { action: "list"; marketplace: "ebay" | "motors"; category: string }
  | { action: "skip" }
  | { action: "quit" }

/** Shows a numbered menu for a product and returns the chosen action. */
const promptAction = async (
  rl: readline.Interface,
  sku: string,
  title: string,
): Promise<Action> => {
  const prefix = `\n${sku} — ${title || "(no title)"}`

  for (;;) {
    const answer = (
      await rl.question(`${prefix}\n  1) List on eBay\n  2) List on eBay Motors\n  3) Skip\n  4) Quit\nSelect 1-4: `)
    ).trim()

    if (answer === "1" || answer === "2") {
      const category = (await rl.question("Enter eBay category number: ")).trim()

      if (!isValidCategoryId(category)) {
        console.log("Enter a positive eBay category number (digits only).")
        continue
      }

      return { action: "list", marketplace: answer === "1" ? "ebay" : "motors", category }
    }

    if (answer === "3") {
      return { action: "skip" }
    }

    if (answer === "4") {
      return { action: "quit" }
    }

    console.log("Invalid selection; enter 1, 2, 3, or 4.")
  }
}

const openCodistoPage = async (context: BrowserContext, productsUrl: string): Promise<Page> => {
  const page = await context.newPage()
  await page.goto(productsUrl, { waitUntil: "domcontentloaded" })
  await page.locator("iframe").first().waitFor({ state: "attached", timeout: 30000 })
  return page
}
