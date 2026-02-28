import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  generateFeed: (url: string) => ipcRenderer.invoke("generate-feed", url),
  saveFile: (xmlContent: string) => ipcRenderer.invoke("save-file", xmlContent),
  setGithubToken: (token: string) => ipcRenderer.invoke("set-github-token", token),
  getGithubConfig: () => ipcRenderer.invoke("get-github-config"),
  publishFeed: (payload: { sourceUrl: string; rssXml: string; feedTitle: string }) =>
    ipcRenderer.invoke("publish-feed", payload)
});
