import type { Page } from "playwright"

import { TIMEOUT_MS } from "./timeout.js"

// Shopify's unit select shows lb/oz/kg/g but has used spelled-out values too.
const LB_PER_UNIT: Record<string, number> = {
  lb: 1,
  lbs: 1,
  pounds: 1,
  oz: 1 / 16,
  ounces: 1 / 16,
  kg: 2.20462262,
  kilograms: 2.20462262,
  g: 0.00220462262,
  grams: 0.00220462262,
}

/** Converts a raw weight-field value + unit to pounds. Null on unknown unit, NaN, or <= 0 (a 0 lb product would silently get the cheapest shipping tier). Exported for the self-check. */
export const parseWeightLb = (rawValue: string, unit: string): number | null => {
  const value = Number(rawValue.trim())
  const factor = LB_PER_UNIT[unit.trim().toLowerCase()]

  if (factor === undefined || !Number.isFinite(value) || value <= 0) {
    return null
  }

  return value * factor
}

export type ExtractWeightResult =
  | { ok: true; weightLb: number; rawValue: string; unit: string }
  | { ok: false; error: string }

/**
 * Reads the Shipping card's weight off a Shopify admin product detail page
 * (call after openFirstShopifyProduct). Single-variant products only: products
 * with variants have no product-level weight field, which comes back as an error.
 */
export const extractProductWeightLb = async (
  page: Page,
  timeoutMs = TIMEOUT_MS,
): Promise<ExtractWeightResult> => {
  try {
    // Shipping card ids observed live: input#ShippingCardWeight (label "Product weight")
    // and the unit web component s-internal-select#ShippingCardWeightUnit.
    const input = page.locator('#ShippingCardWeight, input[name="weight"]').first()

    try {
      await input.waitFor({ state: "visible", timeout: timeoutMs })
    } catch {
      return { ok: false, error: "No weight field on this product page (multi-variant or non-physical product?)" }
    }

    const rawValue = await input.inputValue()

    // The unit is a Polaris web component (not a native <select>): read its value
    // property, falling back to the selected <s-option>.
    const unit = await page.evaluate(() => {
      const el = document.querySelector('#ShippingCardWeightUnit, [name="weightUnit"]')
      if (!el) return null
      const value = (el as HTMLSelectElement).value || el.getAttribute("value")
      return value || el.querySelector("s-option[selected]")?.getAttribute("value") || null
    })

    if (!unit) {
      return { ok: false, error: "Found weight input but no unit select on the page" }
    }

    const weightLb = parseWeightLb(rawValue, unit)

    if (weightLb === null) {
      return { ok: false, error: `Weight field has no usable value (value="${rawValue}", unit="${unit}")` }
    }

    return { ok: true, weightLb, rawValue, unit }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
