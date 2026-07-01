import type { Frame, Locator, Page } from "playwright"

import { waitForFrameLoaders } from "./pageLoad.js"

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

// The Codisto grid is a flat set of `.cell[data-row][data-column-class]` divs (no
// tr/[role=row]). The `status` column is a segmented Enabled/Disabled Polaris button
// pair; the `.Polaris-Button--pressed` one is the current state. Enabling = clicking
// the "Enabled" button and waiting for it to become pressed.
export const enableEbayProduct = async (page: Page, sku: string): Promise<EnableEbayProductResult> => {
  const normalizedSku = sku.trim()

  if (!normalizedSku) {
    return { ok: false, sku, error: "SKU is required" }
  }

  try {
    const frame = await getListingsFrame(page)

    const search = frame.getByPlaceholder("Search items", { exact: true })
    await search.waitFor({ state: "visible", timeout: 30000 })
    await search.fill(normalizedSku)
    await search.press("Enter")
    await waitForFrameLoaders(frame)

    const located = await waitForRow(frame, normalizedSku)

    if (located.count === 0) {
      return { ok: false, sku: normalizedSku, error: `No listing found for SKU '${normalizedSku}'` }
    }

    if (located.count > 1) {
      return { ok: false, sku: normalizedSku, error: `Found ${located.count} listings for SKU '${normalizedSku}'` }
    }

    const statusCell = frame.locator(`.cell[data-row='${located.rowIndex}'][data-column-class='status']`)
    const enabledButton = statusCell.getByRole("button", { name: "Enabled", exact: true })

    if ((await enabledButton.count()) === 0) {
      return { ok: false, sku: normalizedSku, error: `Enabled button was not found for SKU '${normalizedSku}'` }
    }

    if (await isPressed(enabledButton)) {
      return { ok: true, sku: normalizedSku }
    }

    await enabledButton.click()

    // The toggle only STAGES the change — Shopify shows a contextual Save/Discard
    // bar on the host page (outside the iframe). Without clicking Save, a reload
    // reverts the listing to Disabled.
    await saveViaHostBar(page)
    await waitForFrameLoaders(frame)

    const enabled = await waitUntilPressed(enabledButton)
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

// The grid re-renders asynchronously after a search, so poll until the searched SKU
// shows up in the `code` column (or the timeout elapses with whatever is there).
const waitForRow = async (frame: Frame, sku: string) => {
  const deadline = Date.now() + 15000
  let located = await locateRow(frame, sku)

  while (located.count === 0 && Date.now() < deadline) {
    await frame.page().waitForTimeout(500)
    located = await locateRow(frame, sku)
  }

  return located
}

const locateRow = async (frame: Frame, sku: string) => {
  return frame.evaluate((targetSku) => {
    const matches = Array.from(document.querySelectorAll<HTMLElement>(".cell[data-column-class='code'][data-row]")).filter(
      (cell) => (cell.textContent ?? "").trim().toLowerCase() === targetSku.toLowerCase(),
    )

    return { count: matches.length, rowIndex: matches[0]?.getAttribute("data-row") ?? "" }
  }, sku)
}

const saveViaHostBar = async (page: Page) => {
  const save = page.getByRole("button", { name: "Save", exact: true }).first()

  await save.waitFor({ state: "visible", timeout: 10000 })
  await save.click()
  await save.waitFor({ state: "hidden", timeout: 30000 })
}

const isPressed = async (button: Locator) => {
  const className = await button.getAttribute("class")
  return (className ?? "").includes("Polaris-Button--pressed")
}

const waitUntilPressed = async (button: Locator) => {
  const deadline = Date.now() + 15000

  while (Date.now() < deadline) {
    if (await isPressed(button)) {
      return true
    }

    await button.page().waitForTimeout(500)
  }

  return false
}
