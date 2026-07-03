import type { Frame, Page } from "playwright"

import { applyBulkPolicyToAllProducts, type ApplyBulkPolicyResult } from "./bulkPolicy.js"
import { resolveSelectValueByLabel } from "./grid.js"

const DEFAULT_POLICY_NAME = "Returns Accepted,Buyer,30 Days,Money Back,Int"
// Fallback for when the dropdown can't be read — verified via src/tryReturnPolicy.ts
// (same value on both the eBay and eBay Motors grids).
const DEFAULT_POLICY_ID = "197165153026"

/** Resolves the default return policy id from the grid dropdown, falling back to the last known id. */
export const resolveReturnPolicyId = async (frame: Frame): Promise<string> =>
  (await resolveSelectValueByLabel(frame, "returnpolicyid", DEFAULT_POLICY_NAME)) ?? DEFAULT_POLICY_ID

export type ApplyReturnPolicyResult = ApplyBulkPolicyResult

export const applyReturnPolicyToAllProducts = (
  page: Page,
  policyName = DEFAULT_POLICY_NAME,
): Promise<ApplyReturnPolicyResult> =>
  applyBulkPolicyToAllProducts(page, { selectId: "returnpolicyid", policyName })
