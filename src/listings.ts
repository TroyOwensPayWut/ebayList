import type { Frame, Page } from "playwright"

import { findRowIndex, getListingsFrame, searchForSku, setAndCommit, waitForCommit } from "./categories.js"

export type EnableEbayProductResult =
  | {
      ok: true
      sku: string
    }
  | {
      ok: false
      sku: string
      error: string
    }

// The grid's Enabled/Disabled segmented button is the `status` column in the Codisto
// dataSet (-1 = enabled, 0 = disabled — Codisto uses -1 for true everywhere). Clicking
// the button only STAGES the change; it isn't saved until the next dataSet.commit(),
// which is why UI clicks appeared to enable the wrong product a step late. So we write
// the data layer directly and commit, exactly like setEbayCategory does.
const STATUS_ENABLED = -1

export const enableEbayProduct = async (page: Page, sku: string): Promise<EnableEbayProductResult> => {
  const normalizedSku = sku.trim()

  if (!normalizedSku) {
    return { ok: false, sku, error: "SKU is required" }
  }

  try {
    const frame = await getListingsFrame(page)
    await searchForSku(frame, normalizedSku)

    const located = await findRowIndex(frame, normalizedSku)
    if (located.status === "nogrid") {
      return { ok: false, sku: normalizedSku, error: "Codisto grid was not found on the page" }
    }
    if (located.status === "notfound") {
      return { ok: false, sku: normalizedSku, error: `No listing found for SKU '${normalizedSku}'` }
    }
    if (located.status === "multiple") {
      return { ok: false, sku: normalizedSku, error: `Found ${located.count} listings for SKU '${normalizedSku}'` }
    }

    if ((await readStatus(frame, located.index)) === STATUS_ENABLED) {
      return { ok: true, sku: normalizedSku }
    }

    await setAndCommit(frame, located.index, "status", STATUS_ENABLED)

    const settled = await waitForCommit(frame)
    if (!settled.ok) {
      return { ok: false, sku: normalizedSku, error: settled.error }
    }

    const finalStatus = await readStatus(frame, located.index)
    return finalStatus === STATUS_ENABLED
      ? { ok: true, sku: normalizedSku }
      : { ok: false, sku: normalizedSku, error: `Listing did not become enabled for SKU '${normalizedSku}' (status=${finalStatus})` }
  } catch (error) {
    return { ok: false, sku: normalizedSku, error: error instanceof Error ? error.message : String(error) }
  }
}

const readStatus = async (frame: Frame, index: number) => {
  return frame.evaluate((rowIndex) => {
    const w = window as unknown as { $?: (s: unknown) => { data: (k: string) => unknown } }
    const $ = w.$
    const gridEl = document.getElementById("ebaytable")
    if (!$ || !gridEl) throw new Error("Codisto grid disappeared")
    const inst = $(gridEl).data("codisto.grid") as {
      dataSet?: { data: Array<{ currentData?: Record<string, unknown>; baseData?: Record<string, unknown> }> }
    }
    const rec = inst?.dataSet?.data[rowIndex]
    if (!rec) throw new Error("Codisto grid row disappeared")
    const row = rec.currentData || rec.baseData || {}
    return Number(row.status)
  }, index)
}
