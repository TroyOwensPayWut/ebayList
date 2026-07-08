const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("ebayList", {
  startRun: () => ipcRenderer.send("start-run"),
  startAuth: () => ipcRenderer.send("start-auth"),
  respond: (action) => ipcRenderer.send("prompt-response", action),
  onLog: (cb) => ipcRenderer.on("log", (_e, entry) => cb(entry)),
  onPrompt: (cb) => ipcRenderer.on("prompt", (_e, product) => cb(product)),
  onBusy: (cb) => ipcRenderer.on("busy", (_e, busy) => cb(busy)),
})
