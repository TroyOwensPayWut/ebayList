// Throwaway harness: pnpm tsx src/tryStagedShipping.ts <SKU> [weightLb] [--commit]
// Omit weightLb to extract the real weight from the Shopify product page.
// Mirrors the run.ts flow: stage shipping policy on the row (no commit), read the
// staged value back from the dataSet to prove it stuck, then with --commit save it
// and reload the page to prove it PERSISTED server-side.
import type { Frame } from "playwright"

import { buildConfig } from "./config.js"
import { launchAuthenticated } from "./shopify.js"
import { commitGrid, findRowIndex, getListingsFrame, searchForSku, setAndCommit } from "./grid.js"
import { resolveShippingPolicyId, shippingPolicyForWeightLb } from "./shippingPolicies.js"
import { waitForFrameSettled } from "./pageLoad.js"
import { openFirstShopifyProduct, searchShopifyProductsBySku } from "./shopifyProducts.js"
import { extractProductWeightLb } from "./productWeight.js"

const readRowValue = async (frame: Frame, index: number, column: string) =>
  frame.evaluate(
    ({ index, column }) => {
      const w = window as unknown as { $?: (s: unknown) => { data: (k: string) => unknown } }
      const gridEl = document.getElementById("ebaytable")
      if (!w.$ || !gridEl) return { error: "no grid" }
      const inst = w.$(gridEl).data("codisto.grid") as {
        dataSet?: { data: Array<{ currentData?: Record<string, unknown>; baseData?: Record<string, unknown> }>; dirty: () => boolean }
      }
      const rec = inst?.dataSet?.data[index]
      if (!rec) return { error: "no row" }
      return {
        current: rec.currentData?.[column],
        base: rec.baseData?.[column],
        dirty: inst!.dataSet!.dirty(),
      }
    },
    { index, column },
  )

const main = async () => {
  const args = process.argv.slice(2).filter((a) => a !== "--commit")
  const commit = process.argv.includes("--commit")
  const [sku, weightArg] = args
  if (!sku) throw new Error("Usage: pnpm tsx src/tryStagedShipping.ts <SKU> [weightLb] [--commit]")

  const config = buildConfig({ authOnly: false, headless: false, slowMoMs: 0 })
  const context = await launchAuthenticated(config)

  try {
    let weightLb = weightArg ? Number(weightArg) : undefined
    if (weightLb === undefined) {
      const shopifyPage = context.pages()[0]
      console.log(`Extracting weight for ${sku} from Shopify...`)
      const search = await searchShopifyProductsBySku(shopifyPage, config.productsUrl, sku)
      if (!search.ok) throw new Error(search.error)
      const opened = await openFirstShopifyProduct(shopifyPage)
      if (!opened.ok) throw new Error(opened.error)
      const weight = await extractProductWeightLb(shopifyPage)
      if (!weight.ok) throw new Error(weight.error)
      weightLb = weight.weightLb
      console.log(`Weight: ${weightLb} lb (raw: ${weight.rawValue} ${weight.unit})`)
    }
    const page = await context.newPage()
    await page.goto(config.listingsUrl, { waitUntil: "domcontentloaded" })
    await waitForFrameSettled(page)
    const frame = await getListingsFrame(page)

    const policyName = shippingPolicyForWeightLb(weightLb)
    if (!policyName) throw new Error(`No tier for ${weightLb} lb`)
    const policyId = await resolveShippingPolicyId(frame, policyName)
    if (!policyId) throw new Error(`Policy "${policyName}" not in dropdown — dropdown labels may have changed`)
    console.log(`Tier for ${weightLb} lb: "${policyName}" (id ${policyId})`)

    await searchForSku(frame, sku)
    const located = await findRowIndex(frame, sku)
    if (located.status !== "ok") throw new Error(`Locate failed: ${JSON.stringify(located)}`)
    console.log(`Row located at index ${located.index} (key ${located.key})`)

    const before = await readRowValue(frame, located.index, "shippingpolicyid")
    console.log(`Before stage:`, before)

    await setAndCommit(frame, located.index, "shippingpolicyid", policyId, false)
    const after = await readRowValue(frame, located.index, "shippingpolicyid")
    console.log(`After stage: `, after)

    const stagedOk = String((after as { current?: unknown }).current) === policyId
    console.log(stagedOk ? "STAGE OK: currentData holds the new policy id" : "STAGE FAILED: currentData does not hold the new policy id")

    if (!commit) {
      console.log("Staged only (pass --commit to save). Reload discards this.")
      return
    }

    console.log("Committing...")
    const saved = await commitGrid(frame)
    if (!saved.ok) throw new Error(`Commit failed: ${saved.error}`)
    console.log("Commit accepted (grid clean). Reloading to verify persistence...")

    await page.reload({ waitUntil: "domcontentloaded" })
    await waitForFrameSettled(page)
    const freshFrame = await getListingsFrame(page)
    await searchForSku(freshFrame, sku)
    const relocated = await findRowIndex(freshFrame, sku)
    if (relocated.status !== "ok") throw new Error(`Relocate failed: ${JSON.stringify(relocated)}`)
    const persisted = await readRowValue(freshFrame, relocated.index, "shippingpolicyid")
    console.log(`After reload:`, persisted)
    const persistedOk = String((persisted as { base?: unknown }).base) === policyId || String((persisted as { current?: unknown }).current) === policyId
    console.log(persistedOk ? "PERSIST OK: server kept the policy id across reload" : "PERSIST FAILED: value did not survive reload")
  } finally {
    await context.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
