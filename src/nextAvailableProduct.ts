import type { Frame, Page } from "playwright"

import { findCodistoFrame } from "./pageLoad.js"
import { TIMEOUT_MS } from "./timeout.js"

type ExtractedRow = {
  sku: string
  title: string
  enabled: boolean | null
  hasError: boolean
  text: string
}

export type FindNextAvailableEbaySkuResult =
  | {
      ok: true
      sku: string
      title: string
    }
  | {
      ok: false
      error: string
      /** Set when the SKU's row was found but is unlistable — absent on transient failures (not found / timeout). */
      reason?: "enabled" | "error-badge"
    }

// Pure gating logic over the ordered list of rows seen so far. When startSku is
// given, only rows *after* the matching row are eligible (the start row itself is
// skipped). Exported for the self-check in nextAvailableProduct.test.ts.
export const pickNextAvailableSku = (
  rows: Pick<ExtractedRow, "sku" | "title" | "enabled" | "hasError">[],
  startSku?: string,
): FindNextAvailableEbaySkuResult => {
  const target = startSku?.trim()
  const targetLower = target?.toLowerCase()
  let startFound = !target

  for (const row of rows) {
    if (!startFound) {
      if (row.sku.toLowerCase() === targetLower) {
        startFound = true
      }
      continue
    }

    if (row.title?.startsWith("ZA@")) continue // ZA@ prefix marks products to skip

    if (row.enabled === false && !row.hasError) {
      return { ok: true, sku: row.sku, title: row.title ?? "" }
    }
  }

  if (rows.length === 0) {
    return { ok: false, error: "No product rows were found" }
  }

  if (target && !startFound) {
    return { ok: false, error: `Start SKU ${target} was not found` }
  }

  return { ok: false, error: "No disabled product without errors was found" }
}

export const findNextAvailableEbaySku = async (page: Page, startSku?: string): Promise<FindNextAvailableEbaySkuResult> => {
  try {
    const frame = await getListingsFrame(page)
    await frame.getByPlaceholder("Search items", { exact: true }).waitFor({ state: "visible" })

    const seenSkus = new Set<string>()
    const allRows: ExtractedRow[] = []
    let previousLastSku = ""

    for (let pass = 0; pass < 500; pass += 1) {
      const rows = await extractVisibleRows(frame)

      for (const row of rows) {
        if (!seenSkus.has(row.sku)) {
          seenSkus.add(row.sku)
          allRows.push(row)
        }
      }

      const result = pickNextAvailableSku(allRows, startSku)

      if (result.ok) {
        return result
      }

      const lastSku = rows.at(-1)?.sku ?? ""

      // Grid can no longer scroll — the accumulated result (error) is final.
      if (!lastSku || lastSku === previousLastSku) {
        return result
      }

      previousLastSku = lastSku
      await scrollProductGrid(frame)
    }

    return { ok: false, error: "Stopped scanning after 500 product grid scrolls" }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const getListingsFrame = findCodistoFrame

/**
 * Checks whether one specific SKU's row is listable (disabled, no error badge).
 * Meant for a grid already narrowed by the search box — the free-text search can
 * match sibling SKUs, so this finds the EXACT row rather than the first available one.
 * Polls while search results stream in.
 */
export const checkSkuListable = async (page: Page, sku: string): Promise<FindNextAvailableEbaySkuResult> => {
  try {
    const frame = await getListingsFrame(page)
    const wanted = sku.trim().toLowerCase()
    const deadline = Date.now() + TIMEOUT_MS

    for (;;) {
      const row = (await extractVisibleRows(frame)).find((candidate) => candidate.sku.toLowerCase() === wanted)
      if (row) {
        if (row.enabled === false && !row.hasError) {
          return { ok: true, sku: row.sku, title: row.title ?? "" }
        }
        return row.hasError
          ? { ok: false, error: "row has an error badge", reason: "error-badge" }
          : { ok: false, error: "already enabled", reason: "enabled" }
      }
      if (Date.now() >= deadline) {
        return { ok: false, error: `SKU ${sku} was not found in the grid` }
      }
      await frame.page().waitForTimeout(500)
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// The Codisto grid is a flat set of `.cell.colN.rowM` divs, each carrying
// data-row (viewport row index) and data-column-class (stable column id). We group
// cells by data-row and read the columns we care about:
//   code   -> SKU
//   name   -> title
//   status -> segmented Enabled/Disabled button group; the .Polaris-Button--pressed one is current
// Errors surface as Polaris critical/warning/attention badges in a row.
const extractVisibleRows = async (frame: Frame): Promise<ExtractedRow[]> => {
  return frame.evaluate(() => {
    const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ")
    const rowMap = new Map<string, ExtractedRow>()

    for (const cell of Array.from(document.querySelectorAll<HTMLElement>(".cell[data-row]"))) {
      const rowIndex = cell.getAttribute("data-row")
      if (rowIndex == null) continue

      let row = rowMap.get(rowIndex)
      if (!row) {
        row = { sku: "", title: "", enabled: null, hasError: false, text: "" }
        rowMap.set(rowIndex, row)
      }

      const colClass = cell.getAttribute("data-column-class") ?? ""
      const text = normalize(cell.textContent)
      row.text += ` ${text}`

      if (colClass === "code") {
        row.sku = text
      } else if (colClass === "name") {
        row.title = text
      } else if (colClass === "status") {
        const pressed = cell.querySelector(".Polaris-Button--pressed .Polaris-Button__Text")
        if (pressed) row.enabled = /^enabled$/i.test(normalize(pressed.textContent))
      }

      // A critical/warning/attention Polaris badge in the row marks a listing error.
      if (Array.from(cell.querySelectorAll<HTMLElement>("[class*='Badge']")).some((b) => /critical|warning|attention/i.test(b.className))) {
        row.hasError = true
      }
    }

    return Array.from(rowMap.entries())
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, row]) => row)
      .filter((row) => /^[A-Z]{2,}\d/i.test(row.sku))
  })
}

const scrollProductGrid = async (frame: Frame) => {
  await frame.evaluate(() => {
    const skuPattern = /\b[A-Z]{2,}\d+[A-Z0-9-]*\b/i
    const scrollable = Array.from(document.querySelectorAll<HTMLElement>("*"))
      .filter((element) => element.scrollHeight > element.clientHeight + 50)
      .sort((left, right) => {
        const rightHasProducts = skuPattern.test(right.textContent ?? "") ? 1 : 0
        const leftHasProducts = skuPattern.test(left.textContent ?? "") ? 1 : 0
        return rightHasProducts - leftHasProducts || right.clientHeight - left.clientHeight
      })[0]

    if (scrollable) {
      scrollable.scrollTop += Math.max(300, Math.floor(scrollable.clientHeight * 0.8))
      return
    }

    window.scrollBy(0, Math.max(300, Math.floor(window.innerHeight * 0.8)))
  })
  await frame.page().waitForTimeout(250)
}
