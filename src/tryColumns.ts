// Throwaway harness: pnpm tsx src/tryColumns.ts [--motors] [<SKU>]
// Verifies columns.ts against the live grid: applies the column layout, lists
// every still-visible header (expect only the listing columns + locked/status
// groups), and — when a SKU is given — proves the main-loop plumbing still works
// with columns hidden: searchForSku > findRowIndex > stage a value (NO commit,
// reload discards it). Run for both grids:
//   pnpm tsx src/tryColumns.ts <SKU>
//   pnpm tsx src/tryColumns.ts --motors <SKU>
import { buildConfig } from "./config.js"
import { launchAuthenticated } from "./shopify.js"
import { applyColumnLayout } from "./columns.js"
import { findRowIndex, getListingsFrame, searchForSku, setAndCommit } from "./grid.js"
import { waitForFrameSettled } from "./pageLoad.js"

const main = async () => {
  const motors = process.argv.includes("--motors")
  const sku = process.argv.slice(2).find((arg) => !arg.startsWith("--"))
  const config = buildConfig({ authOnly: false, headless: false, slowMoMs: 0 })
  const url = motors ? config.motorsListingsUrl : config.listingsUrl
  const context = await launchAuthenticated(config)

  try {
    const page = await context.newPage()
    console.log(`Opening ${motors ? "eBay Motors" : "eBay"} grid at ${url}...`)
    await page.goto(url, { waitUntil: "domcontentloaded" })
    await waitForFrameSettled(page)
    const frame = await getListingsFrame(page)

    console.log("Applying column layout...")
    const layout = await applyColumnLayout(frame)
    if (!layout.ok) throw new Error(`applyColumnLayout failed: ${layout.error}`)
    console.log(`Layout applied: ${layout.hidden} hidden, ${layout.shown} shown.`)
    console.log(`KEEP columns rendering: ${layout.keptVisible.join(", ")}`)

    const visibleHeaders = await frame.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".header[data-column]")]
        .filter((h) => h.offsetParent !== null)
        .map((h) => `${h.getAttribute("data-column")} ('${(h.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40)}')`),
    )
    console.log(`\nVisible headers after layout (${visibleHeaders.length}):`)
    for (const header of visibleHeaders) console.log(`  ${header}`)

    // Re-apply to prove idempotence (second run should hide/show nothing).
    const again = await applyColumnLayout(frame)
    if (!again.ok) throw new Error(`Second applyColumnLayout failed: ${again.error}`)
    console.log(`\nIdempotence: second apply hid ${again.hidden}, showed ${again.shown} (expect 0/0).`)

    if (!sku) {
      const firstSkus = await frame.evaluate(() => {
        const w = window as unknown as { $?: (s: unknown) => { data: (k: string) => unknown } }
        const inst = w.$!(document.getElementById("ebaytable")).data("codisto.grid") as {
          dataSet?: { data?: Array<{ currentData?: Record<string, unknown>; baseData?: Record<string, unknown> }> }
        }
        return (inst.dataSet?.data ?? [])
          .map((rec) => (rec?.currentData ?? rec?.baseData ?? {}).code)
          .filter((code): code is string => typeof code === "string" && code.length > 0)
          .slice(0, 5)
      })
      console.log(`\nNo SKU given — skipping the search/stage check. First SKUs in grid: ${firstSkus.join(", ")}`)
      return
    }

    // Prove the main-loop plumbing still works with columns hidden.
    console.log(`\nSearching for ${sku} with reduced columns...`)
    await searchForSku(frame, sku)
    const located = await findRowIndex(frame, sku)
    if (located.status !== "ok") throw new Error(`Locate failed with reduced columns: ${JSON.stringify(located)}`)
    console.log(`Row located at index ${located.index} (key ${located.key}).`)

    console.log("Staging a Best Offer toggle (no commit — reload discards)...")
    await setAndCommit(frame, located.index, "bestoffer", -1, false)
    const staged = await frame.evaluate((index) => {
      const w = window as unknown as { $?: (s: unknown) => { data: (k: string) => unknown } }
      const inst = w.$!(document.getElementById("ebaytable")).data("codisto.grid") as {
        dataSet: { data: Array<{ currentData?: Record<string, unknown> }>; dirty: () => boolean }
      }
      return { current: inst.dataSet.data[index]?.currentData?.bestoffer, dirty: inst.dataSet.dirty() }
    }, located.index)
    console.log(`Staged bestoffer: ${JSON.stringify(staged)} (expect current=-1, dirty=true)`)
    console.log(String(staged.current) === "-1" && staged.dirty ? "STAGE OK" : "STAGE FAILED")
    console.log("Reloading to discard the staged change...")
    await page.reload({ waitUntil: "domcontentloaded" })
    await waitForFrameSettled(page)
  } finally {
    await context.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
