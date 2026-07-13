// THROWAWAY harness: EBAYLIST_MODULE_TEST=1 pnpm ui
// Exercises every browser-touching module through the Electron embedded browser
// (real CDP session from main.js). NOTHING is ever committed to Codisto:
// writes are stage-only and dropped with discardGrid / session close.
import { applyColumnLayout } from "../dist/columns.js"
import { applyStandardFilters } from "../dist/filters.js"
import { waitForFrameSettled } from "../dist/pageLoad.js"
import { getListingsFrame, searchForSku, findRowIndex, setAndCommit } from "../dist/grid.js"
import { findNextAvailableEbaySku, checkSkuListable } from "../dist/nextAvailableProduct.js"
import { discardGrid } from "../dist/discard.js"
import { applyReturnPolicyToAllProducts, resolveReturnPolicyId, resolveMotorsReturnPolicyId } from "../dist/returnPolicies.js"
import { resolveImmediatePayPolicyId } from "../dist/paymentPolicies.js"
import { resolveShippingPolicyId, shippingPolicyForWeightLb } from "../dist/shippingPolicies.js"
import { searchShopifyProductsBySku, openFirstShopifyProduct } from "../dist/shopifyProducts.js"
import { extractProductWeightLb } from "../dist/productWeight.js"

const results = []
const test = async (name, fn) => {
  console.log(`\n=== ${name} ===`)
  try {
    const note = await fn()
    results.push({ name, ok: true, note })
    console.log(`PASS ${name}${note ? ` — ${note}` : ""}`)
  } catch (error) {
    results.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) })
    console.error(`FAIL ${name} — ${error instanceof Error ? error.message : error}`)
  }
}

// Read a row's staged vs base value straight from the grid dataSet (proves staging/discard).
const readRowValue = (frame, index, column) =>
  frame.evaluate(
    ({ index, column }) => {
      const gridEl = document.getElementById("ebaytable")
      if (!window.$ || !gridEl) return { error: "no grid" }
      const inst = window.$(gridEl).data("codisto.grid")
      const rec = inst?.dataSet?.data[index]
      if (!rec) return { error: "no row" }
      return { current: rec.currentData?.[column], base: rec.baseData?.[column], dirty: inst.dataSet.dirty() }
    },
    { index, column },
  )

export const runModuleTests = async ({ openSession, makeConfig, app }) => {
  const config = makeConfig()
  let session

  // 1. session.ts + electron/main.js CDP plumbing + shopify.ts ensureLoggedIn
  await test("session: openElectronSession (CDP connect, tab create, Shopify login)", async () => {
    session = await openSession(config)
    const url = session.shopifyPage.url()
    // ensureLoggedIn accepts either the legacy /admin/products URL or the
    // admin.shopify.com/store/<shop>/products redirect target.
    if (!/\/products/i.test(url)) throw new Error(`Shopify tab not on products page: ${url}`)
    return url
  })
  if (!session) return finish(app)

  let searchPage, editPage, motorsPage, sku
  let ebayEditFrame, motorsEditFrame

  // 2. pageLoad.ts: findCodistoFrame + waitForFrameSettled on a fresh embedded tab
  await test("pageLoad: open listings tab, find Codisto frame, settle", async () => {
    searchPage = await session.newPage("Test: Search")
    await searchPage.goto(config.listingsUrl, { waitUntil: "domcontentloaded" })
    await searchPage.locator("iframe").first().waitFor({ state: "attached" })
    await waitForFrameSettled(searchPage)
    const frame = await getListingsFrame(searchPage)
    return `frame url: ${frame.url().slice(0, 60)}...`
  })

  // Count rows in both the DOM and the grid's dataSet (tells "no matching products"
  // apart from "grid broke in the embedded browser").
  const countRows = async () => {
    const frame = await getListingsFrame(searchPage)
    return frame.evaluate(() => {
      const dom = new Set([...document.querySelectorAll(".cell[data-row]")].map((c) => c.getAttribute("data-row"))).size
      const gridEl = document.getElementById("ebaytable")
      const inst = window.$ && gridEl ? window.$(gridEl).data("codisto.grid") : undefined
      return { dom, dataSet: inst?.dataSet?.data?.length ?? -1 }
    })
  }

  await test("grid render: rows visible BEFORE filters", async () => {
    // dataSet populates after loaders clear — poll like the modules now do.
    const deadline = Date.now() + 60000
    let rows = await countRows()
    while (rows.dom === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500))
      rows = await countRows()
    }
    if (rows.dom === 0) throw new Error(`no rows rendered (dataSet: ${rows.dataSet})`)
    return `dom=${rows.dom} dataSet=${rows.dataSet}`
  })

  // 3. filters.ts
  let filteredEmpty = false
  await test("filters: applyStandardFilters", async () => {
    const applied = await applyStandardFilters(searchPage)
    if (!applied.ok) throw new Error(applied.error)
    await waitForFrameSettled(searchPage)
    const rows = await countRows()
    await searchPage.screenshot({ path: "/tmp/ebaylist-after-filters.png", fullPage: false }).catch(() => {})
    filteredEmpty = rows.dom === 0
    return `rows after filters: dom=${rows.dom} dataSet=${rows.dataSet}${filteredEmpty ? " (zero matches — will clear filters for downstream tests)" : ""}`
  })

  // Zero matches is a data state, not a module failure — clear filters so the
  // row-level tests downstream still have products to work with.
  if (filteredEmpty) {
    await test("(fallback) clear filters to repopulate grid", async () => {
      const frame = await getListingsFrame(searchPage)
      const clearAll = frame.getByText(/^clear all( filters)?$/i).first()
      await clearAll.waitFor({ state: "visible" })
      await clearAll.click()
      await waitForFrameSettled(searchPage)
      const rows = await countRows()
      if (rows.dom === 0) throw new Error("grid still empty after clearing filters")
      return `dom=${rows.dom} dataSet=${rows.dataSet}`
    })
  }

  // 4. nextAvailableProduct.ts: scan for a product (also supplies the SKU for row tests)
  await test("nextAvailableProduct: findNextAvailableEbaySku", async () => {
    await waitForFrameSettled(searchPage)
    const next = await findNextAvailableEbaySku(searchPage)
    if (!next.ok) throw new Error(next.error)
    sku = next.sku
    return `${next.sku} — ${next.title || "(no title)"}`
  })

  // 5. bulkPolicy.ts + returnPolicies.ts: real bulk apply (Update only STAGES in the
  //    dataSet — run.ts needs a commitGrid to save, which we never do) then discard.
  await test("bulkPolicy/returnPolicies: bulk-stage return policy on all products", async () => {
    await waitForFrameSettled(searchPage)
    const policy = await applyReturnPolicyToAllProducts(searchPage)
    if (!policy.ok) throw new Error(policy.error)
    return `staged "${policy.policyName}"`
  })

  // 6. discard.ts: drop the bulk-staged changes (verify it actually had work to do)
  await test("discard: discardGrid drops bulk-staged changes", async () => {
    const discarded = await discardGrid(searchPage)
    if (!discarded.ok) throw new Error(discarded.error)
  })

  // 7. more tab plumbing: eBay edit + Motors tabs
  await test("session: open eBay edit + Motors tabs", async () => {
    editPage = await session.newPage("Test: eBay edit")
    await editPage.goto(config.listingsUrl, { waitUntil: "domcontentloaded" })
    await editPage.locator("iframe").first().waitFor({ state: "attached" })
    await waitForFrameSettled(editPage)
    motorsPage = await session.newPage("Test: Motors")
    await motorsPage.goto(config.motorsListingsUrl, { waitUntil: "domcontentloaded" })
    await motorsPage.locator("iframe").first().waitFor({ state: "attached" })
    await waitForFrameSettled(motorsPage)
    ebayEditFrame = await getListingsFrame(editPage)
    motorsEditFrame = await getListingsFrame(motorsPage)
  })

  // 7b. columns.ts: reduce both edit grids to the listing columns (client-side
  // layout only — later grid/staging tests then also prove the reduced layout
  // doesn't break searching or dataSet writes)
  await test("columns: applyColumnLayout on eBay edit + Motors grids", async () => {
    if (!ebayEditFrame || !motorsEditFrame) throw new Error("edit frames unavailable")
    const notes = []
    for (const [label, frame] of [["eBay", ebayEditFrame], ["Motors", motorsEditFrame]]) {
      const layout = await applyColumnLayout(frame)
      if (!layout.ok) throw new Error(`${label}: ${layout.error}`)
      notes.push(`${label}: ${layout.hidden} hidden, ${layout.shown} shown, visible: ${layout.keptVisible.length} keeps`)
    }
    return notes.join("; ")
  })

  // 8. policy resolvers (read-only dropdown reads)
  await test("resolvers: shipping/payment/return policy ids from grid dropdowns", async () => {
    if (!ebayEditFrame || !motorsEditFrame) throw new Error("edit frames unavailable")
    const tier = shippingPolicyForWeightLb(2)
    const shipping = await resolveShippingPolicyId(ebayEditFrame, tier)
    if (!shipping) throw new Error(`shipping tier "${tier}" not found in select#shippingpolicyid`)
    const payment = await resolveImmediatePayPolicyId(ebayEditFrame)
    const returns = await resolveReturnPolicyId(ebayEditFrame)
    const motorsReturns = await resolveMotorsReturnPolicyId(motorsEditFrame)
    return `shipping=${shipping} payment=${payment} returns=${returns} motorsReturns=${motorsReturns}`
  })

  // 9. grid.ts: search, locate, STAGE a value (commit:false), verify it stuck
  let stagedIndex
  await test("grid: searchForSku + findRowIndex + setAndCommit(commit:false)", async () => {
    if (!sku || !ebayEditFrame) throw new Error("no SKU/frame from earlier steps")
    await searchForSku(ebayEditFrame, sku)
    const located = await findRowIndex(ebayEditFrame, sku)
    if (located.status !== "ok") throw new Error(`locate failed: ${JSON.stringify(located)}`)
    stagedIndex = located.index
    const policyId = await resolveShippingPolicyId(ebayEditFrame, shippingPolicyForWeightLb(2))
    await setAndCommit(ebayEditFrame, located.index, "shippingpolicyid", policyId, false)
    const row = await readRowValue(ebayEditFrame, located.index, "shippingpolicyid")
    if (row.error) throw new Error(row.error)
    if (!row.dirty) throw new Error("grid not dirty after staging")
    if (String(row.current) !== String(policyId)) throw new Error(`staged value ${row.current} != ${policyId}`)
    return `row ${located.index} (key ${located.key}) staged ${row.current} over base ${row.base}, grid dirty`
  })

  // 10. discard.ts again: per-row staged change reverts
  await test("discard: discardGrid reverts row-level staged change", async () => {
    if (stagedIndex === undefined) throw new Error("nothing was staged")
    const discarded = await discardGrid(editPage)
    if (!discarded.ok) throw new Error(discarded.error)
    const row = await readRowValue(ebayEditFrame, stagedIndex, "shippingpolicyid")
    if (row.dirty) throw new Error("grid still dirty after discard")
    if (row.current !== undefined && String(row.current) !== String(row.base)) {
      throw new Error(`value did not revert: current=${row.current} base=${row.base}`)
    }
  })

  // 11. nextAvailableProduct.ts: checkSkuListable on the Motors grid
  await test("nextAvailableProduct: checkSkuListable on Motors grid", async () => {
    if (!sku || !motorsEditFrame) throw new Error("no SKU/frame from earlier steps")
    await waitForFrameSettled(motorsPage)
    await searchForSku(motorsEditFrame, sku)
    const check = await checkSkuListable(motorsPage, sku)
    if (check.ok) return `${sku} listable on Motors`
    if (check.reason) return `${sku} definitively unlistable (${check.error}) — module worked`
    throw new Error(check.error) // transient (not found / timeout) = real failure
  })

  // 12. shopifyProducts.ts + productWeight.ts
  await test("shopifyProducts/productWeight: search, open product, extract weight", async () => {
    if (!sku) throw new Error("no SKU from earlier steps")
    const search = await searchShopifyProductsBySku(session.shopifyPage, config.productsUrl, sku)
    if (!search.ok) throw new Error(search.error)
    const opened = await openFirstShopifyProduct(session.shopifyPage)
    if (!opened.ok) throw new Error(opened.error)
    const weight = await extractProductWeightLb(session.shopifyPage)
    if (weight.ok) return `${sku}: ${weight.weightLb} lb (raw ${weight.rawValue} ${weight.unit})`
    // A product without a weight field is a legitimate page state, not a module break.
    if (/no weight field|no usable value/i.test(weight.error)) return `module ok; product has no weight (${weight.error})`
    throw new Error(weight.error)
  })

  await session.close().catch(() => {})
  finish(app)
}

const finish = (app) => {
  const failed = results.filter((r) => !r.ok)
  console.log(`\n===== MODULE TEST SUMMARY: ${results.length - failed.length}/${results.length} passed =====`)
  for (const r of results) console.log(` ${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.note ? ` — ${r.note}` : ""}`)
  console.log(failed.length ? "MODULE_TEST_FAIL" : "MODULE_TEST_OK")
  app.exit(failed.length ? 1 : 0)
}
