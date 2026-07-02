// Run: pnpm tsx src/pageLoad.test.ts
import assert from "node:assert/strict"
import { waitUntilIdle } from "./pageLoad.js"

const fast = { floorMs: 1, pollMs: 1, timeoutMs: 200, clearNeeded: 2 }

// probe that returns a scripted sequence of loading states, then stays idle
const scripted = (seq: boolean[]) => {
  let i = 0
  return async () => seq[Math.min(i++, seq.length - 1)] ?? false
}

// 1. loads for a bit, then needs two consecutive clears before returning
{
  const probe = scripted([true, true, false, false])
  await waitUntilIdle(probe, fast) // resolves (no throw) once idle streak reached
}

// 2. a single clear then loading again does NOT satisfy the streak (would return too early)
{
  let calls = 0
  const probe = async () => {
    calls += 1
    return [true, false, true, false, false][Math.min(calls - 1, 4)] // clear resets on the re-load
  }
  await waitUntilIdle(probe, fast)
  assert.ok(calls >= 5, `expected the flicker to reset the streak, got ${calls} calls`)
}

// 3. never settles -> throws on timeout
await assert.rejects(() => waitUntilIdle(async () => true, fast), /Timed out/)

// --- findCodistoFrame: the iframe can attach with a blank URL before it resolves to codisto ---
import { findCodistoFrame } from "./pageLoad.js"
import type { Page } from "playwright"

const fakePage = (urls: string[][]) => {
  let i = 0
  return {
    locator: () => ({ first: () => ({ waitFor: async () => {} }) }),
    frames: () => (urls[Math.min(i++, urls.length - 1)] ?? []).map((url) => ({ url: () => url })),
  } as unknown as Page
}

// 4. frame URL resolves late -> found by polling instead of failing on first look
{
  const page = fakePage([["about:blank"], ["about:blank"], ["https://shopui.codisto.com/x"]])
  const frame = await findCodistoFrame(page, 5000)
  assert.match(frame.url(), /codisto/)
}

// 5. frame never resolves -> throws after the timeout
await assert.rejects(() => findCodistoFrame(fakePage([["about:blank"]]), 300), /Marketplace Connect frame was not found/)

console.log("pageLoad: all assertions passed")
