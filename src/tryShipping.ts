// Throwaway harness: pnpm tsx src/tryShipping.ts <SKU> [weightLb] [--commit]
// Extracts the SKU's weight from Shopify (unless weightLb is given), picks the
// weight-tier shipping policy, and stages it on the Codisto grid row.
// Staged-only by default; pass --commit to actually save.
import { buildConfig } from "./config.js"
import { launchAuthenticated } from "./shopify.js"
import { openFirstShopifyProduct, searchShopifyProductsBySku } from "./shopifyProducts.js"
import { extractProductWeightLb } from "./productWeight.js"
import { setShippingPolicyByWeight, shippingPolicyForWeightLb } from "./shippingPolicies.js"
import { waitForFrameSettled } from "./pageLoad.js"

const main = async () => {
  const args = process.argv.slice(2).filter((a) => a !== "--commit")
  const commit = process.argv.includes("--commit")
  const sku = args[0]
  if (!sku) throw new Error("Usage: pnpm tsx src/tryShipping.ts <SKU> [weightLb] [--commit]")

  const config = buildConfig({ authOnly: false, headless: false, slowMoMs: 0 })
  const context = await launchAuthenticated(config)

  try {
    let weightLb = args[1] ? Number(args[1]) : undefined

    if (weightLb === undefined) {
      const shopifyPage = context.pages()[0]
      console.log(`Extracting weight for ${sku} from Shopify...`)
      const search = await searchShopifyProductsBySku(shopifyPage, config.productsUrl, sku)
      if (!search.ok) throw new Error(search.error)
      const opened = await openFirstShopifyProduct(shopifyPage)
      if (!opened.ok) throw new Error(opened.error)
      const weight = await extractProductWeightLb(shopifyPage)
      if (!weight.ok) throw new Error(weight.error)
      weightLb = weight.weightLb
      console.log(`Weight: ${weightLb} lb (raw: ${weight.rawValue} ${weight.unit})`)
    }

    console.log(`Tier for ${weightLb} lb: ${shippingPolicyForWeightLb(weightLb)}`)

    const gridPage = await context.newPage()
    await gridPage.goto(config.listingsUrl, { waitUntil: "domcontentloaded" })
    await gridPage.locator("iframe").first().waitFor({ state: "attached" })
    await waitForFrameSettled(gridPage)

    console.log(`Setting shipping policy for ${sku} (commit: ${commit})...`)
    const result = await setShippingPolicyByWeight(gridPage, sku, weightLb, { commit })
    console.log(
      result.ok
        ? `OK: ${result.sku} -> "${result.policyName}" (id ${result.policyId})${commit ? " SAVED" : " staged only, not saved"}`
        : `Failed: ${result.error}`,
    )
  } finally {
    await context.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
