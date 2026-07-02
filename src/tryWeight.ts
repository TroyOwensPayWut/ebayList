// Throwaway harness: pnpm tsx src/tryWeight.ts [SKU]
// Opens the Shopify product (first list item if no SKU) and prints the extracted weight.
import { buildConfig } from "./config.js"
import { launchAuthenticated } from "./shopify.js"
import { openFirstShopifyProduct, searchShopifyProductsBySku } from "./shopifyProducts.js"
import { extractProductWeightLb } from "./productWeight.js"

const main = async () => {
  const sku = process.argv[2]
  const config = buildConfig({ authOnly: false, headless: false, slowMoMs: 0 })
  const context = await launchAuthenticated(config)

  try {
    const page = context.pages()[0]

    if (sku) {
      console.log(`Searching for ${sku}...`)
      const search = await searchShopifyProductsBySku(page, config.productsUrl, sku)
      if (!search.ok) throw new Error(search.error)
    }

    const opened = await openFirstShopifyProduct(page)
    if (!opened.ok) throw new Error(opened.error)
    console.log(`On product page: ${page.url()}`)

    const weight = await extractProductWeightLb(page)
    console.log(weight.ok ? `Weight: ${weight.weightLb} lb (raw: ${weight.rawValue} ${weight.unit})` : `Failed: ${weight.error}`)
  } finally {
    await context.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
