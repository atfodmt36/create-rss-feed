import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  generateFeed: (url: string) => ipcRenderer.invoke("generate-feed", url),
  saveFile: (xmlContent: string) => ipcRenderer.invoke("save-file", xmlContent),
  saveSourceRules: (payload: { sourceUrl: string; rules: unknown }) =>
    ipcRenderer.invoke("save-source-rules", payload),
  getSourceRules: (sourceUrl: string) => ipcRenderer.invoke("get-source-rules", sourceUrl),
  setGithubToken: (token: string) => ipcRenderer.invoke("set-github-token", token),
  getGithubConfig: () => ipcRenderer.invoke("get-github-config"),
  publishFeed: (payload: { sourceUrl: string; rssXml: string; feedTitle: string }) =>
    ipcRenderer.invoke("publish-feed", payload)
});
