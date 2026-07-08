import type { Frame, Page } from "playwright"

import { findCodistoFrame, waitForFrameLoaders } from "./pageLoad.js"
import { TIMEOUT_MS } from "./timeout.js"

// Shared plumbing for the Codisto bulk grid (id="ebaytable") — a virtualized
// datagrid inside the shopui.codisto.com iframe. Saving works like the app's own
// SaveGridForm: stage values on the grid's dataSet, then commit(), which POSTs
// {cmd:"savedata", ..., changes:[{key, data:{...}}]}. UI clicks only STAGE changes
// (they ride along with the next commit), so writers here go straight to the data
// layer instead.

export const getListingsFrame = (page: Page): Promise<Frame> => findCodistoFrame(page)

// Filter the grid down to the SKU so its row is loaded into the (virtualized) dataSet.
export const searchForSku = async (frame: Frame, sku: string) => {
  const search = frame.getByPlaceholder("Search items", { exact: true })
  await search.waitFor({ state: "visible" })
  await search.fill(sku)
  await search.press("Enter")
  await waitForFrameLoaders(frame)
}

export type LocateResult =
  | { status: "ok"; index: number; key: number }
  | { status: "notfound" }
  | { status: "multiple"; count: number }
  | { status: "nogrid" }

// Poll the grid's dataSet until the SKU's row is loaded (search results stream in).
export const findRowIndex = async (frame: Frame, sku: string): Promise<LocateResult> => {
  const deadline = Date.now() + TIMEOUT_MS
  let last: LocateResult = { status: "notfound" }

  while (Date.now() < deadline) {
    last = (await frame.evaluate((wantedSku) => {
      const w = window as unknown as { $?: (s: unknown) => { data: (k: string) => unknown } }
      const $ = w.$
      const gridEl = document.getElementById("ebaytable")
      if (!$ || !gridEl) {
        return { status: "nogrid" }
      }
      const inst = $(gridEl).data("codisto.grid") as { dataSet?: { data: Array<{ key: number; currentData?: Record<string, unknown>; baseData?: Record<string, unknown> }> } } | undefined
      const ds = inst?.dataSet
      if (!ds || !Array.isArray(ds.data)) {
        return { status: "nogrid" }
      }

      const want = wantedSku.trim().toLowerCase()
      const matches: Array<{ index: number; key: number }> = []
      for (let i = 0; i < ds.data.length; i += 1) {
        const rec = ds.data[i]
        if (!rec) continue
        // A row without its key is still streaming in — commit() POSTs changes as
        // {key, data}, so an undefined key makes the server silently DROP the change
        // while the grid still reports "saved". Keep polling until the key exists.
        if (typeof rec.key !== "number") continue
        const row = rec.currentData || rec.baseData || {}
        const code = typeof row.code === "string" ? row.code.trim().toLowerCase() : ""
        if (code && code === want) {
          matches.push({ index: i, key: rec.key })
        }
      }

      if (matches.length === 0) return { status: "notfound" }
      if (matches.length > 1) return { status: "multiple", count: matches.length }
      return { status: "ok", index: matches[0].index, key: matches[0].key }
    }, sku)) as LocateResult

    if (last.status === "ok" || last.status === "multiple") {
      return last
    }

    await frame.waitForTimeout(500)
  }

  return last
}

// Stage a column value on the row and commit (POSTs savedata to Codisto).
// commit:false only stages — nothing is saved until the grid's next commit,
// and a page reload discards it (used by dry-run probes).
export const setAndCommit = async (frame: Frame, index: number, column: string, value: unknown, commit = true) => {
  await frame.evaluate(
    ({ index, column, value, commit }) => {
      const w = window as unknown as { $?: (s: unknown) => { data: (k: string) => unknown } }
      const $ = w.$
      const gridEl = document.getElementById("ebaytable")
      if (!$ || !gridEl) throw new Error("Codisto grid disappeared before commit")
      const inst = $(gridEl).data("codisto.grid") as {
        dataSet?: { set: (rowIndex: number, col: string, val: unknown) => void; commit: () => void }
      }
      const ds = inst?.dataSet
      if (!ds) throw new Error("Codisto grid dataSet disappeared before commit")
      ds.set(index, column, value)
      if (commit) ds.commit()
    },
    { index, column, value, commit },
  )
}

/** Resolve a grid dropdown option's value by its visible label (e.g. select#shippingpolicyid). */
export const resolveSelectValueByLabel = async (frame: Frame, selectId: string, label: string): Promise<string | null> =>
  frame.evaluate(
    ({ selectId, label }) => {
      const select = document.querySelector<HTMLSelectElement>(`select#${selectId}`)
      if (!select) return null
      for (const option of Array.from(select.options)) {
        if (option.label.trim() === label) return option.value
      }
      return null
    },
    { selectId, label },
  )

/** Commits ALL staged changes in one savedata POST and waits for the server to accept. */
export const commitGrid = async (frame: Frame): Promise<{ ok: true } | { ok: false; error: string }> => {
  await frame.evaluate(() => {
    const w = window as unknown as { $?: (s: unknown) => { data: (k: string) => unknown } }
    const $ = w.$
    const gridEl = document.getElementById("ebaytable")
    if (!$ || !gridEl) throw new Error("Codisto grid disappeared before commit")
    const inst = $(gridEl).data("codisto.grid") as { dataSet?: { commit: () => void } }
    if (!inst?.dataSet) throw new Error("Codisto grid dataSet disappeared before commit")
    inst.dataSet.commit()
  })
  return waitForCommit(frame)
}

// commit() clears dataSet dirty on server "ok"/"warning"; a rejected change leaves it dirty.
export const waitForCommit = async (frame: Frame): Promise<{ ok: true } | { ok: false; error: string }> => {
  const deadline = Date.now() + TIMEOUT_MS

  while (Date.now() < deadline) {
    const dirty = await frame.evaluate(() => {
      const w = window as unknown as { $?: (s: unknown) => { data: (k: string) => unknown } }
      const $ = w.$
      const gridEl = document.getElementById("ebaytable")
      if (!$ || !gridEl) return null
      const inst = $(gridEl).data("codisto.grid") as { dataSet?: { dirty: () => boolean } } | undefined
      return inst?.dataSet ? inst.dataSet.dirty() : null
    })

    if (dirty === false) {
      return { ok: true }
    }

    await frame.waitForTimeout(500)
  }

  return { ok: false, error: "Change was not saved (grid stayed dirty — Codisto may have rejected it)" }
}

/** Search → locate → set → commit → confirm saved, in one call. */
export const saveRowValue = async (
  page: Page,
  sku: string,
  column: string,
  value: unknown,
  options: { commit?: boolean } = {},
): Promise<{ ok: true; index: number } | { ok: false; error: string }> => {
  const commit = options.commit ?? true
  const frame = await getListingsFrame(page)
  await searchForSku(frame, sku)

  const located = await findRowIndex(frame, sku)
  if (located.status === "nogrid") {
    return { ok: false, error: "Codisto grid was not found on the page" }
  }
  if (located.status === "notfound") {
    return { ok: false, error: `No listing found for SKU '${sku}'` }
  }
  if (located.status === "multiple") {
    return { ok: false, error: `Found ${located.count} listings for SKU '${sku}'` }
  }

  await setAndCommit(frame, located.index, column, value, commit)

  if (!commit) {
    return { ok: true, index: located.index } // staged only; caller verifies/discards
  }

  const settled = await waitForCommit(frame)
  return settled.ok ? { ok: true, index: located.index } : settled
}
