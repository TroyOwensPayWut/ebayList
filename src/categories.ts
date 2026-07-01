import type { Frame, Page } from "playwright"

import { waitForFrameLoaders } from "./pageLoad.js"

export type SetEbayCategoryResult =
  | {
      ok: true
      sku: string
      categoryId: string
    }
  | {
      ok: false
      sku: string
      categoryId: string
      error: string
    }

// Sets the eBay primary category for a single product by CATEGORY NUMBER.
//
// The bulk grid is Codisto's own virtualized datagrid (id="ebaytable"), not a
// table — its category chooser is a lazy, search-less tree with no way to jump to
// a leaf by number, which is why the old DOM/tree approach failed. Instead we write
// straight to the grid's data layer, exactly like the app's own SaveGridForm does:
//   dataSet.set(rowIndex, "primarycategoryid", <number>) ; dataSet.commit()
// commit() POSTs {cmd:"savedata", ..., changes:[{key, data:{primarycategoryid}}]}.
// ponytail: bypasses the UI entirely — no modal, no tree, no hover-hidden anchors.
export const setEbayCategory = async (
  page: Page,
  sku: string,
  categoryId: string,
): Promise<SetEbayCategoryResult> => {
  const normalizedSku = normalizeText(sku)
  const normalizedCategoryId = normalizeText(categoryId)

  if (!normalizedSku) {
    return { ok: false, sku, categoryId: normalizedCategoryId, error: "SKU is required" }
  }

  if (!isValidCategoryId(normalizedCategoryId)) {
    return {
      ok: false,
      sku: normalizedSku,
      categoryId: normalizedCategoryId,
      error: `Category must be a positive eBay category number, got '${normalizedCategoryId}'`,
    }
  }

  try {
    const frame = await getListingsFrame(page)
    await searchForSku(frame, normalizedSku)

    const located = await findRowIndex(frame, normalizedSku)
    if (located.status === "nogrid") {
      return fail(normalizedSku, normalizedCategoryId, "Codisto grid was not found on the page")
    }
    if (located.status === "notfound") {
      return fail(normalizedSku, normalizedCategoryId, `No listing found for SKU '${normalizedSku}'`)
    }
    if (located.status === "multiple") {
      return fail(normalizedSku, normalizedCategoryId, `Found ${located.count} listings for SKU '${normalizedSku}'`)
    }

    await setAndCommit(frame, located.index, Number(normalizedCategoryId))

    const settled = await waitForCommit(frame)
    if (!settled.ok) {
      return fail(normalizedSku, normalizedCategoryId, settled.error)
    }

    return { ok: true, sku: normalizedSku, categoryId: normalizedCategoryId }
  } catch (error) {
    return fail(normalizedSku, normalizedCategoryId, error instanceof Error ? error.message : String(error))
  }
}

const getListingsFrame = async (page: Page): Promise<Frame> => {
  await page.locator("iframe").first().waitFor({ state: "attached", timeout: 30000 })

  // The iframe can attach before its URL resolves to the Codisto app — poll for it.
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const frame = page.frames().find((candidate) => candidate.url().includes("shopui.codisto.com"))
    if (frame) {
      return frame
    }
    await page.waitForTimeout(500)
  }

  throw new Error("Marketplace Connect frame was not found")
}

// Filter the grid down to the SKU so its row is loaded into the (virtualized) dataSet.
const searchForSku = async (frame: Frame, sku: string) => {
  const search = frame.getByPlaceholder("Search items", { exact: true })
  await search.waitFor({ state: "visible", timeout: 30000 })
  await search.fill(sku)
  await search.press("Enter")
  await waitForFrameLoaders(frame)
}

type LocateResult =
  | { status: "ok"; index: number; key: number }
  | { status: "notfound" }
  | { status: "multiple"; count: number }
  | { status: "nogrid" }

// Poll the grid's dataSet until the SKU's row is loaded (search results stream in).
const findRowIndex = async (frame: Frame, sku: string): Promise<LocateResult> => {
  const deadline = Date.now() + 15000
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

// Stage the category id on the row and commit (POSTs savedata to Codisto).
const setAndCommit = async (frame: Frame, index: number, categoryId: number) => {
  await frame.evaluate(
    ({ index, categoryId }) => {
      const w = window as unknown as { $?: (s: unknown) => { data: (k: string) => unknown } }
      const $ = w.$
      const gridEl = document.getElementById("ebaytable")
      if (!$ || !gridEl) throw new Error("Codisto grid disappeared before commit")
      const inst = $(gridEl).data("codisto.grid") as {
        dataSet?: { set: (rowIndex: number, col: string, val: unknown) => void; commit: () => void }
      }
      const ds = inst?.dataSet
      if (!ds) throw new Error("Codisto grid dataSet disappeared before commit")
      ds.set(index, "primarycategoryid", categoryId)
      ds.commit()
    },
    { index, categoryId },
  )
}

// commit() clears dataSet dirty on server "ok"/"warning"; a rejected category leaves it dirty.
const waitForCommit = async (frame: Frame): Promise<{ ok: true } | { ok: false; error: string }> => {
  const deadline = Date.now() + 30000

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

  return { ok: false, error: "Category change was not saved (grid stayed dirty — eBay may have rejected the category id)" }
}

/** eBay category ids are positive integers (no leading zero, no path text). */
export const isValidCategoryId = (value: string) => /^[1-9]\d*$/.test(value.trim())

const fail = (sku: string, categoryId: string, error: string): SetEbayCategoryResult => ({
  ok: false,
  sku,
  categoryId,
  error,
})

const normalizeText = (value: string) => value.trim().replace(/\s+/g, " ")
