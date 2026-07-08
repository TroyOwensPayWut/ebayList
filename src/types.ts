export type CliOptions = {
  authOnly: boolean
  headless: boolean
  slowMoMs: number
  profileDir?: string // override for packaged app; CLI defaults to ./.auth/profile
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
