// Run: pnpm tsx src/categories.test.ts
import assert from "node:assert/strict"

import { isValidCategoryId } from "./categories.js"

// Accepts positive eBay category numbers.
assert.equal(isValidCategoryId("20625"), true)
assert.equal(isValidCategoryId("  20625 "), true)

// Rejects the things the old "full category string" path used to accept.
assert.equal(isValidCategoryId("Home & Garden > Kitchen"), false)
assert.equal(isValidCategoryId("0"), false)
assert.equal(isValidCategoryId("01234"), false)
assert.equal(isValidCategoryId("12.5"), false)
assert.equal(isValidCategoryId(""), false)

console.log("categories.test.ts ok")
