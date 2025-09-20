const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fg = require('fast-glob');
const { exiftool } = require('exiftool-vendored');

// Global error guards to prevent crashes
process.on('uncaughtException', (err) => {
	try { console.error('UncaughtException:', err); dialog.showErrorBox('Unexpected error', String(err)); } catch (_) {}
});
process.on('unhandledRejection', (reason) => {
	try { console.error('UnhandledRejection:', reason); dialog.showErrorBox('Unexpected rejection', String(reason)); } catch (_) {}
});

const RAW_EXTENSIONS = new Set(['.nef', '.arw', '.cr2', '.cr3', '.dng', '.rw2', '.orf', '.raf', '.srw', '.pef', '.erf', '.3fr', '.iiq', '.mos', '.mef', '.nrw']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tiff', '.webp']);
for (const e of RAW_EXTENSIONS) IMAGE_EXTENSIONS.add(e);

const isDev = process.env.NODE_ENV !== 'production';
const CSV_NAME = 'image_selections.csv';
const DB_NAME = 'photo_selector_db.json';
const DEFAULT_PROJECT_ID = 'default';
const DEFAULT_PROJECT_NAME = 'Default';

function normalizeSlashes(p) { return String(p || '').replace(/\\/g, '/'); }

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

function bufferToDataUrl(buffer, mime) { return `data:${mime};base64,${buffer.toString('base64')}`; }

async function loadImageToMemory(filePath, rootFolder = null) {
	const extension = extOf(filePath);
	let fullBuf; let mime;
	const browserSafe = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
	if (RAW_EXTENSIONS.has(extension)) {
		const preview = await loadRawPreviewBuffer(filePath); // JPEG buffer
		fullBuf = preview; mime = 'image/jpeg';
	} else if (!browserSafe.has(extension)) {
		// Try to extract an embedded preview (often JPEG) for unsupported formats like TIFF
		try {
			const preview = await loadRawPreviewBuffer(filePath); // works for many formats too
			fullBuf = preview; mime = 'image/jpeg';
		} catch (_) {
			fullBuf = await fs.promises.readFile(filePath); mime = guessMimeFromExt(extension);
		}
	} else {
		fullBuf = await fs.promises.readFile(filePath); mime = guessMimeFromExt(extension);
	}
    const stats = await fs.promises.stat(filePath);
    const rel = rootFolder ? normalizeSlashes(path.relative(rootFolder, filePath)) : null;
	return {
		id: `${stats.ino}-${stats.mtimeMs}-${stats.size}`,
		name: path.basename(filePath),
		path: filePath,
        relPath: rel,
		ext: extension,
		size: stats.size,
		fullDataUrl: bufferToDataUrl(fullBuf, mime),
		thumbDataUrl: null,
	};
}

function csvPath(folderPath) { return path.join(folderPath, CSV_NAME); }
function appDbPath() { return path.join(app.getPath('userData'), DB_NAME); }
function ensureDbDefaults(db) {
    if (!db || typeof db !== 'object') db = { projects: [], folders: [] };
    if (!Array.isArray(db.projects)) db.projects = [];
    if (!Array.isArray(db.folders)) db.folders = [];
    let changed = false;
    let def = db.projects.find(p => p.id === DEFAULT_PROJECT_ID);
    if (!def) { def = { id: DEFAULT_PROJECT_ID, name: DEFAULT_PROJECT_NAME, folders: [] }; db.projects.unshift(def); changed = true; }
    for (const fp of db.folders) { if (!def.folders.includes(fp)) { def.folders.push(fp); changed = true; } }
    return { db, changed };
}

async function loadDb() {
    try {
        const p = appDbPath();
        const s = await fs.promises.readFile(p, 'utf8');
        let db = JSON.parse(s);
        const ensured = ensureDbDefaults(db);
        if (ensured.changed) { await saveDb(ensured.db); }
        return ensured.db;
    } catch (_) {
        const ensured = ensureDbDefaults({ projects: [], folders: [] });
        try { await saveDb(ensured.db); } catch (_) {}
        return ensured.db;
    }
}
async function saveDb(db) { const p = appDbPath(); await fs.promises.mkdir(path.dirname(p), { recursive: true }); await fs.promises.writeFile(p, JSON.stringify(db, null, 2), 'utf8'); return true; }
async function ensureCsvExists(folderPath) {
	const outPath = csvPath(folderPath);
	try { await fs.promises.access(outPath, fs.constants.F_OK); }
	catch (_) { await fs.promises.writeFile(outPath, 'filename,path,score\n', 'utf8'); }
	return outPath;
}

async function readCsvScores(folderPath) {
	const outPath = csvPath(folderPath);
	try {
		const content = await fs.promises.readFile(outPath, 'utf8');
		const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
		if (lines.length === 0) return {};
		const map = {};
		for (let i = 1; i < lines.length; i++) {
			const parts = lines[i].split(',');
			if (parts.length >= 3) {
                const filename = (parts[0] || '').trim();
                const rawPath = (parts[1] || '').trim();
                const scoreStr = parts[2];
                const score = parseInt(scoreStr, 10);
                if (Number.isNaN(score)) continue;
                const normalized = normalizeSlashes(rawPath);
                if (normalized) {
                    map[normalized] = score;
                    // If CSV path is relative, also map absolute under current folder
                    if (!path.isAbsolute(rawPath)) {
                        const abs = normalizeSlashes(path.join(folderPath, rawPath));
                        map[abs] = score;
                    }
                }
                const base = (normalized ? path.basename(normalized) : filename) || '';
                if (base) map[base] = score;
			}
		}
		return map;
	} catch (_) { return {}; }
}

async function writeCsvScores(folderPath, records) {
	const outPath = await ensureCsvExists(folderPath);
	const header = 'filename,path,score\n';
	const lines = [header];
    for (const r of records) {
        const rel = r.relPath || normalizeSlashes(path.relative(folderPath, r.path || ''));
        const pathForCsv = rel || normalizeSlashes(r.path || '');
        lines.push([ r.name, pathForCsv, String(r.score ?? -1) ].join(',') + '\n');
    }
	await fs.promises.writeFile(outPath, lines.join(''), 'utf8');
	return outPath;
}

function thumbsDir(folderPath) { return path.join(folderPath, '.thumbnails'); }
async function ensureThumbsDir(folderPath) { await fs.promises.mkdir(thumbsDir(folderPath), { recursive: true }); }
async function cacheThumb(folderPath, id, dataUrl) {
	await ensureThumbsDir(folderPath);
	const b64 = dataUrl.split(',')[1] || '';
	const buf = Buffer.from(b64, 'base64');
	const file = path.join(thumbsDir(folderPath), `${id}.jpg`);
	await fs.promises.writeFile(file, buf);
	return file;
}
async function clearThumbCache(folderPath) {
	try {
		const dir = thumbsDir(folderPath);
		const entries = await fs.promises.readdir(dir);
		await Promise.all(entries.map(e => fs.promises.rm(path.join(dir, e), { force: true })));
		return true;
	} catch (_) { return false; }
}

async function readThumbAsDataUrl(folderPath, id) {
	try {
		const file = path.join(thumbsDir(folderPath), `${id}.jpg`);
		const buf = await fs.promises.readFile(file);
		return bufferToDataUrl(buf, 'image/jpeg');
	} catch (_) { return null; }
}

async function selectAndLoadFolder(win) {
	try {
		const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'] });
		if (canceled || !filePaths || filePaths.length === 0) return { folderPath: null, images: [], skipped: 0 };
		const folderPath = filePaths[0];
		await ensureCsvExists(folderPath);
		await ensureThumbsDir(folderPath); // make sure .thumbnails exists up front
		try { await exiftool.version(); } catch (_) {}
		let files = [];
		try { files = await scanFolderRecursive(folderPath); }
		catch (e) { return { error: `Failed to scan folder: ${e.message}` }; }
		const images = []; let skipped = 0;
        for (let i = 0; i < files.length; i++) {
			const file = files[i];
            try { images.push(await loadImageToMemory(file, folderPath)); }
			catch (e) { skipped++; if (isDev) console.warn('Skipped file', file, e.message); }
			if ((i + 1) % 50 === 0) { await new Promise(resolve => setImmediate(resolve)); }
		}
		return { folderPath, images, skipped };
	} catch (e) { return { error: e.message }; }
}

// Multi-folder open helper (returns combined records with folder grouping)
async function openMultipleFolders(win, folderPaths) {
    try {
        const all = [];
        for (const folderPath of folderPaths) {
            await ensureCsvExists(folderPath);
            await ensureThumbsDir(folderPath);
            let files = [];
            try { files = await scanFolderRecursive(folderPath); }
            catch (e) { all.push({ folderPath, error: `Failed to scan: ${e.message}` }); continue; }
            const images = []; let skipped = 0;
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                try { images.push(await loadImageToMemory(file, folderPath)); }
                catch (e) { skipped++; if (isDev) console.warn('Skipped file', file, e.message); }
                if ((i + 1) % 50 === 0) { await new Promise(resolve => setImmediate(resolve)); }
            }
            all.push({ folderPath, images, skipped });
        }
        return { result: all };
    } catch (e) { return { error: e.message }; }
}

function createWindow() {
	const win = new BrowserWindow({
		width: 1280,
		height: 900,
		webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') },
	});
	win.loadFile(path.join(__dirname, 'renderer/index.html'));
	return win;
}

app.whenReady().then(() => {
	const win = createWindow();
	ipcMain.handle('select-folder', async () => { try { return await selectAndLoadFolder(win); } catch (e) { return { error: e.message }; } });
	ipcMain.handle('load-csv', async (_e, folderPath) => { try { await ensureCsvExists(folderPath); return await readCsvScores(folderPath); } catch (e) { return { error: e.message }; } });
	ipcMain.handle('update-csv', async (_e, folderPath, records) => { try { return await writeCsvScores(folderPath, records); } catch (e) { return { error: e.message }; } });
	ipcMain.handle('get-thumb', async (_e, folderPath, id) => { try { return await readThumbAsDataUrl(folderPath, id); } catch (e) { return { error: e.message }; } });
	ipcMain.handle('cache-thumb', async (_e, folderPath, id, dataUrl) => { try { return await cacheThumb(folderPath, id, dataUrl); } catch (e) { return { error: e.message }; } });
	ipcMain.handle('clear-thumb-cache', async (_e, folderPath) => { try { return await clearThumbCache(folderPath); } catch (e) { return { error: e.message }; } });
	ipcMain.handle('reveal-in-finder', async (_e, targetPath) => { try { shell.showItemInFolder(targetPath); return true; } catch (e) { return { error: e.message }; } });
    // Home/Projects handlers
    ipcMain.handle('db-load', async () => { try { return await loadDb(); } catch (e) { return { error: e.message }; } });
    ipcMain.handle('db-add-folder', async (_e, folderPath) => { try { const db = await loadDb(); if (!db.folders.includes(folderPath)) db.folders.push(folderPath); const def = db.projects.find(p => p.id === DEFAULT_PROJECT_ID) || db.projects[0]; if (def && !def.folders.includes(folderPath)) def.folders.push(folderPath); await saveDb(db); return db; } catch (e) { return { error: e.message }; } });
    ipcMain.handle('db-add-project', async (_e, name) => { try { const db = await loadDb(); const id = Date.now().toString(36); db.projects.push({ id, name, folders: [] }); await saveDb(db); return db; } catch (e) { return { error: e.message }; } });
    ipcMain.handle('db-add-folder-to-project', async (_e, projectId, folderPath) => { try { const db = await loadDb(); const p = db.projects.find(p => p.id === projectId); if (p && !p.folders.includes(folderPath)) p.folders.push(folderPath); await saveDb(db); return db; } catch (e) { return { error: e.message }; } });
    ipcMain.handle('open-folders', async (_e, folderPaths) => { try { return await openMultipleFolders(win, folderPaths || []); } catch (e) { return { error: e.message }; } });
    ipcMain.handle('load-csv-multi', async (_e, folderPaths) => { try { const acc = {}; for (const fp of folderPaths || []) { Object.assign(acc, await readCsvScores(fp)); } return acc; } catch (e) { return { error: e.message }; } });
	app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', async () => { try { await exiftool.end(); } catch (_) {} if (process.platform !== 'darwin') app.quit(); });
