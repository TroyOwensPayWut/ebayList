import type { Frame, Page } from "playwright"

export type ActivateFiltersResult =
  | {
      ok: true
      activated: string[]
    }
  | {
      ok: false
      error: string
      availableFilters: string[]
      missingFilters: string[]
    }

export const activateFilters = async (page: Page, filterNames: string[]): Promise<ActivateFiltersResult> => {
  const wanted = [...new Set(filterNames.map(normalizeFilterName).filter(Boolean))]

  try {
    const frame = await getListingsFrame(page)
    await openFilters(frame)

    const availableFilters = await getAvailableFilterNames(frame)
    const missingFilters = wanted.filter((filterName) => !availableFilters.some((available) => sameFilter(available, filterName)))

    if (missingFilters.length > 0) {
      return {
        ok: false,
        error: `Filter(s) not found: ${missingFilters.join(", ")}`,
        availableFilters,
        missingFilters,
      }
    }

    for (const filterName of wanted) {
      await frame.getByRole("button", { name: exactFilterPattern(filterName) }).click()
      await frame.getByRole("button", { name: "Apply", exact: true }).click()
    }

    await frame.getByRole("button", { name: "Done", exact: true }).click()
    return { ok: true, activated: wanted }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      availableFilters: [],
      missingFilters: wanted,
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

const openFilters = async (frame: Frame) => {
  await frame.getByPlaceholder("Search items", { exact: true }).waitFor({ state: "visible", timeout: 30000 })
  await frame.locator("input[placeholder='Search items']").locator("xpath=following::button[1]").click()
}

const getAvailableFilterNames = async (frame: Frame) => {
  const buttons = await frame.locator("button").allTextContents()
  return buttons.map(normalizeFilterName).filter((name) => name && !["Clear all filters", "Done"].includes(name))
}

const normalizeFilterName = (name: string) => name.trim().replace(/\s+/g, " ")

const sameFilter = (left: string, right: string) => normalizeFilterName(left).toLowerCase() === normalizeFilterName(right).toLowerCase()

const exactFilterPattern = (filterName: string) => new RegExp(`^${escapeRegex(normalizeFilterName(filterName))}$`, "i")

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
