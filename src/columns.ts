import type { Frame } from "playwright"

import { waitForFrameLoaders } from "./pageLoad.js"

// Reduces the Codisto bulk grid to the columns the operator actually uses while
// listing: status, eBay title, eBay price, quantity, Best Offer, category,
// payment/shipping/return policy, and Condition. Everything else (price/quantity
// operators, sales tax, product identifiers, ~250 item specifics, descriptions,
// GPSR contacts, ...) is hidden.
//
// Mechanism (discovered via src/tryColumns.ts): the grid instance exposes
// showColumns/hideColumns(classIds) which flip conf.columns[].visible, re-render,
// and persist via setConfig() — the same path as the grid's own "add fields"
// picker. We compute the hide list from conf.columns at runtime instead of
// hardcoding the ~280 ids, so newly-added item-specific columns get hidden too.

// data-column class ids to KEEP visible (stable ids, not display labels).
// Both grids' loops write several of these via grid.ts (status, policies,
// primarycategoryid), so keep anything the automation stages user-visible.
const KEEP_COLUMNS = [
  "title", // eBay title
  "ebaypriceresult", // eBay price (result)
  "quantityresult", // eBay quantity (result)
  "bestoffer", // Best Offer
  "primarycategoryid", // eBay categories (group header column)
  "primarycategory", // Category
  "paymentpolicyid", // Payment policy
  "shippingpolicyid", // Shipping policy
  "returnpolicyid", // Return policy
  "conditionid", // Condition (hidden by default — must be shown)
]

// Whole column groups to leave untouched. `locked` (checkbox, SKU code, Product,
// Image, Shopify Price) and `status` (Listing status, Enabled) are non-configurable
// in Codisto's own picker, and the automation reads their DOM cells
// (nextAvailableProduct.ts) — hiding them would break product scanning.
const KEEP_GROUPS = ["locked", "status", "blank"]

export type ApplyColumnLayoutResult =
  | { ok: true; hidden: number; shown: number; keptVisible: string[] }
  | { ok: false; error: string }

/** Shows exactly the listing columns (KEEP_COLUMNS + KEEP_GROUPS) and hides the rest. */
export const applyColumnLayout = async (frame: Frame): Promise<ApplyColumnLayoutResult> => {
  try {
    type EvalResult = { error: string } | { error?: undefined; hidden: number; shown: number; missing: string[] }
    const result: EvalResult = await frame.evaluate(
      ({ keepColumns, keepGroups }): EvalResult => {
        const w = window as unknown as { $?: (s: unknown) => { data: (k: string) => unknown } }
        const gridEl = document.getElementById("ebaytable")
        if (!w.$ || !gridEl) return { error: "Codisto grid was not found on the page" }
        const inst = w.$(gridEl).data("codisto.grid") as
          | {
              conf?: { columns?: Array<{ class?: string; visible?: boolean; configurable?: boolean; group?: { name?: string } }> }
              showColumns?: (cols: string[]) => void
              hideColumns?: (cols: string[]) => void
            }
          | undefined
        const columns = inst?.conf?.columns
        if (!columns || typeof inst?.showColumns !== "function" || typeof inst?.hideColumns !== "function") {
          return { error: "Codisto grid instance has no column API (showColumns/hideColumns)" }
        }

        // Two passes because a class can appear twice (e.g. ebaypriceresult as group
        // header + column) and show/hideColumns match by class: first collect every
        // protected id, then decide — KEEP_COLUMNS are force-shown, KEEP_GROUPS'
        // NON-configurable members are left exactly as they are (SKU code, Product,
        // Image, ...), and everything else — including kept groups' configurable
        // members like Collection/Tags — is hidden.
        const protectedIds = new Set<string>()
        for (const column of columns) {
          const id = column.class
          const groupKept = keepGroups.includes(column.group?.name ?? "") && column.configurable !== true
          if (id && (keepColumns.includes(id) || groupKept)) protectedIds.add(id)
        }
        const toShow = new Set<string>()
        const toHide = new Set<string>()
        for (const column of columns) {
          const id = column.class
          if (!id) continue
          if (protectedIds.has(id)) {
            if (keepColumns.includes(id) && !column.visible) toShow.add(id)
          } else if (column.visible) {
            toHide.add(id)
          }
        }

        // Missing KEEP columns (Codisto renamed/removed one) are worth surfacing —
        // the layout still applies, but the caller's log should mention them.
        const present = new Set(columns.map((column) => column.class))
        const missing = keepColumns.filter((id) => !present.has(id))

        inst.hideColumns([...toHide])
        inst.showColumns([...toShow])
        return { hidden: toHide.size, shown: toShow.size, missing }
      },
      { keepColumns: KEEP_COLUMNS, keepGroups: KEEP_GROUPS },
    )

    if (result.error !== undefined) {
      return { ok: false, error: result.error }
    }
    if (result.missing.length > 0) {
      return { ok: false, error: `Grid is missing expected column(s): ${result.missing.join(", ")} — layout applied for the rest` }
    }

    // Let the queued re-render/refresh finish before anyone touches the dataSet —
    // a ds.set() racing the post-layout refresh gets its staged value dropped
    // (seen live in the tryColumns harness). Then confirm the KEEP columns'
    // headers actually render (visibility applies synchronously to conf, but the
    // header re-render is queued).
    await frame.waitForTimeout(500)
    await waitForFrameLoaders(frame)
    const keptVisible = await frame.evaluate(
      (keepColumns) =>
        keepColumns.filter((id) =>
          [...document.querySelectorAll<HTMLElement>(`.header[data-column='${id}']`)].some((h) => h.offsetParent !== null),
        ),
      KEEP_COLUMNS,
    )
    const notRendered = KEEP_COLUMNS.filter((id) => !keptVisible.includes(id) && id !== "primarycategoryid")
    // primarycategoryid is the categories group-header column — the grid keeps its
    // header display:none while the group is expanded, so don't demand it renders.
    if (notRendered.length > 0) {
      return { ok: false, error: `Column(s) did not become visible: ${notRendered.join(", ")}` }
    }

    return { ok: true, hidden: result.hidden, shown: result.shown, keptVisible }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
