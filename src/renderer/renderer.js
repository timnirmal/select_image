const state = {
	folderPath: null,
	records: [],
	currentIndex: 0,
	metaById: new Map(),
};

const statusEl = document.getElementById('status');
const gridEl = document.getElementById('grid');
const viewerEl = document.getElementById('viewer');
const galleryEl = document.getElementById('gallery');
const viewerImageEl = document.getElementById('viewerImage');
const viewerMetaEl = document.getElementById('viewerMeta');

function setStatus(text) { statusEl.textContent = text; }
function showGallery() { galleryEl.classList.remove('hidden'); viewerEl.classList.add('hidden'); }
function showViewer() { viewerEl.classList.remove('hidden'); galleryEl.classList.add('hidden'); }

function badgeHtml(score) {
	if (score === -1) return '';
	if (score === 0) return '<span class="badge red">Rejected</span>';
	const colors = ['#d96a6a','#e0916a','#e0c36a','#a6d96a','#6ad97c'];
	const idx = Math.max(1, Math.min(5, score)) - 1;
	return `<span class="badge" style="background:${colors[idx]}; color:#111;">Score ${score}</span>`;
}

function renderGrid() {
	state.metaById.clear();
	gridEl.innerHTML = '';
	for (let i = 0; i < state.records.length; i++) {
		const r = state.records[i];
		const card = document.createElement('div');
		card.className = 'card';
		const img = document.createElement('img');
		img.src = r.thumbDataUrl || r.fullDataUrl;
		img.alt = r.name;
		img.loading = 'lazy';
		img.addEventListener('click', () => { state.currentIndex = i; renderViewer(); showViewer(); });
		const meta = document.createElement('div');
		meta.className = 'meta';
		meta.dataset.id = r.id;
		meta.innerHTML = `${r.name} ${badgeHtml(r.score)}`;
		state.metaById.set(r.id, meta);
		card.appendChild(img);
		card.appendChild(meta);
		gridEl.appendChild(card);
	}
}

function renderViewer() {
	if (state.records.length === 0) return;
	const r = state.records[state.currentIndex];
	viewerImageEl.src = r.fullDataUrl;
	const stateLabel = r.score === -1 ? 'Not selected' : (r.score === 0 ? 'Rejected' : `Accepted • Score ${r.score}`);
	viewerMetaEl.textContent = `${r.name}  •  ${stateLabel}  •  ${state.currentIndex + 1}/${state.records.length}`;
	setStatus(`${state.records.length} images loaded in memory`);
}

function updateCardMeta(record) {
	const meta = state.metaById.get(record.id);
	if (meta) meta.innerHTML = `${record.name} ${badgeHtml(record.score)}`;
}

function setScore(score) {
	const r = state.records[state.currentIndex];
	r.score = score; // -1 not selected, 0 rejected, 1..5 accepted
	renderViewer();
	updateCardMeta(r);
	scheduleCsvSync();
}

function prevImage() { if (!state.records.length) return; state.currentIndex = (state.currentIndex - 1 + state.records.length) % state.records.length; renderViewer(); }
function nextImage() { if (!state.records.length) return; state.currentIndex = (state.currentIndex + 1) % state.records.length; renderViewer(); }

async function generateThumb(dataUrl, maxSize = 400) {
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => {
			const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
			const w = Math.round(img.width * scale);
			const h = Math.round(img.height * scale);
			const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
			const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
			resolve(canvas.toDataURL('image/jpeg', 0.8));
		};
		img.onerror = () => resolve(null);
		img.src = dataUrl;
	});
}

let csvSyncTimer = null;
function scheduleCsvSync() {
	if (csvSyncTimer) clearTimeout(csvSyncTimer);
	csvSyncTimer = setTimeout(async () => {
		await window.api.updateCsv(state.folderPath, state.records);
		setStatus('Changes saved');
	}, 400);
}

async function loadCsvScores(folderPath) {
	const map = await window.api.loadCsv(folderPath);
	return map || {};
}

async function openFolder() {
	setStatus('Selecting folder…');
	const { folderPath, images, skipped } = await window.api.selectFolder();
	if (!folderPath) { setStatus('No folder selected'); return; }
	state.folderPath = folderPath;
	const scoreMap = await loadCsvScores(folderPath);
	state.records = images.map(img => ({ ...img, score: (scoreMap[img.path] ?? -1) }));
	state.currentIndex = 0;
	renderGrid();
	setStatus(`Generating thumbnails… 0/${state.records.length}`);
	for (let i = 0; i < state.records.length; i++) {
		const r = state.records[i];
		if (!r.thumbDataUrl) r.thumbDataUrl = await generateThumb(r.fullDataUrl, 400);
		if ((i + 1) % 32 === 0) {
			setStatus(`Generating thumbnails… ${i + 1}/${state.records.length}`);
			// Update only the image src for already-rendered cards
			requestAnimationFrame(() => {
				const meta = state.metaById.get(r.id); // force layout update by touching a node
				if (meta) meta.innerHTML = `${r.name} ${badgeHtml(r.score)}`;
			});
		}
	}
	setStatus(`Loaded ${state.records.length} images in memory (skipped ${skipped})`);
	// Final pass to update thumbnails in DOM
	requestAnimationFrame(() => renderGrid());
	if (state.records.length > 0) { renderViewer(); }
	showGallery();
}

async function saveCsv() {
	if (!state.folderPath) { setStatus('No folder open'); return; }
	await window.api.updateCsv(state.folderPath, state.records);
	setStatus('CSV saved');
}

// Keyboard
window.addEventListener('keydown', (e) => {
	if (e.key === 'ArrowLeft') { prevImage(); }
	else if (e.key === 'ArrowRight') { nextImage(); }
	else if (e.key === ' ') { e.preventDefault(); const r = state.records[state.currentIndex]; setScore(r.score === -1 || r.score === 0 ? 5 : -1); }
	else if (e.key === 'n' || e.key === 'N') { setScore(0); }
	else if (e.key >= '1' && e.key <= '5') { setScore(parseInt(e.key, 10)); }
	else if (e.key.toLowerCase() === 'g') { showGallery(); }
});

// Buttons
const openBtn = document.getElementById('openBtn');
const saveBtn = document.getElementById('saveBtn');
const galleryBtn = document.getElementById('galleryBtn');
const viewerBtn = document.getElementById('viewerBtn');
openBtn.addEventListener('click', openFolder);
saveBtn.addEventListener('click', saveCsv);
galleryBtn.addEventListener('click', showGallery);
viewerBtn.addEventListener('click', () => { if (state.records.length) { renderViewer(); showViewer(); }});

setStatus('Ready. Click Open Folder.');
