const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fg = require('fast-glob');
const { exiftool } = require('exiftool-vendored');

const RAW_EXTENSIONS = new Set(['.nef', '.arw', '.cr2', '.cr3', '.dng', '.rw2', '.orf', '.raf', '.srw', '.pef', '.erf', '.3fr', '.iiq', '.mos', '.mef', '.nrw']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tiff', '.webp']);
for (const e of RAW_EXTENSIONS) IMAGE_EXTENSIONS.add(e);

const isDev = process.env.NODE_ENV !== 'production';

async function loadRawPreviewBuffer(filePath) {
	const tags = ['JpgFromRaw', 'PreviewImage', 'ThumbnailImage'];
	for (const tag of tags) {
		try {
			const buf = await exiftool.extractBinaryTag(tag, filePath);
			if (buf && Buffer.isBuffer(buf) && buf.length > 0) return buf;
		} catch (_) {}
	}
	throw new Error('No embedded preview found');
}

function extOf(filePath) { return path.extname(filePath).toLowerCase(); }
function isHiddenOrSidecar(filePath) {
	const base = path.basename(filePath);
	if (base.startsWith('.') || base.startsWith('._')) return true;
	const ext = extOf(filePath);
	if (ext === '.xmp') return true;
	return false;
}

async function scanFolderRecursive(folderPath) {
	const patterns = [ path.join(folderPath, '**/*').replace(/\\/g, '/') ];
	const entries = await fg(patterns, { dot: false, onlyFiles: true, followSymbolicLinks: false });
	return entries.filter(p => !isHiddenOrSidecar(p) && IMAGE_EXTENSIONS.has(extOf(p)));
}

function guessMimeFromExt(ext) {
	switch (ext) {
		case '.jpg': case '.jpeg': return 'image/jpeg';
		case '.png': return 'image/png';
		case '.gif': return 'image/gif';
		case '.webp': return 'image/webp';
		case '.bmp': return 'image/bmp';
		case '.tiff': return 'image/tiff';
		default: return 'application/octet-stream';
	}
}

function bufferToDataUrl(buffer, mime) {
	return `data:${mime};base64,${buffer.toString('base64')}`;
}

async function loadImageToMemory(filePath) {
	const extension = extOf(filePath);
	let fullBuf;
	let mime;
	if (RAW_EXTENSIONS.has(extension)) {
		const preview = await loadRawPreviewBuffer(filePath); // JPEG buffer
		fullBuf = preview;
		mime = 'image/jpeg';
	} else {
		fullBuf = await fs.promises.readFile(filePath);
		mime = guessMimeFromExt(extension);
	}
	const stats = await fs.promises.stat(filePath);
	return {
		id: `${stats.ino}-${stats.mtimeMs}-${stats.size}`,
		name: path.basename(filePath),
		path: filePath,
		ext: extension,
		size: stats.size,
		fullDataUrl: bufferToDataUrl(fullBuf, mime),
		thumbDataUrl: null, // renderer will generate
	};
}

async function selectAndLoadFolder(win) {
	const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'] });
	if (canceled || !filePaths || filePaths.length === 0) return { folderPath: null, images: [], skipped: 0 };
	const folderPath = filePaths[0];
	const files = await scanFolderRecursive(folderPath);
	const images = [];
	let skipped = 0;
	for (const file of files) {
		try {
			const record = await loadImageToMemory(file);
			images.push(record);
		} catch (e) {
			skipped++;
			if (isDev) console.warn('Skipped file', file, e.message);
		}
	}
	return { folderPath, images, skipped };
}

async function saveCsv(folderPath, records) {
	const outPath = path.join(folderPath, 'image_selections.csv');
	const header = 'filename,path,liked,rejected,score\n';
	const lines = [header];
	for (const r of records) {
		const row = [ r.name, r.path, r.liked ? '1' : '0', r.rejected ? '1' : '0', String(r.score ?? 5) ].join(',');
		lines.push(row + '\n');
	}
	await fs.promises.writeFile(outPath, lines.join(''), 'utf8');
	return outPath;
}

function createWindow() {
	const win = new BrowserWindow({
		width: 1280,
		height: 900,
		webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') },
	});
	win.loadFile(path.join(__dirname, 'renderer/index.html'));
	if (isDev) win.webContents.openDevTools({ mode: 'detach' });
	return win;
}

app.whenReady().then(() => {
	const win = createWindow();
	ipcMain.handle('select-folder', async () => { try { return await selectAndLoadFolder(win); } catch (e) { return { error: e.message }; } });
	ipcMain.handle('save-csv', async (_e, folderPath, records) => { try { return await saveCsv(folderPath, records); } catch (e) { return { error: e.message }; } });
	ipcMain.handle('reveal-in-finder', async (_e, targetPath) => { try { shell.showItemInFolder(targetPath); return true; } catch (e) { return { error: e.message }; } });
	app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', async () => { try { await exiftool.end(); } catch (_) {} if (process.platform !== 'darwin') app.quit(); });
