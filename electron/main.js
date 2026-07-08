import path from "node:path"
import { fileURLToPath } from "node:url"

import { app, BrowserWindow, ipcMain } from "electron"

import { buildConfig } from "../dist/config.js"
import { runListingLoop } from "../dist/run.js"
import { runAuthOnly } from "../dist/shopify.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let win = null

const send = (channel, payload) => win?.webContents.send(channel, payload)

// The whole CLI reports via console.log/error — mirror both into the UI log pane.
for (const level of ["log", "error"]) {
  const original = console[level].bind(console)
  console[level] = (...args) => {
    original(...args)
    send("log", { level, line: args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ") })
  }
}

const makeConfig = () =>
  buildConfig({
    authOnly: false,
    headless: false,
    slowMoMs: 250,
    // Keep the Chrome profile in the app's own data folder (cwd is "/" in a packaged app).
    profileDir: path.join(app.getPath("userData"), "profile"),
  })

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

ipcMain.on("start-run", () => runTask(() => runListingLoop(makeConfig(), promptUser)))
ipcMain.on("start-auth", () =>
  runTask(async () => {
    await runAuthOnly(makeConfig())
    console.log("Shopify session saved. You can start a listing run.")
  }),
)

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 760,
    height: 680,
    title: "ebayList",
    webPreferences: { preload: path.join(__dirname, "preload.cjs") },
  })
  win.loadFile(path.join(__dirname, "index.html"))
})

// ponytail: quitting mid-run just kills the process; Chrome closes with it, staged-only changes are dropped.
app.on("window-all-closed", () => app.quit())
