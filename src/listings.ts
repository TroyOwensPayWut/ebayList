import type { Frame, Locator, Page } from "playwright"

export type EnableEbayProductResult =
  | {
      ok: true
      sku: string
    }
  | {
      ok: false
      sku: string
      error: string
    }

export const enableEbayProduct = async (page: Page, sku: string): Promise<EnableEbayProductResult> => {
  const normalizedSku = normalizeSku(sku)

  if (!normalizedSku) {
    return { ok: false, sku, error: "SKU is required" }
  }

  try {
    const frame = await getListingsFrame(page)
    const rows = await findListingRows(frame, normalizedSku)

    if (rows.length === 0) {
      return { ok: false, sku: normalizedSku, error: `No listing found for SKU '${normalizedSku}'` }
    }

    if (rows.length > 1) {
      return { ok: false, sku: normalizedSku, error: `Found ${rows.length} listings for SKU '${normalizedSku}'` }
    }

    const row = rows[0]

    if (await isEnabled(row)) {
      return { ok: true, sku: normalizedSku }
    }

    const toggle = await getEnableToggle(row)

    if (!toggle) {
      return { ok: false, sku: normalizedSku, error: `Enable toggle was not found for SKU '${normalizedSku}'` }
    }

    await toggle.click()

    const enabled = await waitUntilEnabled(row)
    return enabled
      ? { ok: true, sku: normalizedSku }
      : { ok: false, sku: normalizedSku, error: `Listing did not become enabled for SKU '${normalizedSku}'` }
  } catch (error) {
    return { ok: false, sku: normalizedSku, error: error instanceof Error ? error.message : String(error) }
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

const isEnabled = async (row: Locator) => {
  const enabledLabel = row.getByText(/enabled|listed|active/i).first()

  if (await enabledLabel.isVisible().catch(() => false)) {
    return true
  }

  const checkedToggle = row.locator("input[type='checkbox']:checked, [role='switch'][aria-checked='true']").first()
  return checkedToggle.isVisible().catch(() => false)
}

const getEnableToggle = async (row: Locator) => {
  const candidates = [
    row.getByRole("switch").first(),
    row.getByRole("checkbox").first(),
    row.getByRole("button", { name: /enable|list|publish/i }).first(),
    row.locator("input[type='checkbox']").first(),
  ]

  for (const candidate of candidates) {
    if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
      return candidate
    }
  }

  return null
}

const waitUntilEnabled = async (row: Locator) => {
  const startedAt = Date.now()

  while (Date.now() - startedAt < 10000) {
    if (await isEnabled(row)) {
      return true
    }

    await row.page().waitForTimeout(500)
  }

  return false
}

const waitForSearchToSettle = async (frame: Frame) => {
  await frame.page().waitForTimeout(750)
}

const normalizeSku = (sku: string) => sku.trim()

const exactTextPattern = (value: string) => new RegExp(`(^|\\s)${escapeRegex(value)}(\\s|$)`, "i")

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
