const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
	selectFolder: () => ipcRenderer.invoke('select-folder'),
	saveCsv: (folderPath, records) => ipcRenderer.invoke('save-csv', folderPath, records),
	revealInFinder: (targetPath) => ipcRenderer.invoke('reveal-in-finder', targetPath),
});
