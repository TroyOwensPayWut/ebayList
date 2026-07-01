import { buildConfig, parseCliOptions } from "./config.js"
import { runListingLoop } from "./run.js"
import { runAuthOnly } from "./shopify.js"

const main = async () => {
  const config = buildConfig(parseCliOptions())

  if (config.authOnly) {
    await runAuthOnly(config)
    console.log("Shopify session is saved in the local browser profile.")
    return
  }

  await runListingLoop(config)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
