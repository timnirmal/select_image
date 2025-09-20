const state = {
	folderPath: null,
	records: [],
	currentIndex: 0,
	metaById: new Map(),
	cardByIndex: [],
	selectedIndices: new Set(),
	anchorIndex: null,
};

const statusEl = document.getElementById('status');
const gridEl = document.getElementById('grid');
const viewerEl = document.getElementById('viewer');
const galleryEl = document.getElementById('gallery');
const viewerContainerEl = document.getElementById('viewerContainer');
const viewerImageEl = document.getElementById('viewerImage');
const viewerMetaEl = document.getElementById('viewerMeta');
const zoomSelect = document.getElementById('zoomSelect');
const zoomSlider = document.getElementById('zoomSlider');
const zoomLabel = document.getElementById('zoomLabel');
const clearThumbsBtn = document.getElementById('clearThumbsBtn');
let viewerZoomMode = 'fit'; // 'fit' or numeric percent

function isGalleryVisible() { return !galleryEl.classList.contains('hidden'); }
function setStatus(text) { statusEl.textContent = text; }
function showGallery() { galleryEl.classList.remove('hidden'); viewerEl.classList.add('hidden'); updateGridSelection(); }
function showViewer() { viewerEl.classList.remove('hidden'); galleryEl.classList.add('hidden'); }

function badgeHtml(score) {
	if (score === -1) return '';
	if (score === 0) return '<span class="badge red">Rejected</span>';
	const colors = ['#d96a6a','#e0916a','#e0c36a','#a6d96a','#6ad97c'];
	const idx = Math.max(1, Math.min(5, score)) - 1;
	return `<span class="badge" style="background:${colors[idx]}; color:#111;">Score ${score}</span>`;
}

const MAX_PARALLEL = 8;
let lazyObserver = null;

async function ensureThumb(i) {
	const r = state.records[i];
	if (!r) return;
	if (!r.thumbDataUrl) {
		const cached = await window.api.getThumb(state.folderPath, r.id);
		if (cached) r.thumbDataUrl = cached;
	}
	if (!r.thumbDataUrl) {
		r.thumbDataUrl = await generateThumb(r.fullDataUrl, 400);
		if (r.thumbDataUrl) await window.api.cacheThumb(state.folderPath, r.id, r.thumbDataUrl);
	}
	const card = state.cardByIndex[i];
	if (card) {
		const img = card.querySelector('img');
		if (img) img.src = r.thumbDataUrl || r.fullDataUrl;
	}
}

function setupLazyObserver() {
	if (lazyObserver) { try { lazyObserver.disconnect(); } catch (_) {} }
	lazyObserver = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			if (entry.isIntersecting) {
				const el = entry.target;
				const idx = Number(el.dataset.index);
				ensureThumb(idx);
				lazyObserver.unobserve(el);
			}
		}
	}, { root: gridEl, rootMargin: '200px', threshold: 0.01 });
}

function renderGrid() {
	state.metaById.clear();
	state.cardByIndex = [];
	gridEl.innerHTML = '';
	setupLazyObserver();
	for (let i = 0; i < state.records.length; i++) {
		const r = state.records[i];
		const card = document.createElement('div');
		card.className = 'card';
		card.dataset.index = String(i);
		const img = document.createElement('img');
		img.src = r.thumbDataUrl || r.fullDataUrl || '';
		img.alt = r.name;
		img.loading = 'lazy';
		img.addEventListener('error', () => {
			if (img.src && img.src !== r.fullDataUrl) img.src = r.fullDataUrl; else { img.remove(); const ph = document.createElement('div'); ph.style.height='160px'; ph.style.background='#2a2a2a'; ph.style.display='flex'; ph.style.alignItems='center'; ph.style.justifyContent='center'; ph.textContent='No preview'; card.prepend(ph); }
		});
		img.addEventListener('click', (ev) => { handleCardClick(i, ev); });
		img.addEventListener('dblclick', () => { state.currentIndex = i; renderViewer(); showViewer(); });
		const meta = document.createElement('div');
		meta.className = 'meta';
		meta.dataset.id = r.id;
		meta.innerHTML = `${r.name} ${badgeHtml(r.score)}`;
		state.metaById.set(r.id, meta);
		card.appendChild(img);
		card.appendChild(meta);
		gridEl.appendChild(card);
		state.cardByIndex.push(card);
		lazyObserver.observe(card);
	}
	updateGridSelection();
}

function clearSelection() { state.selectedIndices.clear(); state.anchorIndex = null; renderSelectionClasses(); }
function renderSelectionClasses() {
	for (let i = 0; i < state.cardByIndex.length; i++) {
		const card = state.cardByIndex[i];
		if (!card) continue;
		card.classList.toggle('selected', i === state.currentIndex || state.selectedIndices.has(i));
	}
}

function updateGridSelection() {
	for (const card of state.cardByIndex) card.classList.remove('selected');
	const card = state.cardByIndex[state.currentIndex];
	if (card) {
		card.classList.add('selected');
		card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}
	renderSelectionClasses();
}

function handleCardClick(i, event) {
	const isShift = event.shiftKey;
	const isToggle = event.metaKey || event.ctrlKey;
	if (isShift && state.anchorIndex != null) {
		state.selectedIndices.clear();
		const [a, b] = [state.anchorIndex, i].sort((x, y) => x - y);
		for (let k = a; k <= b; k++) state.selectedIndices.add(k);
		state.currentIndex = i;
	} else if (isToggle) {
		if (state.selectedIndices.has(i)) state.selectedIndices.delete(i); else state.selectedIndices.add(i);
		state.anchorIndex = i;
		state.currentIndex = i;
	} else {
		clearSelection();
		state.currentIndex = i;
		state.anchorIndex = i;
	}
	updateGridSelection();
}

function applyScoreToSelection(score) {
	if (isGalleryVisible() && state.selectedIndices.size > 0) {
		for (const i of state.selectedIndices) { state.records[i].score = score; updateCardMeta(state.records[i]); }
		scheduleCsvSync();
	} else {
		setScore(score);
	}
}

function applyViewerZoom() {
	const r = state.records[state.currentIndex];
	if (!r) return;
	const img = viewerImageEl;
    if (viewerZoomMode === 'fit') {
        viewerContainerEl.classList.remove('zoomed');
        try { viewerContainerEl.scrollTo({ left: 0, top: 0, behavior: 'auto' }); } catch (_) { viewerContainerEl.scrollLeft = 0; viewerContainerEl.scrollTop = 0; }
    }
	if (viewerZoomMode === 'fit') {
        // Fill the viewer while preserving aspect ratio (allows upscaling)
        img.style.maxWidth = 'none'; img.style.maxHeight = 'none';
        img.style.width = '100%';
        img.style.height = '100%';
        if (zoomSlider) { zoomSlider.value = '100'; }
        if (zoomLabel) { zoomLabel.textContent = 'Fit'; }
	} else {
		const pct = Number(viewerZoomMode);
		img.style.maxWidth = 'none'; img.style.maxHeight = 'none';
		img.style.width = pct + '%'; img.style.height = 'auto';
        // Enable scroll/pan whenever zoom > 100%
        viewerContainerEl.classList.toggle('zoomed', pct > 100);
        if (zoomSlider) { zoomSlider.value = String(pct); }
        if (zoomLabel) { zoomLabel.textContent = `${pct}%`; }
	}
}

function renderViewer() {
	if (state.records.length === 0) return;
	const r = state.records[state.currentIndex];
	viewerImageEl.src = r.fullDataUrl;
	const stateLabel = r.score === -1 ? 'Not selected' : (r.score === 0 ? 'Rejected' : `Accepted • Score ${r.score}`);
	viewerMetaEl.textContent = `${r.name}  •  ${stateLabel}  •  ${state.currentIndex + 1}/${state.records.length}`;
	setStatus(`${state.records.length} images loaded in memory`);
	applyViewerZoom();
}

function updateCardMeta(record) {
	const meta = state.metaById.get(record.id);
	if (meta) meta.innerHTML = `${record.name} ${badgeHtml(record.score)}`;
}

function setScore(score) {
	const r = state.records[state.currentIndex];
	r.score = score; // -1 not selected, 0 rejected, 1..5 accepted
	if (isGalleryVisible()) {
		updateCardMeta(r);
		updateGridSelection();
	} else {
		renderViewer();
		updateCardMeta(r);
	}
	scheduleCsvSync();
}

function prevImage() {
	if (!state.records.length) return;
	state.currentIndex = (state.currentIndex - 1 + state.records.length) % state.records.length;
	if (isGalleryVisible()) updateGridSelection(); else renderViewer();
}

function nextImage() {
	if (!state.records.length) return;
	state.currentIndex = (state.currentIndex + 1) % state.records.length;
	if (isGalleryVisible()) updateGridSelection(); else renderViewer();
}

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

viewerEl.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (viewerZoomMode === 'fit') viewerZoomMode = 100;
        // Slower zoom: smaller step, scale step with current zoom for smoother feel
        const baseStep = 5; // percent
        const current = Number(viewerZoomMode);
        const step = Math.max(2, Math.round(baseStep * (current >= 200 ? 0.5 : 1)));
        const delta = e.deltaY < 0 ? step : -step;
        viewerZoomMode = Math.max(10, Math.min(800, current + delta));
        zoomSelect.value = String(viewerZoomMode);
        applyViewerZoom();
    }
}, { passive: false });

zoomSelect.addEventListener('change', () => {
	const val = zoomSelect.value;
	viewerZoomMode = val === 'fit' ? 'fit' : Number(val);
	applyViewerZoom();
});

if (zoomSlider) {
    zoomSlider.addEventListener('input', () => {
        const val = Number(zoomSlider.value);
        viewerZoomMode = val;
        zoomSelect.value = String(val);
        applyViewerZoom();
    });
}

const openBtn = document.getElementById('openBtn');
const saveBtn = document.getElementById('saveBtn');
const galleryBtn = document.getElementById('galleryBtn');
const viewerBtn = document.getElementById('viewerBtn');

let isLoading = false;
function setLoading(loading, message) {
	isLoading = loading;
	openBtn.disabled = loading;
	saveBtn.disabled = loading;
	galleryBtn.disabled = loading;
	viewerBtn.disabled = loading;
	if (message) setStatus(message);
}

function readyStatus() {
	if (state.records.length > 0) setStatus(`Ready • ${state.records.length} images`);
	else setStatus('Ready. Click Open Folder.');
}

async function openFolder() {
	if (isLoading) return;
	setLoading(true, 'Selecting folder…');
	let folderPath = null;
	try {
		const res = await window.api.selectFolder();
		if (!res || res.error) { setStatus(res && res.error ? `Error: ${res.error}` : 'Selection failed'); return; }
		folderPath = res.folderPath;
		if (!folderPath) { setStatus('Selection canceled'); return; }
		const images = res.images || [];
		const skipped = res.skipped || 0;
		state.folderPath = folderPath;
		const scoreMap = await loadCsvScores(folderPath);
		state.records = images.map(img => ({ ...img, score: (scoreMap[img.path] ?? -1) }));
		state.currentIndex = 0;
		renderGrid();
		setStatus(`Ready • ${state.records.length} images`);
		showGallery();
	} catch (e) {
		setStatus(`Error: ${e && e.message ? e.message : 'Failed to open folder'}`);
	} finally {
		setLoading(false);
		readyStatus();
	}
}

async function saveCsv() {
	if (!state.folderPath || isLoading) { setStatus('No folder open'); return; }
	await window.api.updateCsv(state.folderPath, state.records);
	setStatus('CSV saved');
	setTimeout(readyStatus, 800);
}

// Keyboard
window.addEventListener('keydown', (e) => {
	if (e.key === 'Escape') { showGallery(); return; }
	if (e.key === 'ArrowLeft') { prevImage(); }
	else if (e.key === 'ArrowRight') { nextImage(); }
	else if (e.key === ' ') { e.preventDefault(); const r = state.records[state.currentIndex]; applyScoreToSelection(r.score === -1 || r.score === 0 ? 5 : -1); }
	else if (e.key === 'n' || e.key === 'N') { applyScoreToSelection(0); }
	else if (e.key >= '1' && e.key <= '5') { applyScoreToSelection(parseInt(e.key, 10)); }
	else if (e.key.toLowerCase() === 'g') { showGallery(); }
    else if (e.key === 'Enter') { if (isGalleryVisible() && state.records.length) { renderViewer(); showViewer(); } }
    else if (e.key.toLowerCase() === 'z') { // zoom in
        if (viewerZoomMode === 'fit') viewerZoomMode = 100;
        viewerZoomMode = Math.min(800, Number(viewerZoomMode) + 10);
        zoomSelect.value = String(viewerZoomMode);
        applyViewerZoom();
    } else if (e.key.toLowerCase() === 'x') { // zoom out
        if (viewerZoomMode === 'fit') viewerZoomMode = 100;
        viewerZoomMode = Math.max(10, Number(viewerZoomMode) - 10);
        if (viewerZoomMode === 100) zoomSelect.value = '100';
        applyViewerZoom();
    }
});

clearThumbsBtn.addEventListener('click', async () => {
	if (state.folderPath) { await window.api.clearThumbCache(state.folderPath); setStatus('Thumbnail cache cleared'); }
});

// Buttons
openBtn.addEventListener('click', openFolder);
saveBtn.addEventListener('click', saveCsv);
galleryBtn.addEventListener('click', showGallery);
viewerBtn.addEventListener('click', () => { if (state.records.length) { renderViewer(); showViewer(); }});

readyStatus();

// --- Panning via mouse drag when zoomed ---
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let scrollStartLeft = 0;
let scrollStartTop = 0;

viewerContainerEl.addEventListener('mousedown', (e) => {
    if (viewerZoomMode === 'fit') return;
    if (e.button !== 0) return; // left button only
    if (e.target !== viewerImageEl) return; // drag only when grabbing the image
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    scrollStartLeft = viewerContainerEl.scrollLeft;
    scrollStartTop = viewerContainerEl.scrollTop;
    viewerContainerEl.classList.add('dragging');
    e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    viewerContainerEl.scrollLeft = scrollStartLeft - dx;
    viewerContainerEl.scrollTop = scrollStartTop - dy;
});

function endDrag() {
    if (!isDragging) return;
    isDragging = false;
    viewerContainerEl.classList.remove('dragging');
}

document.addEventListener('mouseup', endDrag);
document.addEventListener('mouseleave', endDrag);

// Double-click resets to Fit
viewerImageEl.addEventListener('dblclick', () => {
    viewerZoomMode = 'fit';
    zoomSelect.value = 'fit';
    applyViewerZoom();
});
