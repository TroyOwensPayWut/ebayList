// Throwaway harness: pnpm tsx src/tryDiscard.ts [--inspect]
// Stages a change on the first grid row to make the grid dirty, then:
//   --inspect  dump every save/discard/cancel-ish control in the frame and exit
//   (default)  click the discard button via discardGrid() and verify the grid
//              is clean and the staged value reverted. Nothing is ever committed.
import type { Frame } from "playwright"

import { buildConfig } from "./config.js"
import { launchAuthenticated } from "./shopify.js"
import { getListingsFrame } from "./grid.js"
import { waitForFrameSettled } from "./pageLoad.js"
import { discardGrid } from "./discard.js"

const readRow = async (frame: Frame, index: number, column: string) =>
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
      return { current: rec.currentData?.[column], base: rec.baseData?.[column], dirty: inst!.dataSet!.dirty() }
    },
    { index, column },
  )

// Stage a DIFFERENT valid shipping policy on row 0 so the grid goes dirty (never committed).
const stageDirtyChange = async (frame: Frame) =>
  frame.evaluate(() => {
    const w = window as unknown as { $?: (s: unknown) => { data: (k: string) => unknown } }
    const gridEl = document.getElementById("ebaytable")
    if (!w.$ || !gridEl) throw new Error("no grid")
    const inst = w.$(gridEl).data("codisto.grid") as {
      dataSet?: {
        data: Array<{ key?: number; currentData?: Record<string, unknown>; baseData?: Record<string, unknown> }>
        set: (i: number, c: string, v: unknown) => void
        dirty: () => boolean
      }
    }
    const ds = inst?.dataSet
    if (!ds) throw new Error("no dataSet")
    const index = ds.data.findIndex((r) => r && typeof r.key === "number")
    if (index < 0) throw new Error("no loaded row")
    const row = ds.data[index]
    const currentValue = String((row.currentData ?? row.baseData ?? {}).shippingpolicyid ?? "")
    const select = document.querySelector<HTMLSelectElement>("select#shippingpolicyid")
    if (!select) throw new Error("no shippingpolicyid select")
    const other = Array.from(select.options).find((o) => o.value && o.value !== currentValue)
    if (!other) throw new Error("no alternate policy option")
    ds.set(index, "shippingpolicyid", other.value)
    return { index, was: currentValue, stagedTo: other.value, dirty: ds.dirty() }
  })

const dumpControls = async (frame: Frame) =>
  frame.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("button, a, input[type=button], input[type=submit], [role=button]"))
    return nodes
      .map((el) => {
        const rect = (el as HTMLElement).getBoundingClientRect()
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || undefined,
          class: el.className && typeof el.className === "string" ? el.className : undefined,
          text: (el.textContent || (el as HTMLInputElement).value || "").trim().slice(0, 60),
          visible: rect.width > 0 && rect.height > 0,
        }
      })
      .filter((c) => c.visible && (c.text || c.id || c.class))
  })

const main = async () => {
  const inspect = process.argv.includes("--inspect")
  const config = buildConfig({ authOnly: false, headless: false, slowMoMs: 0 })
  const context = await launchAuthenticated(config)

  try {
    const page = await context.newPage()
    await page.goto(config.listingsUrl, { waitUntil: "domcontentloaded" })
    await waitForFrameSettled(page)
    const frame = await getListingsFrame(page)
    // Give the virtualized grid a moment to load rows.
    await frame.waitForSelector("#ebaytable")
    await waitForFrameSettled(page)

    console.log("Controls BEFORE staging:")
    console.table((await dumpControls(frame)).filter((c) => /save|discard|cancel|revert|undo|change/i.test(`${c.text} ${c.id} ${c.class}`)))

    const staged = await stageDirtyChange(frame)
    console.log("Staged:", staged)
    const before = await readRow(frame, staged.index, "shippingpolicyid")
    console.log("Row after staging:", before)

    if (inspect) {
      await frame.waitForTimeout(1500) // let any save-bar animate in
      for (const candidate of page.frames()) {
        const matches = (await dumpControls(candidate).catch(() => [])).filter((c) =>
          /save|discard|cancel|revert|undo|change/i.test(`${c.text} ${c.id} ${c.class}`),
        )
        if (matches.length) {
          console.log(`\nFrame ${candidate === page.mainFrame() ? "(main page)" : candidate.url().slice(0, 100)}:`)
          console.table(matches)
        }
      }
      const saveBar = await page.evaluate(() => {
        const bar = document.querySelector("ui-save-bar, [class*='ContextualSaveBar' i], [class*='save-bar' i]")
        return bar ? { tag: bar.tagName.toLowerCase(), html: bar.outerHTML.slice(0, 2000) } : null
      })
      console.log("\nTop-level save bar element:", saveBar)
      console.log("Inspect only — closing without saving or discarding (staged change dies with the browser).")
      return
    }

    const discarded = await discardGrid(page)
    if (!discarded.ok) throw new Error(`Discard failed: ${discarded.error}`)

    const after = await readRow(frame, staged.index, "shippingpolicyid")
    console.log("Row after discard:", after)
    const reverted = String((after as { current?: unknown }).current ?? "") === staged.was && (after as { dirty?: boolean }).dirty === false
    console.log(reverted ? "DISCARD OK: value reverted and grid is clean" : "DISCARD FAILED: value or dirty flag did not revert")
    if (!reverted) process.exitCode = 1
  } finally {
    await context.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
