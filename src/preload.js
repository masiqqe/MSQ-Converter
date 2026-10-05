const { contextBridge, ipcRenderer, webUtils } = require('electron')
const sendChannels = new Set(['start-convert','start-scale','start-resolution','cancel-convert','window-minimize','window-maximize','window-close','paste-image','check-update','open-result','open-output','open-source','show-source','open-link'])
const receiveChannels = new Set(['convert-files','scale-files','resolution-files','paste-files','convert-progress','convert-metrics','convert-done','convert-error','convert-cancelled','job-queued','update-available','update-error'])
contextBridge.exposeInMainWorld('msq', {
  send(channel,data) { if (sendChannels.has(channel)) ipcRenderer.send(channel,data) },
  on(channel,cb) { if (receiveChannels.has(channel)) ipcRenderer.on(channel,(_event,data)=>cb(data)) },
  chooseFiles:()=>ipcRenderer.invoke('choose-files'),
  chooseFolder:()=>ipcRenderer.invoke('choose-folder'),
  describeFiles:paths=>ipcRenderer.invoke('describe-files',paths),
  copyText:text=>ipcRenderer.invoke('copy-text',text),
  getSettings:()=>ipcRenderer.invoke('get-settings'),
  saveSettings:settings=>ipcRenderer.invoke('save-settings',settings),
  integration:enabled=>ipcRenderer.invoke('integration',enabled),
  createDesktopShortcut:()=>ipcRenderer.invoke('create-desktop-shortcut'),
  getPathForFile:file=>webUtils.getPathForFile(file),
  ready:()=>ipcRenderer.send('renderer-ready')
})
