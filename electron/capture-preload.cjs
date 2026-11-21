const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('alexPreview', {
  snapshot: () => ipcRenderer.invoke('alex-preview:data'),
  ready: result => ipcRenderer.send('alex-preview:ready', result),
});
