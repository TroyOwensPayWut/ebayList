// Run: pnpm tsx src/nextAvailableProduct.test.ts
import assert from "node:assert/strict"
import { pickNextAvailableSku } from "./nextAvailableProduct.js"

const rows = [
  { sku: "AB100", title: "Red Widget", enabled: true, hasError: false },
  { sku: "AB101", title: "Blue Gadget", enabled: false, hasError: false }, // first available
  { sku: "AB102", title: "Green Gizmo", enabled: false, hasError: true }, // available flag but errored -> skip
  { sku: "AB103", title: "Yellow Doohickey", enabled: false, hasError: false }, // next available after AB101
]

// 1. no startSku -> first disabled/no-error row
assert.deepEqual(pickNextAvailableSku(rows), { ok: true, sku: "AB101", title: "Blue Gadget" })

// 2. startSku matches -> first disabled/no-error row *after* it (skips the start row and errored row)
assert.deepEqual(pickNextAvailableSku(rows, "AB101"), { ok: true, sku: "AB103", title: "Yellow Doohickey" })

// 2b. case-insensitive match
assert.deepEqual(pickNextAvailableSku(rows, "ab101"), { ok: true, sku: "AB103", title: "Yellow Doohickey" })

// 3. startSku not present -> error
assert.deepEqual(pickNextAvailableSku(rows, "ZZ999"), { ok: false, error: "Start SKU ZZ999 was not found" })

// 4. empty grid -> "No product rows were found" (takes precedence over start-not-found)
assert.deepEqual(pickNextAvailableSku([], "AB101"), { ok: false, error: "No product rows were found" })

// 5. start found but nothing available after it
assert.deepEqual(pickNextAvailableSku(rows, "AB103"), { ok: false, error: "No disabled product without errors was found" })

// 6. Z@ title prefix -> no longer skipped
const zRows = [
  { sku: "AB200", title: "Z@ Widget", enabled: false, hasError: false },
  { sku: "AB201", title: "Visible Widget", enabled: false, hasError: false },
]
assert.deepEqual(pickNextAvailableSku(zRows), { ok: true, sku: "AB200", title: "Z@ Widget" })

// 6c. ZA@ title prefix -> skipped too
const zaRows = [
  { sku: "AB300", title: "ZA@ Hidden Widget", enabled: false, hasError: false }, // skip
  { sku: "AB301", title: "Visible Widget", enabled: false, hasError: false },
]
assert.deepEqual(pickNextAvailableSku(zaRows), { ok: true, sku: "AB301", title: "Visible Widget" })

console.log("nextAvailableProduct: all assertions passed")
