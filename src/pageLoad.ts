import type { Frame, Page } from "playwright"

// Loader classes captured live from the Codisto frame (src/inspectLoading probe).
// Note: the frame exposes NO aria-busy / progressbar / spinner — only these skeletons
// and the .dataset-loading grid state, so we key off the real DOM, not generic guesses.
const LOADER_SELECTOR = [".dataset-loading", ".skeleton-page-overlay", ".skeleton-wrapper", "[class*='Polaris-Skeleton']"].join(",")

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type SettleOptions = { timeoutMs?: number; floorMs?: number; pollMs?: number; clearNeeded?: number }

// Pure timing loop: a 250ms floor (so a late loader can mount), then block until the
// probe reports "not loading" for `clearNeeded` consecutive polls. Exported for tests.
export const waitUntilIdle = async (
  isLoading: () => Promise<boolean>,
  { timeoutMs = 30000, floorMs = 250, pollMs = 250, clearNeeded = 2 }: SettleOptions = {},
) => {
  await wait(floorMs)
  const deadline = Date.now() + timeoutMs
  let clearStreak = 0

  while (Date.now() < deadline) {
    if (await isLoading()) {
      clearStreak = 0
    } else if ((clearStreak += 1) >= clearNeeded) {
      return
    }

    await wait(pollMs)
  }

  throw new Error("Timed out waiting for Codisto frame to settle")
}

/** Waits for a Codisto frame to be idle (skeletons + dataset load cleared). Use after in-frame actions that reload. */
export const waitForFrameLoaders = async (frame: Frame, options: SettleOptions = {}) => {
  const loaders = frame.locator(LOADER_SELECTOR)
  const isLoading = async () => {
    for (let index = 0, count = await loaders.count(); index < count; index += 1) {
      if (await loaders.nth(index).isVisible().catch(() => false)) {
        return true
      }
    }

    return false
  }

  await waitUntilIdle(isLoading, options)
}

// The iframe can attach before its URL resolves to the Codisto app — poll for it
// instead of failing on the first look.
export const findCodistoFrame = async (page: Page, timeoutMs = 10000): Promise<Frame> => {
  await page.locator("iframe").first().waitFor({ state: "attached", timeout: 30000 })
  const deadline = Date.now() + timeoutMs

  for (;;) {
    const frame = page.frames().find((candidate) => candidate.url().includes("codisto"))
    if (frame) {
      return frame
    }
    if (Date.now() >= deadline) {
      throw new Error("Marketplace Connect frame was not found")
    }
    await wait(250)
  }
}

/** Waits for the Codisto tab to be idle before acting on it: resolves the frame, then settles. */
export const waitForFrameSettled = async (page: Page, options: SettleOptions = {}) => {
  const frame = await findCodistoFrame(page)
  await waitForFrameLoaders(frame, options)
}
