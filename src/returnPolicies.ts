import type { Page } from "playwright"

import { applyBulkPolicyToAllProducts, type ApplyBulkPolicyResult } from "./bulkPolicy.js"

const DEFAULT_POLICY_NAME = "free 30 days (252126089026)"

export type ApplyReturnPolicyResult = ApplyBulkPolicyResult

export const applyReturnPolicyToAllProducts = (
  page: Page,
  policyName = DEFAULT_POLICY_NAME,
): Promise<ApplyReturnPolicyResult> =>
  applyBulkPolicyToAllProducts(page, { selectId: "returnpolicyid", policyName })
