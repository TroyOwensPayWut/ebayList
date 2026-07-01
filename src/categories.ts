import type { Page } from "playwright"

import { saveRowValue } from "./grid.js"

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
// The grid's category chooser is a lazy, search-less tree with no way to jump to
// a leaf by number, which is why the old DOM/tree approach failed. Instead we write
// primarycategoryid straight through the grid's data layer (see grid.ts).
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
    const saved = await saveRowValue(page, normalizedSku, "primarycategoryid", Number(normalizedCategoryId))
    return saved.ok
      ? { ok: true, sku: normalizedSku, categoryId: normalizedCategoryId }
      : { ok: false, sku: normalizedSku, categoryId: normalizedCategoryId, error: saved.error }
  } catch (error) {
    return {
      ok: false,
      sku: normalizedSku,
      categoryId: normalizedCategoryId,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** eBay category ids are positive integers (no leading zero, no path text). */
export const isValidCategoryId = (value: string) => /^[1-9]\d*$/.test(value.trim())

const normalizeText = (value: string) => value.trim().replace(/\s+/g, " ")
