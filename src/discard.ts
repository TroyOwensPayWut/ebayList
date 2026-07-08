import type { Frame, Page } from "playwright"

import { findCodistoFrame } from "./pageLoad.js"
import { TIMEOUT_MS } from "./timeout.js"

// Discards ALL staged (uncommitted) Codisto grid changes by clicking the
// "Discard" button in Shopify's contextual save bar (top-level page, next to
// Save) instead of reloading the page. Resolves once the grid's dataSet
// reports clean; ok:false if the button never appeared or the grid stayed dirty.
export const discardGrid = async (page: Page): Promise<{ ok: true } | { ok: false; error: string }> => {
  const frame = await findCodistoFrame(page)

  const dirty = await isDirty(frame)
  if (dirty === false) return { ok: true } // nothing staged
  if (dirty === null) return { ok: false, error: "Codisto grid was not found on the page" }

  // Class names in the save bar are hash-suffixed — match by visible text.
  const discardButton = page.getByRole("button", { name: "Discard", exact: true }).first()
  try {
    await discardButton.waitFor({ state: "visible" })
  } catch {
    return { ok: false, error: "Discard button not found while grid was dirty" }
  }
  await discardButton.click()

  // Shopify sometimes confirms with a "Discard all unsaved changes?" dialog.
  const confirmButton = page.getByRole("button", { name: /discard changes/i }).first()

  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    if ((await isDirty(frame)) === false) return { ok: true }
    if (await confirmButton.isVisible().catch(() => false)) {
      await confirmButton.click().catch(() => undefined)
    }
    await page.waitForTimeout(250)
  }

  return { ok: false, error: "Grid stayed dirty after clicking Discard" }
}

const isDirty = (frame: Frame): Promise<boolean | null> =>
  frame.evaluate(() => {
    const w = window as unknown as { $?: (s: unknown) => { data: (k: string) => unknown } }
    const gridEl = document.getElementById("ebaytable")
    if (!w.$ || !gridEl) return null
    const inst = w.$(gridEl).data("codisto.grid") as { dataSet?: { dirty: () => boolean } } | undefined
    return inst?.dataSet ? inst.dataSet.dirty() : null
  })
