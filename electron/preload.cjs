const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("ebayList", {
  startRun: () => ipcRenderer.send("start-run"),
  startAuth: () => ipcRenderer.send("start-auth"),
  respond: (action) => ipcRenderer.send("prompt-response", action),
  activateTab: (id) => ipcRenderer.send("activate-tab", id),
  onLog: (cb) => ipcRenderer.on("log", (_e, entry) => cb(entry)),
  onPrompt: (cb) => ipcRenderer.on("prompt", (_e, product) => cb(product)),
  onBusy: (cb) => ipcRenderer.on("busy", (_e, busy) => cb(busy)),
  onTabCreated: (cb) => ipcRenderer.on("tab-created", (_e, tab) => cb(tab)),
  onTabActive: (cb) => ipcRenderer.on("tab-active", (_e, id) => cb(id)),
  onTabsCleared: (cb) => ipcRenderer.on("tabs-cleared", () => cb()),
})
