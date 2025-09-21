const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
	selectFolder: () => ipcRenderer.invoke('select-folder'),
	loadCsv: (folderPath) => ipcRenderer.invoke('load-csv', folderPath),
	updateCsv: (folderPath, records) => ipcRenderer.invoke('update-csv', folderPath, records),
	getThumb: (folderPath, id) => ipcRenderer.invoke('get-thumb', folderPath, id),
	cacheThumb: (folderPath, id, dataUrl) => ipcRenderer.invoke('cache-thumb', folderPath, id, dataUrl),
	clearThumbCache: (folderPath) => ipcRenderer.invoke('clear-thumb-cache', folderPath),
	revealInFinder: (targetPath) => ipcRenderer.invoke('reveal-in-finder', targetPath),
	loadFullImage: (filePath) => ipcRenderer.invoke('load-full-image', filePath),
	generateThumbnail: (filePath, folderPath) => ipcRenderer.invoke('generate-thumbnail', filePath, folderPath),
    // Home/Projects APIs
    chooseFolder: () => ipcRenderer.invoke('choose-folder'),
    dbLoad: () => ipcRenderer.invoke('db-load'),
    dbAddFolder: (folderPath) => ipcRenderer.invoke('db-add-folder', folderPath),
    dbAddProject: (name) => ipcRenderer.invoke('db-add-project', name),
    dbRenameProject: (projectId, name) => ipcRenderer.invoke('db-rename-project', projectId, name),
    dbAddFolderToProject: (projectId, folderPath) => ipcRenderer.invoke('db-add-folder-to-project', projectId, folderPath),
    openFolders: (folderPaths) => ipcRenderer.invoke('open-folders', folderPaths),
    loadCsvMulti: (folderPaths) => ipcRenderer.invoke('load-csv-multi', folderPaths),
});
