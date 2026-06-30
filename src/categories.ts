import type { Frame, Locator, Page } from "playwright"

export type SetEbayCategoryResult =
  | {
      ok: true
      sku: string
      categoryPath: string
    }
  | {
      ok: false
      sku: string
      categoryPath: string
      error: string
    }

export const setEbayCategory = async (
  page: Page,
  sku: string,
  categoryPath: string,
): Promise<SetEbayCategoryResult> => {
  const normalizedSku = normalizeText(sku)
  const normalizedCategoryPath = normalizeText(categoryPath)

  if (!normalizedSku) {
    return { ok: false, sku, categoryPath: normalizedCategoryPath, error: "SKU is required" }
  }

  if (!normalizedCategoryPath) {
    return { ok: false, sku: normalizedSku, categoryPath, error: "Category path is required" }
  }

  try {
    const frame = await getListingsFrame(page)
    const rows = await findListingRows(frame, normalizedSku)

    if (rows.length === 0) {
      return { ok: false, sku: normalizedSku, categoryPath: normalizedCategoryPath, error: `No listing found for SKU '${normalizedSku}'` }
    }

    if (rows.length > 1) {
      return { ok: false, sku: normalizedSku, categoryPath: normalizedCategoryPath, error: `Found ${rows.length} listings for SKU '${normalizedSku}'` }
    }

    await openCategoryChooser(rows[0])
    await chooseCategory(frame, normalizedCategoryPath)
    await clickUpdate(frame)

    return { ok: true, sku: normalizedSku, categoryPath: normalizedCategoryPath }
  } catch (error) {
    return {
      ok: false,
      sku: normalizedSku,
      categoryPath: normalizedCategoryPath,
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

const findListingRows = async (frame: Frame, sku: string) => {
  const search = frame.getByPlaceholder("Search items", { exact: true })
  await search.waitFor({ state: "visible", timeout: 30000 })
  await search.fill(sku)
  await search.press("Enter")
  await waitForSearchToSettle(frame)

  const skuPattern = exactTextPattern(sku)
  const candidates = frame.locator("tr, [role='row']").filter({ hasText: skuPattern })
  const rows: Locator[] = []

  for (let index = 0, count = await candidates.count(); index < count; index += 1) {
    const row = candidates.nth(index)

    if (await row.isVisible().catch(() => false)) {
      rows.push(row)
    }
  }

  return rows
}

const openCategoryChooser = async (row: Locator) => {
  const categoryChooser = row.locator("a[href='ebaycategorychooser/primary'], a[href*='ebaycategorychooser/primary']").first()

  if (!(await categoryChooser.isVisible().catch(() => false))) {
    throw new Error("Primary eBay category chooser was not found")
  }

  await categoryChooser.click()
}

const chooseCategory = async (frame: Frame, categoryPath: string) => {
  const search = await findCategorySearch(frame)
  await search.fill(categoryPath)
  await search.press("Enter")
  await frame.page().waitForTimeout(750)

  const category = frame.getByText(exactTextPattern(categoryPath)).first()

  if (!(await category.isVisible().catch(() => false))) {
    throw new Error(`Category '${categoryPath}' was not found`)
  }

  await category.click()

  const select = frame.getByRole("button", { name: /select|done|apply|save/i }).first()

  if (await select.isVisible().catch(() => false)) {
    await select.click()
  }
}

const findCategorySearch = async (frame: Frame) => {
  const candidates = [
    frame.getByPlaceholder(/search/i).first(),
    frame.getByRole("searchbox").first(),
    frame.getByRole("textbox", { name: /search|category/i }).first(),
  ]

  for (const candidate of candidates) {
    if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
      return candidate
    }
  }

  throw new Error("Category search field was not found")
}

const clickUpdate = async (frame: Frame) => {
  const update = frame.getByRole("button", { name: "Update", exact: true }).first()

  if (!(await update.isVisible().catch(() => false))) {
    throw new Error("Update button was not found")
  }

  await update.click()
  await frame.page().waitForTimeout(750)
}

const waitForSearchToSettle = async (frame: Frame) => {
  await frame.page().waitForTimeout(750)
}

const normalizeText = (value: string) => value.trim().replace(/\s+/g, " ")

const exactTextPattern = (value: string) => new RegExp(`^${escapeRegex(normalizeText(value))}$`, "i")

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
