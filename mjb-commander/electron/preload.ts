import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
    getVersion: () => ipcRenderer.invoke("application-version"),

    onNewProject: (callback: () => void) =>
        ipcRenderer.on("new-project", callback),

    onOpenProject: (callback: () => void) =>
        ipcRenderer.on("open-project", callback),

    onImportReference: (callback: () => void) =>
        ipcRenderer.on("import-reference", callback),

    onRebuildIndex: (callback: () => void) =>
        ipcRenderer.on("rebuild-index", callback),

    removeListener: (channel: string, callback: (...args: unknown[]) => void) =>
        ipcRenderer.removeListener(channel, callback)
});
