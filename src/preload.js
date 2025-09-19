const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
	selectFolder: () => ipcRenderer.invoke('select-folder'),
	loadCsv: (folderPath) => ipcRenderer.invoke('load-csv', folderPath),
	updateCsv: (folderPath, records) => ipcRenderer.invoke('update-csv', folderPath, records),
	getThumb: (folderPath, id) => ipcRenderer.invoke('get-thumb', folderPath, id),
	cacheThumb: (folderPath, id, dataUrl) => ipcRenderer.invoke('cache-thumb', folderPath, id, dataUrl),
	clearThumbCache: (folderPath) => ipcRenderer.invoke('clear-thumb-cache', folderPath),
	revealInFinder: (targetPath) => ipcRenderer.invoke('reveal-in-finder', targetPath),
});
