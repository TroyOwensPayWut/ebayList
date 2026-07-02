// Run: pnpm tsx src/productWeight.test.ts
import assert from "node:assert/strict"
import { parseWeightLb } from "./productWeight.js"

const approx = (actual: number | null, expected: number) => {
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-6, `expected ~${expected}, got ${actual}`)
}

// unit conversions
approx(parseWeightLb("2", "lb"), 2)
approx(parseWeightLb("8", "oz"), 0.5)
approx(parseWeightLb("1", "kg"), 2.20462262)
approx(parseWeightLb("500", "g"), 1.10231131)

// spelled-out / cased / padded units
approx(parseWeightLb(" 2.5 ", "POUNDS"), 2.5)
approx(parseWeightLb("16", "Ounces"), 1)

// rejects: empty, zero, negative, junk, unknown unit
assert.equal(parseWeightLb("", "lb"), null)
assert.equal(parseWeightLb("0", "lb"), null)
assert.equal(parseWeightLb("-1", "kg"), null)
assert.equal(parseWeightLb("abc", "lb"), null)
assert.equal(parseWeightLb("2", "stone"), null)

console.log("productWeight: all assertions passed")
