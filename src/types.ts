export type CliOptions = {
  authOnly: boolean
  headless: boolean
  slowMoMs: number
}

export type AppConfig = CliOptions & {
  shopDomain: string
  loginTimeoutMs: number
  profileDir: string
  productsUrl: string
  listingsUrl: string
  motorsListingsUrl: string
  browserChannel: "chrome" | "msedge" | undefined
}
