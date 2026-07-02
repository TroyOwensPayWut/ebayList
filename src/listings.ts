import type { Page } from "playwright"

import { saveRowValue } from "./grid.js"

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
// dataSet (-1 = enabled, 0 = disabled — Codisto uses -1 for true everywhere). Saved
// through the grid data layer (see grid.ts) — UI clicks only stage changes, which
// made products enable one commit late. waitForCommit inside saveRowValue is the
// persistence check: the grid only clears its dirty flag once the server accepts.
export const STATUS_ENABLED = -1

export const enableEbayProduct = async (page: Page, sku: string): Promise<EnableEbayProductResult> => {
  const normalizedSku = sku.trim()

  if (!normalizedSku) {
    return { ok: false, sku, error: "SKU is required" }
  }

  try {
    const saved = await saveRowValue(page, normalizedSku, "status", STATUS_ENABLED)
    return saved.ok
      ? { ok: true, sku: normalizedSku }
      : { ok: false, sku: normalizedSku, error: saved.error }
  } catch (error) {
    return { ok: false, sku: normalizedSku, error: error instanceof Error ? error.message : String(error) }
  }
}
