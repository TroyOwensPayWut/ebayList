import type { Frame, Page } from "playwright"

import { getListingsFrame, saveRowValue } from "./grid.js"

// Weight-tiered eBay shipping policies, exactly as named in the policy dropdown.
// Sorted by upper bound; first tier whose max the weight fits under wins
// (upper-inclusive, so 3 lb → "W1-3"). Tiers with a gap above them (0.99→1,
// 299→300) round up to the next tier — overshipping beats undershipping.
const TIERS: { maxLb: number; policyName: string }[] = [
  { maxLb: 0.5, policyName: "W0-0.5 | $4 | DOM/GSP" },
  { maxLb: 0.75, policyName: "W0.51-0.75 | $5 | DOM/GSP" },
  { maxLb: 0.99, policyName: "W0.75-0.99 | $6 | DOM/GSP" },
  { maxLb: 3, policyName: "W1-3 | $8.5 | DOM/GSP" },
  { maxLb: 8, policyName: "W3-8 | $11 | DOM/GSP" },
  { maxLb: 12, policyName: "W8-12 | $15 | DOM/GSP" },
  { maxLb: 20, policyName: "W12-20 | $20 | DOM/GSP" },
  { maxLb: 30, policyName: "W20-30 | $25 | DOM" },
  { maxLb: 40, policyName: "W30-40 | $30 | DOM" },
  { maxLb: 50, policyName: "W40-50 | $35 | DOM" },
  { maxLb: 75, policyName: "W50-75 | $60 | DOM" },
  { maxLb: 150, policyName: "W75-150 | $100 | DOM" },
  { maxLb: 299, policyName: "W151-299 | $350 | DOM" },
  { maxLb: 499, policyName: "W300-499 | $500 | DOM" },
  { maxLb: Infinity, policyName: "W500+ | $700 | DOM" },
]

/** Returns the shipping policy name for a weight in pounds, or null for zero/negative/NaN. */
export const shippingPolicyForWeightLb = (weightLb: number): string | null => {
  if (!Number.isFinite(weightLb) || weightLb <= 0) {
    // ponytail: Infinity lb would truthfully be W500+, but a non-finite weight is a bug upstream
    return null
  }

  return TIERS.find((tier) => weightLb <= tier.maxLb)?.policyName ?? null
}

// Policy IDs are resolved live from the grid's select#shippingpolicyid by label
// (instead of hardcoding 15 IDs) so re-created policies keep working.
export const resolveShippingPolicyId = async (frame: Frame, policyName: string): Promise<string | null> =>
  frame.evaluate((wanted) => {
    const select = document.querySelector<HTMLSelectElement>("select#shippingpolicyid")
    if (!select) return null
    for (const option of Array.from(select.options)) {
      if (option.label.trim() === wanted) return option.value
    }
    return null
  }, policyName)

export type SetShippingPolicyResult =
  | { ok: true; sku: string; weightLb: number; policyName: string; policyId: string }
  | { ok: false; sku: string; error: string }

/** Picks the weight tier for weightLb and saves it as the SKU's eBay shipping policy. */
export const setShippingPolicyByWeight = async (
  page: Page,
  sku: string,
  weightLb: number,
  options: { commit?: boolean } = {},
): Promise<SetShippingPolicyResult> => {
  const normalizedSku = sku.trim()

  if (!normalizedSku) {
    return { ok: false, sku, error: "SKU is required" }
  }

  const policyName = shippingPolicyForWeightLb(weightLb)
  if (!policyName) {
    return { ok: false, sku: normalizedSku, error: `No shipping policy tier for weight ${weightLb} lb` }
  }

  try {
    const frame = await getListingsFrame(page)
    const policyId = await resolveShippingPolicyId(frame, policyName)
    if (!policyId) {
      return { ok: false, sku: normalizedSku, error: `Policy "${policyName}" not found in the grid's shipping policy list` }
    }

    const saved = await saveRowValue(page, normalizedSku, "shippingpolicyid", policyId, options)
    return saved.ok
      ? { ok: true, sku: normalizedSku, weightLb, policyName, policyId }
      : { ok: false, sku: normalizedSku, error: saved.error }
  } catch (error) {
    return { ok: false, sku: normalizedSku, error: error instanceof Error ? error.message : String(error) }
  }
}
