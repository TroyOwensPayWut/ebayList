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

// Per-product order (everything STAGES on the grid row; one commit at the end saves it all):
// find product > search edit tab > google category lookup > get weight > stage shipping
// > wait for user (category/skip/quit) > stage category > stage payment > stage enabled > save.
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
      // 1. Find the next product.
      console.log(`\nScanning for next available product${lastSku ? ` after ${lastSku}` : ""}...`)
      await waitForFrameSettled(searchPage)
      const next = await findNextAvailableEbaySku(searchPage, lastSku)
      if (!next.ok) {
        console.log(next.error)
        break
      }

      const { sku, title } = next

      // 2. Search the edit tab (Codisto) for the product.
      console.log(`Found ${sku} — ${title || "(no title)"}. Searching edit tab for ${sku}...`)
      await waitForFrameSettled(editPage)
      const editFrame = await getListingsFrame(editPage)
      await searchForSku(editFrame, sku)

      // 3. Category lookup on Google.
      console.log("Looking up eBay category ID on Google...")
      await googlePage.goto(`https://www.google.com/search?q=${encodeURIComponent(`eBay category ID for ${title}`)}`)

      // 4. Get the weight from Shopify (failures are non-fatal — set shipping manually).
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

      // 5. Stage the weight-tier shipping policy (saved by the final commit).
      let staged = false
      if (weightLb !== undefined) {
        const shipping = await stageShippingPolicy(editFrame, sku, weightLb)
        if (shipping.ok) {
          staged = true
          console.log(`Weight: ${weightLb} lb → shipping policy "${shipping.policyName}" staged.`)
        } else {
          console.error(`Shipping policy failed for ${sku}: ${shipping.error}`)
        }
      }

      // 6. Wait for the user.
      const choice = await promptAction(rl, sku, title)

      if (choice.action === "quit") {
        // Staged-but-uncommitted changes die with the browser — no cleanup needed.
        console.log(`Quitting. Listed ${listedCount} product(s) this run.`)
        break
      }

      if (choice.action === "skip") {
        if (staged) {
          await discardStaged(editPage) // drop staged shipping so it can't ride along with the next product's save
        }
        console.log(`Skipped ${sku}.`)
        lastSku = sku
        continue
      }

      // 7–9. Stage category, payment policy, and enabled status on the same row.
      console.log(`Staging category #${choice.category}, payment policy, and enable for ${sku}...`)
      const paymentPolicyId = await resolveImmediatePayPolicyId(editFrame)
      const stages: Array<[label: string, column: string, value: unknown]> = [
        ["Category", "primarycategoryid", Number(choice.category)],
        ["Payment policy", "paymentpolicyid", paymentPolicyId],
        ["Enable", "status", STATUS_ENABLED],
      ]

      let stageError: string | undefined
      for (const [label, column, value] of stages) {
        const result = await stageRowValue(editFrame, sku, column, value)
        if (!result.ok) {
          stageError = `${label} failed for ${sku}: ${result.error}`
          break
        }
      }

      if (stageError) {
        console.error(stageError)
        await discardStaged(editPage)
        lastSku = sku
        continue
      }

      // 10. Save — one commit persists shipping + category + payment + enabled together.
      console.log(`Saving ${sku}...`)
      const saved = await commitGrid(editFrame)
      if (saved.ok) {
        listedCount += 1
        console.log(`Listed ${sku} under category #${choice.category}. (${listedCount} listed this run)`)
      } else {
        console.error(`Save failed for ${sku}: ${saved.error}`)
        await discardStaged(editPage)
      }

      lastSku = sku
    }
  } finally {
    console.log("Closing browser...")
    rl.close()
    await context.close()
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

const openCodistoPage = async (context: BrowserContext, productsUrl: string): Promise<Page> => {
  const page = await context.newPage()
  await page.goto(productsUrl, { waitUntil: "domcontentloaded" })
  await page.locator("iframe").first().waitFor({ state: "attached", timeout: 30000 })
  return page
}
