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
