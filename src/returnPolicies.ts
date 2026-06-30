import type { Frame, Page } from "playwright"

const DEFAULT_POLICY_NAME = "free 30 days (252126089026)"

export type ApplyReturnPolicyResult =
  | {
      ok: true
      policyName: string
    }
  | {
      ok: false
      policyName: string
      error: string
    }

export const applyReturnPolicyToAllProducts = async (
  page: Page,
  policyName = DEFAULT_POLICY_NAME,
): Promise<ApplyReturnPolicyResult> => {
  const normalizedPolicyName = normalizePolicyName(policyName)

  if (!normalizedPolicyName) {
    return { ok: false, policyName, error: "Policy name is required" }
  }

  try {
    const frame = await getListingsFrame(page)
    await selectAllProducts(frame)
    await chooseBulkReturnPolicy(frame, normalizedPolicyName)
    return { ok: true, policyName: normalizedPolicyName }
  } catch (error) {
    return {
      ok: false,
      policyName: normalizedPolicyName,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

const getListingsFrame = async (page: Page) => {
  await page.locator("iframe").first().waitFor({ state: "attached", timeout: 30000 })

  const frame = page.frames().find((candidate) => candidate.url().includes("shopui.codisto.com"))

  if (!frame) {
    throw new Error("Marketplace Connect frame was not found")
  }

  return frame
}

const selectAllProducts = async (frame: Frame) => {
  await frame.getByPlaceholder("Search items", { exact: true }).waitFor({ state: "visible", timeout: 30000 })

  const bulkEdit = frame.getByRole("button", { name: "Bulk edit", exact: true }).first()

  if (await bulkEdit.isVisible().catch(() => false)) {
    await bulkEdit.click()
  }

  const selectAll = frame.locator("input[type='checkbox']").first()

  await selectAll.click()

  const selectEveryProduct = frame.getByText(/selected - edit this row to update selected products/i).first()

  if (!(await selectEveryProduct.isVisible().catch(() => false))) {
    throw new Error("All products were not selected")
  }
}

const chooseBulkReturnPolicy = async (frame: Frame, policyName: string) => {
  const returnPolicySelect = frame
    .locator("select")
    .filter({ has: frame.locator("option", { hasText: exactPolicyPattern(policyName) }) })
    .first()

  if (!(await returnPolicySelect.isVisible().catch(() => false))) {
    const availablePolicies = await getAvailableReturnPolicies(frame)
    throw new Error(`Return policy '${policyName}' was not found. Available return policies: ${availablePolicies.join(", ")}`)
  }

  await returnPolicySelect.selectOption({ label: policyName })

  const save = frame.getByRole("button", { name: /save|apply|update/i }).first()

  if (await save.isVisible().catch(() => false)) {
    await save.click()
  }
}

const getAvailableReturnPolicies = async (frame: Frame) => {
  const selectTexts = await frame.locator("select").allTextContents()
  const policyOptions = new Set<string>()

  for (const text of selectTexts) {
    if (!/return|buyer|money back|free 30 days|no return/i.test(text)) {
      continue
    }

    for (const policy of text.split(/\s{2,}|\n/).map(normalizePolicyName).filter(Boolean)) {
      policyOptions.add(policy)
    }
  }

  return [...policyOptions]
}

const normalizePolicyName = (name: string) => name.trim().replace(/\s+/g, " ")

const exactPolicyPattern = (policyName: string) => new RegExp(`^${escapeRegex(normalizePolicyName(policyName))}$`, "i")

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
