import type { Page } from "playwright"

import { saveRowValue } from "./grid.js"

// The grid's `paymentpolicyid` column holds the eBay payment policy id. This is the
// option value for "eBay Payments:Immediate pay" in select#paymentpolicyid, read live
// from the bulk grid. The UI stages it as a string, so we do too.
const IMMEDIATE_PAY_POLICY_ID = "197165154026"

export type SetPaymentPolicyResult =
  | {
      ok: true
      sku: string
    }
  | {
      ok: false
      sku: string
      error: string
    }

/** Sets one product's eBay payment policy to Immediate pay (run after its category is set). */
export const setPaymentPolicy = async (
  page: Page,
  sku: string,
  policyId = IMMEDIATE_PAY_POLICY_ID,
  options: { commit?: boolean } = {},
): Promise<SetPaymentPolicyResult> => {
  const normalizedSku = sku.trim()

  if (!normalizedSku) {
    return { ok: false, sku, error: "SKU is required" }
  }

  try {
    const saved = await saveRowValue(page, normalizedSku, "paymentpolicyid", policyId, options)
    return saved.ok
      ? { ok: true, sku: normalizedSku }
      : { ok: false, sku: normalizedSku, error: saved.error }
  } catch (error) {
    return { ok: false, sku: normalizedSku, error: error instanceof Error ? error.message : String(error) }
  }
}
