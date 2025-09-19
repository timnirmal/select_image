const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
	selectFolder: () => ipcRenderer.invoke('select-folder'),
	loadCsv: (folderPath) => ipcRenderer.invoke('load-csv', folderPath),
	updateCsv: (folderPath, records) => ipcRenderer.invoke('update-csv', folderPath, records),
	revealInFinder: (targetPath) => ipcRenderer.invoke('reveal-in-finder', targetPath),
});
