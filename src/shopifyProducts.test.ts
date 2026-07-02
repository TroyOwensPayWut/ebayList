// Run: pnpm tsx src/shopifyProducts.test.ts
import assert from "node:assert/strict"
import { pickFirstProductHref } from "./shopifyProducts.js"

// picks the first real product detail link, skipping nav and "Add product"
assert.equal(
  pickFirstProductHref([
    "/store/foo/products", // sidebar nav — no id
    "/store/foo/products/new", // Add product
    "/store/foo/products/123456?query=AB100", // first result
    "/store/foo/products/789",
  ]),
  "/store/foo/products/123456?query=AB100",
)

// plain id with no trailing chars matches
assert.equal(pickFirstProductHref(["/store/foo/products/42"]), "/store/foo/products/42")

// no results
assert.equal(pickFirstProductHref(["/store/foo/products", "/store/foo/products/new"]), undefined)
assert.equal(pickFirstProductHref([]), undefined)

console.log("shopifyProducts: all assertions passed")
