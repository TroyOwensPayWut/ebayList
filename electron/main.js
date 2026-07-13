import path from "node:path"
import { fileURLToPath } from "node:url"

import { app, BrowserWindow, WebContentsView, ipcMain } from "electron"
import { chromium } from "playwright"

import { buildConfig } from "../dist/config.js"
import { runListingLoop } from "../dist/run.js"
import { ensureLoggedIn } from "../dist/shopify.js"
import { TIMEOUT_MS } from "../dist/timeout.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The automation drives the app's OWN Chromium over CDP, so the Shopify/Google pages
// live as tabs inside this window instead of an external Chrome.
// ponytail: fixed localhost port; make it configurable if it ever collides.
const CDP_PORT = 9223
app.commandLine.appendSwitch("remote-debugging-port", String(CDP_PORT))

// Shopify/Google treat unusual user agents with suspicion — drop the Electron/app tokens.
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/[\d.]+/, "")
  .replace(/\sebayList\/[\d.]+/, "")

// Must match the #header height in index.html.
const HEADER_PX = 124

let win = null

const send = (channel, payload) => win?.webContents.send(channel, payload)

// The run loop reports via console.log/error — mirror both into the UI log pane.
for (const level of ["log", "error"]) {
  const original = console[level].bind(console)
  console[level] = (...args) => {
    original(...args)
    send("log", { level, line: args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ") })
  }
}

// --- Embedded tabs ---------------------------------------------------------

const tabs = new Map() // id -> WebContentsView
let tabSeq = 0

const viewBounds = () => {
  const [width, height] = win.getContentSize()
  return { x: 0, y: HEADER_PX, width, height: Math.max(0, height - HEADER_PX) }
}

const createTab = (label) => {
  const id = ++tabSeq
  const view = new WebContentsView()
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  win.contentView.addChildView(view)
  view.setBounds(viewBounds())
  tabs.set(id, view)
  send("tab-created", { id, label })
  view.webContents.loadURL("about:blank")
  activateTab(id)
  return view
}

// id null = show the log pane (hide every web view).
const activateTab = (id) => {
  for (const [tabId, view] of tabs) view.setVisible(tabId === id)
  send("tab-active", id)
}

const closeAllTabs = () => {
  for (const view of tabs.values()) {
    win.contentView.removeChildView(view)
    view.webContents.close()
  }
  tabs.clear()
  send("tabs-cleared", null)
  activateTab(null)
}

ipcMain.on("activate-tab", (_event, id) => activateTab(id))

// --- Browser session over CDP ----------------------------------------------

const makeConfig = () => buildConfig({ slowMoMs: 250 })

let session = null

const getSession = async (config) => {
  if (session) return session

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`, { slowMo: config.slowMoMs })
  const context = browser.contexts()[0] // Electron's default session (persistent)
  context.setDefaultTimeout(TIMEOUT_MS)
  context.setDefaultNavigationTimeout(TIMEOUT_MS)
  await context.addInitScript("window.__name = function(fn) { return fn; };")

  // Tabs are created by Electron, then matched to the new Playwright page by
  // diffing context.pages() — serialized so two tabs can't race the diff.
  let queue = Promise.resolve()
  const newPage = (label) => {
    const result = queue.then(async () => {
      const before = new Set(context.pages())
      createTab(label ?? "Tab")
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const page = context.pages().find((p) => !before.has(p))
        if (page) return page
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error("Timed out waiting for the new embedded tab to appear over CDP")
    })
    queue = result.catch(() => {})
    return result
  }

  session = {
    shopifyPage: null,
    newPage,
    close: async () => {
      session = null
      await browser.close().catch(() => {}) // detaches CDP without killing Electron
      closeAllTabs()
    },
  }
  return session
}

// Session with a logged-in Shopify tab — injected into runListingLoop, reused across runs.
const openElectronSession = async (config) => {
  const s = await getSession(config)
  if (!s.shopifyPage || s.shopifyPage.isClosed()) {
    s.shopifyPage = await s.newPage("Shopify")
  }
  await ensureLoggedIn(s.shopifyPage, config) // navigates to the products page; waits for manual login/2FA if needed
  return s
}

// --- UI actions -------------------------------------------------------------

// The run loop asks what to do per product; forward to the renderer and wait for the click.
const promptUser = (sku, title) =>
  new Promise((resolve) => {
    send("prompt", { sku, title })
    ipcMain.once("prompt-response", (_event, action) => resolve(action))
  })

let busy = false
const runTask = async (task) => {
  if (busy) return
  busy = true
  send("busy", true)
  try {
    await task()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
  } finally {
    busy = false
    send("busy", false)
  }
}

ipcMain.on("start-run", () => runTask(() => runListingLoop(makeConfig(), promptUser, openElectronSession)))
ipcMain.on("start-auth", () =>
  runTask(async () => {
    await openElectronSession(makeConfig())
    console.log("Shopify session saved. You can start a listing run.")
  }),
)

// --- Startup ----------------------------------------------------------------

// Self-check for the CDP plumbing (no Shopify needed): EBAYLIST_SMOKE=1 pnpm ui
const runSmokeCheck = async () => {
  try {
    const s = await getSession(makeConfig())
    const page = await s.newPage("Smoke")
    await page.goto("https://example.com", { waitUntil: "domcontentloaded" })
    const title = await page.title()
    if (!/example/i.test(title)) throw new Error(`Unexpected title: ${title}`)
    await s.close()
    console.log(`SMOKE_OK title="${title}"`)
    app.exit(0)
  } catch (error) {
    console.error("SMOKE_FAIL", error)
    app.exit(1)
  }
}

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1440,
    height: 960,
    title: "ebayList",
    webPreferences: { preload: path.join(__dirname, "preload.cjs") },
  })
  win.on("resize", () => {
    for (const view of tabs.values()) view.setBounds(viewBounds())
  })
  win.loadFile(path.join(__dirname, "index.html"))
  if (process.env.EBAYLIST_SMOKE) runSmokeCheck()
  // Throwaway module harness (electron/tryModules.js): EBAYLIST_MODULE_TEST=1 pnpm ui
  if (process.env.EBAYLIST_MODULE_TEST) {
    import("./tryModules.js").then((m) => m.runModuleTests({ openSession: openElectronSession, makeConfig, app }))
  }
})

// ponytail: quitting mid-run just kills the process; staged-only changes are dropped.
app.on("window-all-closed", () => app.quit())
