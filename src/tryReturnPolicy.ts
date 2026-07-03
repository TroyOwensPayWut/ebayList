// Throwaway harness: pnpm tsx src/tryReturnPolicy.ts [SKU]
// 1. Dumps select#returnpolicyid options on BOTH grids (eBay + Motors) and resolves
//    the new default label to its option value.
// 2. Tests the bulk module on the eBay grid with commit:false (stages the selection,
//    never clicks Update — nothing saved; reload discards).
// 3. If a SKU is given, tests the per-product path on the Motors grid: resolve id +
//    stage returnpolicyid on the row with commit:false, then reload to discard.
import type { Page } from "playwright"

import { buildConfig } from "./config.js"
import { launchAuthenticated } from "./shopify.js"
import { waitForFrameSettled } from "./pageLoad.js"
import { getListingsFrame, findRowIndex, resolveSelectValueByLabel, searchForSku, setAndCommit } from "./grid.js"
import { applyBulkPolicyToAllProducts } from "./bulkPolicy.js"
import { resolveReturnPolicyId } from "./returnPolicies.js"

const LABEL = "Returns Accepted,Buyer,30 Days,Money Back,Int"

const openGrid = async (page: Page, url: string) => {
  await page.goto(url, { waitUntil: "domcontentloaded" })
  await page.locator("iframe").first().waitFor({ state: "attached", timeout: 30000 })
  await waitForFrameSettled(page)
  return getListingsFrame(page)
}

const dumpOptions = async (page: Page, name: string) => {
  const frame = await getListingsFrame(page)
  const options = await frame.evaluate(() => {
    const select = document.querySelector<HTMLSelectElement>("select#returnpolicyid")
    if (!select) return null
    return Array.from(select.options).map((o) => ({ label: o.label.trim(), value: o.value }))
  })
  console.log(`\n[${name}] select#returnpolicyid options:`)
  console.log(options ? JSON.stringify(options, null, 2) : "  SELECT NOT FOUND")
  const resolved = await resolveSelectValueByLabel(frame, "returnpolicyid", LABEL)
  console.log(`[${name}] resolve "${LABEL}" -> ${resolved === null ? "NOT FOUND" : `"${resolved}"`}`)
  return resolved
}

const main = async () => {
  const sku = process.argv[2]
  const config = buildConfig({ authOnly: false, headless: false, slowMoMs: 0 })
  const context = await launchAuthenticated(config)

  try {
    const page = context.pages()[0]

    // --- eBay grid: dump options + test bulk module (staged only) ---
    await openGrid(page, config.listingsUrl)
    const ebayValue = await dumpOptions(page, "eBay")

    console.log(`\n[eBay] Testing bulk apply (commit:false — stages only, no Update click)...`)
    const bulk = await applyBulkPolicyToAllProducts(page, { selectId: "returnpolicyid", policyName: LABEL, commit: false })
    console.log(`[eBay] bulk result: ${bulk.ok ? `OK — "${bulk.policyName}" staged` : `FAILED — ${bulk.error}`}`)
    await page.reload({ waitUntil: "domcontentloaded" }) // drop the staged selection

    // --- Motors grid: dump options + test per-product path (staged only) ---
    const motorsFrame = await openGrid(page, config.motorsListingsUrl)
    const motorsValue = await dumpOptions(page, "Motors")

    const resolvedId = await resolveReturnPolicyId(motorsFrame)
    console.log(`\n[Motors] resolveReturnPolicyId -> "${resolvedId}"`)

    // No SKU given — pick the first loaded row's SKU from the Motors grid.
    const testSku =
      sku ??
      (await motorsFrame.evaluate(() => {
        const w = window as unknown as { $?: (s: unknown) => { data: (k: string) => unknown } }
        const gridEl = document.getElementById("ebaytable")
        if (!w.$ || !gridEl) return null
        const inst = w.$(gridEl).data("codisto.grid") as {
          dataSet?: { data: Array<{ currentData?: Record<string, unknown>; baseData?: Record<string, unknown> }> }
        }
        for (const rec of inst?.dataSet?.data ?? []) {
          const row = rec?.currentData || rec?.baseData
          if (typeof row?.code === "string" && row.code.trim()) return row.code.trim()
        }
        return null
      })) ??
      undefined

    if (testSku) {
      console.log(`[Motors] Staging returnpolicyid on ${testSku} (commit:false)...`)
      await searchForSku(motorsFrame, testSku)
      const located = await findRowIndex(motorsFrame, testSku)
      if (located.status !== "ok") {
        console.log(`[Motors] row lookup FAILED: ${JSON.stringify(located)}`)
      } else {
        await setAndCommit(motorsFrame, located.index, "returnpolicyid", resolvedId, false)
        const readBack = await motorsFrame.evaluate((rowIndex) => {
          const w = window as unknown as { $?: (s: unknown) => { data: (k: string) => unknown } }
          const gridEl = document.getElementById("ebaytable")
          if (!w.$ || !gridEl) return null
          const inst = w.$(gridEl).data("codisto.grid") as {
            dataSet?: { data: Array<{ currentData?: Record<string, unknown> }> }
          }
          return inst?.dataSet?.data[rowIndex]?.currentData?.returnpolicyid ?? null
        }, located.index)
        console.log(`[Motors] staged value read back: ${JSON.stringify(readBack)} (expected "${resolvedId}")`)
        await page.reload({ waitUntil: "domcontentloaded" }) // discard staged change
      }
    } else {
      console.log("[Motors] No SKU given and grid has no loaded rows — skipped per-row staging test.")
    }

    console.log(`\nSummary: eBay value=${JSON.stringify(ebayValue)}, Motors value=${JSON.stringify(motorsValue)}`)
  } finally {
    await context.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
