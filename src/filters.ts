import type { Frame, Page } from "playwright"

// The Codisto eBay bulk grid filters each column via a popover opened from a search
// glyph on the column header. Every run applies the SAME three filters:
//   - Image           → keep only "Has images"
//   - Quantity result → keep only positive quantities (>= 1); drop Not set / 0 / negatives
//   - Payment policy  → keep only "Not set"
//   - Shopify status  → keep only "Active" (drop Archived / Draft)
export type ApplyFiltersResult = { ok: true } | { ok: false; error: string }

// data-column values on the grid headers (stable ids, not display labels).
const IMAGE_COLUMN = "image"
const QUANTITY_COLUMN = "quantityresult"
const PAYMENT_POLICY_COLUMN = "paymentpolicyid"
const SHOPIFY_STATUS_COLUMN = "externalstatus"

// How to pick which option checkboxes stay ticked. Serializable so it can cross into
// the page context (a real function can't) — "only" keeps one exact label, "positiveInt"
// keeps integer labels >= 1 (so Not set / 0 / negatives drop out).
type Selection = { mode: "only"; label: string } | { mode: "positiveInt" }

export const applyStandardFilters = async (page: Page): Promise<ApplyFiltersResult> => {
  try {
    const frame = await getListingsFrame(page)
    await clearExistingFilters(frame)

    await setColumnFilter(frame, IMAGE_COLUMN, { mode: "only", label: "Has images" })
    await setColumnFilter(frame, QUANTITY_COLUMN, { mode: "positiveInt" })
    await setColumnFilter(frame, PAYMENT_POLICY_COLUMN, { mode: "only", label: "Not set" })
    await setColumnFilter(frame, SHOPIFY_STATUS_COLUMN, { mode: "only", label: "Active" })

    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const getListingsFrame = async (page: Page) => {
  await page.locator("iframe").first().waitFor({ state: "attached", timeout: 30000 })
  const frame = page.frames().find((candidate) => candidate.url().includes("codisto"))
  if (!frame) {
    throw new Error("Marketplace Connect frame was not found")
  }
  return frame
}

// Reset to a clean slate so re-running doesn't stack onto leftover filters.
// The active-filter bar shows a "Clear all" control only when filters exist.
const clearExistingFilters = async (frame: Frame) => {
  const clearAll = frame.getByText(/^clear all( filters)?$/i).first()
  if (await clearAll.isVisible().catch(() => false)) {
    await clearAll.click()
    await frame.waitForTimeout(500)
  }
}

// Open a column's filter popover, tick exactly the wanted options, Apply. The toggling
// and Apply happen in-page (native input.click() fires the change events Codisto/Polaris
// listen for) so far-right columns whose popover renders off-screen still work — a
// Playwright click there fails with "outside of the viewport".
const setColumnFilter = async (frame: Frame, column: string, selection: Selection) => {
  await openColumnFilterPopover(frame, column)

  const toggled = await frame.evaluate((sel: Selection) => {
    const isVisible = (el: Element) => (el as HTMLElement).offsetParent !== null
    const normalize = (value: string) => value.trim().replace(/\s+/g, " ")
    const keep = (label: string) => {
      if (sel.mode === "only") return label === sel.label
      const n = Number(label.replace(/,/g, ""))
      return Number.isInteger(n) && n >= 1
    }

    const inputs = [...document.querySelectorAll<HTMLInputElement>("input.apply-filter-check")].filter(isVisible)
    let kept = 0
    for (const input of inputs) {
      const label = normalize(input.closest("label")?.textContent ?? "")
      const want = keep(label)
      if (want) kept += 1
      if (input.checked !== want) input.click()
    }
    return { seen: inputs.length, kept }
  }, selection)

  if (toggled.seen === 0) {
    throw new Error(`No filter options found for column '${column}'`)
  }
  if (toggled.kept === 0) {
    throw new Error(`Filter for column '${column}' matched no options — none would remain selected`)
  }

  // Let the checkbox changes register before applying, then click the Apply button that
  // belongs to THIS popover (scoped from the toggled inputs — a page-wide "first visible
  // Apply" can hit a different/lingering popover and silently drop the selection).
  await frame.waitForTimeout(300)
  const applied = await frame.evaluate(() => {
    const isVisible = (el: Element) => (el as HTMLElement).offsetParent !== null
    const normalize = (value: string) => value.trim().replace(/\s+/g, " ")
    const input = [...document.querySelectorAll<HTMLInputElement>("input.apply-filter-check")].find(isVisible)
    if (!input) return false
    let popover: HTMLElement | null = input.parentElement
    const hasApply = (el: HTMLElement) =>
      [...el.querySelectorAll("button")].some((b) => normalize(b.textContent ?? "").toLowerCase() === "apply")
    while (popover && !hasApply(popover)) popover = popover.parentElement
    if (!popover) return false
    const apply = [...popover.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => isVisible(b) && normalize(b.textContent ?? "").toLowerCase() === "apply",
    )
    if (!apply) return false
    apply.click()
    return true
  })

  if (!applied) {
    throw new Error(`Apply button not found for column '${column}'`)
  }

  await frame.waitForTimeout(800)
}

const openColumnFilterPopover = async (frame: Frame, column: string) => {
  const headerSelector = `.header[data-column='${column}']`
  if ((await frame.locator(headerSelector).count()) === 0) {
    throw new Error(`Filter column '${column}' was not found`)
  }

  // Center the (possibly far-right) column in the grid's horizontal scroller and
  // un-hide its filter glyph (display:none until the header is hovered). Scrolling the
  // real scroll ancestor by scrollLeft avoids Playwright's "outside of the viewport"
  // failures on the grid's custom horizontal scroll.
  await frame.evaluate((selector) => {
    const header = document.querySelector(selector) as HTMLElement | null
    if (!header) return
    let scroller: HTMLElement | null = header.parentElement
    while (scroller) {
      const style = getComputedStyle(scroller)
      if ((style.overflowX === "auto" || style.overflowX === "scroll") && scroller.scrollWidth > scroller.clientWidth) break
      scroller = scroller.parentElement
    }
    if (scroller) {
      const headerRect = header.getBoundingClientRect()
      const scrollerRect = scroller.getBoundingClientRect()
      scroller.scrollLeft += headerRect.left - scrollerRect.left - (scroller.clientWidth - headerRect.width) / 2
    }
    const glyph = header.querySelector(".filter-by") as HTMLElement | null
    if (glyph) {
      glyph.style.display = "inline-block"
      glyph.style.visibility = "visible"
    }
  }, headerSelector)
  await frame.waitForTimeout(500)

  const glyph = frame.locator(`${headerSelector} .filter-by`).first()
  try {
    await glyph.click({ timeout: 5000 })
  } catch {
    await glyph.dispatchEvent("click") // bypass viewport check if the column still isn't fully on-screen
  }
  await frame.getByPlaceholder("Search selections").first().waitFor({ state: "visible", timeout: 15000 })
  // Options load lazily behind a loading-skeleton; wait for a real option (skeleton
  // placeholders lack the apply-filter-check class) before reading/toggling.
  await frame.locator("input.apply-filter-check:visible").first().waitFor({ state: "visible", timeout: 15000 })
  await frame.waitForTimeout(300)
}
