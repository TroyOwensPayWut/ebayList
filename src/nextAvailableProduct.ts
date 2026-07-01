import type { Frame, Page } from "playwright"

type ExtractedRow = {
  sku: string
  enabled: boolean | null
  hasError: boolean
  text: string
}

export type FindNextAvailableEbaySkuResult =
  | {
      ok: true
      sku: string
    }
  | {
      ok: false
      error: string
    }

// Pure gating logic over the ordered list of rows seen so far. When startSku is
// given, only rows *after* the matching row are eligible (the start row itself is
// skipped). Exported for the self-check in nextAvailableProduct.test.ts.
export const pickNextAvailableSku = (
  rows: Pick<ExtractedRow, "sku" | "enabled" | "hasError">[],
  startSku?: string,
): FindNextAvailableEbaySkuResult => {
  const target = startSku?.trim()
  const targetLower = target?.toLowerCase()
  let startFound = !target

  for (const row of rows) {
    if (!startFound) {
      if (row.sku.toLowerCase() === targetLower) {
        startFound = true
      }
      continue
    }

    if (row.enabled === false && !row.hasError) {
      return { ok: true, sku: row.sku }
    }
  }

  if (rows.length === 0) {
    return { ok: false, error: "No product rows were found" }
  }

  if (target && !startFound) {
    return { ok: false, error: `Start SKU ${target} was not found` }
  }

  return { ok: false, error: "No disabled product without errors was found" }
}

export const findNextAvailableEbaySku = async (page: Page, startSku?: string): Promise<FindNextAvailableEbaySkuResult> => {
  try {
    const frame = await getListingsFrame(page)
    await frame.getByPlaceholder("Search items", { exact: true }).waitFor({ state: "visible", timeout: 30000 })

    const seenSkus = new Set<string>()
    const allRows: ExtractedRow[] = []
    let previousLastSku = ""

    for (let pass = 0; pass < 500; pass += 1) {
      const rows = await extractVisibleRows(frame)

      for (const row of rows) {
        if (!seenSkus.has(row.sku)) {
          seenSkus.add(row.sku)
          allRows.push(row)
        }
      }

      const result = pickNextAvailableSku(allRows, startSku)

      if (result.ok) {
        return result
      }

      const lastSku = rows.at(-1)?.sku ?? ""

      // Grid can no longer scroll — the accumulated result (error) is final.
      if (!lastSku || lastSku === previousLastSku) {
        return result
      }

      previousLastSku = lastSku
      await scrollProductGrid(frame)
    }

    return { ok: false, error: "Stopped scanning after 500 product grid scrolls" }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
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

const extractVisibleRows = async (frame: Frame) => {
  return frame.evaluate(() => {
    type VisibleElement = {
      top: number
      left: number
      bottom: number
      text: string
      tag: string
      type: string
      checked: boolean
      ariaChecked: string | null
      title: string
      label: string
      className: string
    }

    const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ")
    const isVisible = (element: Element) => {
      const style = window.getComputedStyle(element)

      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) {
        return false
      }

      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight
    }

    const visibleElements: VisibleElement[] = Array.from(document.querySelectorAll("button,input,[role='button'],[role='switch'],[role='checkbox'],a,div,span,td"))
      .filter(isVisible)
      .map((element) => {
        const rect = element.getBoundingClientRect()
        const input = element instanceof HTMLInputElement ? element : null
        const ownText = normalize(element.childElementCount === 0 ? element.textContent : element.textContent)
        const label = normalize(element.getAttribute("aria-label"))
        return {
          top: rect.top,
          left: rect.left,
          bottom: rect.bottom,
          text: ownText || label || normalize(input?.value),
          tag: element.tagName.toLowerCase(),
          type: normalize(input?.type),
          checked: Boolean(input?.checked),
          ariaChecked: element.getAttribute("aria-checked"),
          title: normalize(element.getAttribute("title")),
          label,
          className: normalize(element.getAttribute("class")),
        }
      })
      .filter((element) => element.text || element.type === "checkbox" || element.ariaChecked !== null)

    const header = visibleElements.find((element) => /^Code$/i.test(element.text))
    const minTop = header ? header.bottom : 0
    const skuElements = visibleElements
      .filter((element) => element.top > minTop && /^[A-Z]{2,}\d+[A-Z0-9-]*$/i.test(element.text))
      .sort((left, right) => left.top - right.top || left.left - right.left)

    const rows: ExtractedRow[] = []

    for (const skuElement of skuElements) {
      const rowElements = visibleElements.filter((element) => Math.abs(element.top - skuElement.top) < 12 || Math.abs(element.bottom - skuElement.bottom) < 12)
      const rowText = rowElements
        .sort((left, right) => left.left - right.left)
        .map((element) => [element.text, element.label, element.title, element.className].filter(Boolean).join(" "))
        .join(" ")

      const enabled = getEnabledState(rowElements)
      rows.push({
        sku: skuElement.text,
        enabled,
        hasError: hasListingError(rowText),
        text: rowText,
      })
    }

    return dedupeRows(rows)

    function getEnabledState(rowElements: VisibleElement[]) {
      if (rowElements.some((element) => element.ariaChecked === "true" || (element.type === "checkbox" && element.checked && /enable|enabled/i.test(element.label + element.title)))) {
        return true
      }

      const statusButtons = rowElements.filter((element) => /^(Yes|No)$/i.test(element.text))

      if (statusButtons.some((element) => /^No$/i.test(element.text))) {
        return false
      }

      if (statusButtons.some((element) => /^Yes$/i.test(element.text))) {
        return true
      }

      return null
    }

    function hasListingError(text: string) {
      return /\b(error|failed|invalid|missing|required|problem|warning|attention|fix|rejected)\b/i.test(text)
    }

    function dedupeRows(rows: ExtractedRow[]) {
      const seen = new Set<string>()
      return rows.filter((row) => {
        if (seen.has(row.sku)) {
          return false
        }

        seen.add(row.sku)
        return true
      })
    }
  })
}

const scrollProductGrid = async (frame: Frame) => {
  await frame.evaluate(() => {
    const skuPattern = /\b[A-Z]{2,}\d+[A-Z0-9-]*\b/i
    const scrollable = Array.from(document.querySelectorAll<HTMLElement>("*"))
      .filter((element) => element.scrollHeight > element.clientHeight + 50)
      .sort((left, right) => {
        const rightHasProducts = skuPattern.test(right.textContent ?? "") ? 1 : 0
        const leftHasProducts = skuPattern.test(left.textContent ?? "") ? 1 : 0
        return rightHasProducts - leftHasProducts || right.clientHeight - left.clientHeight
      })[0]

    if (scrollable) {
      scrollable.scrollTop += Math.max(300, Math.floor(scrollable.clientHeight * 0.8))
      return
    }

    window.scrollBy(0, Math.max(300, Math.floor(window.innerHeight * 0.8)))
  })
  await frame.page().waitForTimeout(250)
}
