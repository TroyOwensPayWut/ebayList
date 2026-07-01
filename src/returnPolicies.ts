import type { Frame, Page } from "playwright"

import { waitForFrameLoaders } from "./pageLoad.js"

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
  const normalizedPolicyName = policyName.trim().replace(/\s+/g, " ")

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

  const frame = page.frames().find((candidate) => candidate.url().includes("codisto"))

  if (!frame) {
    throw new Error("Marketplace Connect frame was not found")
  }

  return frame
}

// The header select-all checkbox has a styled <span class="checkbox-backdrop"> overlaying
// the real <input>, so a Playwright click is intercepted ("checkbox-backdrop intercepts
// pointer events"). Toggle it natively in-page instead — the same trick filters.ts uses.
const selectAllProducts = async (frame: Frame) => {
  await frame.locator("input[type='checkbox'].select-all").first().waitFor({ state: "attached", timeout: 30000 })

  const checked = await frame.evaluate(() => {
    const cb =
      document.querySelector<HTMLInputElement>("input[type='checkbox'].select-all") ??
      document.querySelector<HTMLInputElement>("input[type='checkbox']")
    if (!cb) return false
    if (!cb.checked) cb.click()
    return cb.checked
  })

  if (!checked) {
    throw new Error("Could not select all products (select-all checkbox not found or stayed unchecked)")
  }

  // The grid confirms selection with an "N selected - edit this row..." bulk-pane banner.
  const banner = frame.getByText(/\bselected\s*-\s*edit this row to update selected products/i).first()
  if (!(await banner.isVisible().catch(() => false))) {
    throw new Error("All products were not selected (bulk-edit banner did not appear)")
  }
}

// The bulk-edit row's return-policy <select id="returnpolicyid"> is React-controlled, so a
// raw dispatchEvent won't register — Playwright's selectOption fires the real events. Once a
// value is chosen, a primary "Update" button appears; clicking it applies the policy to every
// selected product.
const chooseBulkReturnPolicy = async (frame: Frame, policyName: string) => {
  const select = frame.locator("select#returnpolicyid").first()

  if ((await select.count()) === 0) {
    throw new Error("Return policy selector was not found on the bulk-edit row")
  }

  try {
    await select.selectOption({ label: policyName })
  } catch {
    const available = (await select.locator("option").allTextContents()).map((text) => text.trim()).filter(Boolean)
    throw new Error(`Return policy '${policyName}' was not found. Available return policies: ${available.join(", ")}`)
  }

  // The "Update" button (button.update-bulk-edit) is likewise overlaid by a
  // <span class="bulk-active-text"> that intercepts Playwright clicks — click it natively.
  await frame.locator("button.update-bulk-edit").first().waitFor({ state: "attached", timeout: 15000 })

  const clicked = await frame.evaluate(() => {
    const btn = [...document.querySelectorAll<HTMLButtonElement>("button.update-bulk-edit")].find(
      (b) => (b as HTMLElement).offsetParent !== null,
    )
    if (!btn) return false
    btn.click()
    return true
  })

  if (!clicked) {
    throw new Error("Bulk-edit Update button was not found after choosing the return policy")
  }

  await waitForFrameLoaders(frame)
}
