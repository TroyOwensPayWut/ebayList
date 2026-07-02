import type { Frame, Page } from "playwright"

import { waitForFrameLoaders } from "./pageLoad.js"

// Shared bulk-edit-row policy applier for the Codisto grid: select all products,
// pick a policy in the bulk-edit <select>, click Update.

export type ApplyBulkPolicyResult =
  | {
      ok: true
      policyName: string
    }
  | {
      ok: false
      policyName: string
      error: string
    }

type BulkPolicyOptions = {
  /** id of the bulk-edit row <select>, e.g. "returnpolicyid" / "paymentpolicyid". */
  selectId: string
  policyName: string
  /** false = stage the selection but never click Update, so NOTHING is saved. */
  commit?: boolean
}

export const applyBulkPolicyToAllProducts = async (
  page: Page,
  { selectId, policyName, commit = true }: BulkPolicyOptions,
): Promise<ApplyBulkPolicyResult> => {
  const normalizedPolicyName = policyName.trim().replace(/\s+/g, " ")

  if (!normalizedPolicyName) {
    return { ok: false, policyName, error: "Policy name is required" }
  }

  try {
    const frame = await getListingsFrame(page)
    await selectAllProducts(frame)
    await chooseBulkPolicy(frame, selectId, normalizedPolicyName, commit)
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

// The header select-all <input> is disabled until a row is selected, so DOM clicks are a
// dead end. The grid instance ($(#ebaytable).data("codisto.grid")) exposes a real selection
// API — selectAll()/selectCount — so select through the data layer, like grid.ts does.
const selectAllProducts = async (frame: Frame) => {
  await frame.locator("#ebaytable").waitFor({ state: "attached", timeout: 30000 })

  const selected = await frame.evaluate(() => {
    const w = window as unknown as { $?: (s: unknown) => { data: (k: string) => unknown } }
    const gridEl = document.getElementById("ebaytable")
    if (!w.$ || !gridEl) return { ok: false as const, error: "Codisto grid was not found" }
    const inst = w.$(gridEl).data("codisto.grid") as
      | { selectAll?: () => void; selectCount?: number | (() => number) }
      | undefined
    if (!inst?.selectAll) return { ok: false as const, error: "Codisto grid selection API was not found" }
    inst.selectAll()
    const raw = inst.selectCount
    const count = typeof raw === "function" ? raw.call(inst) : typeof raw === "number" ? raw : -1
    return { ok: true as const, count }
  })

  if (!selected.ok) {
    throw new Error(selected.error)
  }
  if (selected.count === 0) {
    throw new Error("No products were selected (grid is empty?)")
  }

  // The grid flags an active bulk-edit selection on its root element.
  await frame.locator(".codisto-grid.multi-edit-active").first().waitFor({ state: "attached", timeout: 15000 })
}

// The bulk-edit row's policy <select> needs real events — Playwright's selectOption fires
// them. Once a value is chosen, a primary "Update" button appears; clicking it applies the
// policy to every selected product.
const chooseBulkPolicy = async (frame: Frame, selectId: string, policyName: string, commit: boolean) => {
  const select = frame.locator(`select#${selectId}`).first()

  if ((await select.count()) === 0) {
    throw new Error(`Policy selector 'select#${selectId}' was not found on the bulk-edit row`)
  }

  try {
    await select.selectOption({ label: policyName })
  } catch {
    const available = (await select.locator("option").allTextContents()).map((text) => text.trim()).filter(Boolean)
    throw new Error(`Policy '${policyName}' was not found in select#${selectId}. Available policies: ${available.join(", ")}`)
  }

  // The "Update" button (button.update-bulk-edit) is overlaid by a
  // <span class="bulk-active-text"> that intercepts Playwright clicks — click it natively.
  await frame.locator("button.update-bulk-edit").first().waitFor({ state: "attached", timeout: 15000 })

  if (!commit) {
    return // selection is only staged; caller discards it (e.g. by reloading)
  }

  const clicked = await frame.evaluate(() => {
    const btn = [...document.querySelectorAll<HTMLButtonElement>("button.update-bulk-edit")].find(
      (b) => (b as HTMLElement).offsetParent !== null,
    )
    if (!btn) return false
    btn.click()
    return true
  })

  if (!clicked) {
    throw new Error("Bulk-edit Update button was not found after choosing the policy")
  }

  await waitForFrameLoaders(frame)
}
