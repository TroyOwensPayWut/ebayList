import type { Frame, Page } from "playwright"

import { getListingsFrame, resolveSelectValueByLabel, saveRowValue } from "./grid.js"

// The grid's `paymentpolicyid` column holds the eBay payment policy id. The id is
// resolved live from select#paymentpolicyid by label so a re-created policy keeps
// working; the hardcoded id is only a fallback for when the dropdown can't be read.
const IMMEDIATE_PAY_LABEL = "eBay Payments:Immediate pay"
const IMMEDIATE_PAY_POLICY_ID = "197165154026"

/** Resolves the Immediate pay policy id from the grid dropdown, falling back to the last known id. */
export const resolveImmediatePayPolicyId = async (frame: Frame): Promise<string> =>
  (await resolveSelectValueByLabel(frame, "paymentpolicyid", IMMEDIATE_PAY_LABEL)) ?? IMMEDIATE_PAY_POLICY_ID

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
  policyId?: string,
  options: { commit?: boolean } = {},
): Promise<SetPaymentPolicyResult> => {
  const normalizedSku = sku.trim()

  if (!normalizedSku) {
    return { ok: false, sku, error: "SKU is required" }
  }

  try {
    const id = policyId ?? (await resolveImmediatePayPolicyId(await getListingsFrame(page)))
    const saved = await saveRowValue(page, normalizedSku, "paymentpolicyid", id, options)
    return saved.ok
      ? { ok: true, sku: normalizedSku }
      : { ok: false, sku: normalizedSku, error: saved.error }
  } catch (error) {
    return { ok: false, sku: normalizedSku, error: error instanceof Error ? error.message : String(error) }
  }
}
