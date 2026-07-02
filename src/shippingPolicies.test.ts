// Run: pnpm tsx src/shippingPolicies.test.ts
import assert from "node:assert/strict"
import { shippingPolicyForWeightLb } from "./shippingPolicies.js"

// tier boundaries are upper-inclusive
assert.equal(shippingPolicyForWeightLb(0.3), "W0-0.5 | $4 | DOM/GSP")
assert.equal(shippingPolicyForWeightLb(0.5), "W0-0.5 | $4 | DOM/GSP")
assert.equal(shippingPolicyForWeightLb(0.6), "W0.51-0.75 | $5 | DOM/GSP")
assert.equal(shippingPolicyForWeightLb(0.9), "W0.75-0.99 | $6 | DOM/GSP")
assert.equal(shippingPolicyForWeightLb(1), "W1-3 | $8.5 | DOM/GSP")
assert.equal(shippingPolicyForWeightLb(3), "W1-3 | $8.5 | DOM/GSP")
assert.equal(shippingPolicyForWeightLb(3.1), "W3-8 | $11 | DOM/GSP")
assert.equal(shippingPolicyForWeightLb(10), "W8-12 | $15 | DOM/GSP")
assert.equal(shippingPolicyForWeightLb(15), "W12-20 | $20 | DOM/GSP")
assert.equal(shippingPolicyForWeightLb(25), "W20-30 | $25 | DOM")
assert.equal(shippingPolicyForWeightLb(34.3), "W30-40 | $30 | DOM")
assert.equal(shippingPolicyForWeightLb(45), "W40-50 | $35 | DOM")
assert.equal(shippingPolicyForWeightLb(60), "W50-75 | $60 | DOM")
assert.equal(shippingPolicyForWeightLb(100), "W75-150 | $100 | DOM")
assert.equal(shippingPolicyForWeightLb(200), "W151-299 | $350 | DOM")
assert.equal(shippingPolicyForWeightLb(400), "W300-499 | $500 | DOM")
assert.equal(shippingPolicyForWeightLb(500), "W500+ | $700 | DOM")
assert.equal(shippingPolicyForWeightLb(2000), "W500+ | $700 | DOM")

// gaps between named ranges round UP to the pricier tier
assert.equal(shippingPolicyForWeightLb(0.995), "W1-3 | $8.5 | DOM/GSP")
assert.equal(shippingPolicyForWeightLb(150.5), "W151-299 | $350 | DOM")
assert.equal(shippingPolicyForWeightLb(299.5), "W300-499 | $500 | DOM")

// invalid inputs
assert.equal(shippingPolicyForWeightLb(0), null)
assert.equal(shippingPolicyForWeightLb(-2), null)
assert.equal(shippingPolicyForWeightLb(NaN), null)
assert.equal(shippingPolicyForWeightLb(Infinity), null)

console.log("shippingPolicies: all assertions passed")
