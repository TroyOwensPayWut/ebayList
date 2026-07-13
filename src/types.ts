export type LaunchOptions = {
  slowMoMs: number
}

export type AppConfig = LaunchOptions & {
  shopDomain: string
  loginTimeoutMs: number
  productsUrl: string
  listingsUrl: string
  motorsListingsUrl: string
}
