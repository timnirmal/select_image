const state = {
	folderPath: null,
	records: [],
	currentIndex: 0,
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

function renderGrid() {
	gridEl.innerHTML = '';
	for (let i = 0; i < state.records.length; i++) {
		const r = state.records[i];
		const card = document.createElement('div');
		card.className = 'card';
		const img = document.createElement('img');
		img.src = r.thumbDataUrl;
		img.alt = r.name;
		img.loading = 'lazy';
		img.addEventListener('click', () => { state.currentIndex = i; renderViewer(); showViewer(); });
		const meta = document.createElement('div');
		meta.className = 'meta';
		const badge = r.rejected ? '<span class="badge red">Rejected</span>' : (r.liked ? `<span class="badge">Liked • ${r.score ?? 5}</span>` : `<span class="badge">Score ${r.score ?? 5}</span>`);
		meta.innerHTML = `${r.name} ${badge}`;
		card.appendChild(img);
		card.appendChild(meta);
		gridEl.appendChild(card);
	}
}

function renderViewer() {
	if (state.records.length === 0) return;
	const r = state.records[state.currentIndex];
	viewerImageEl.src = r.fullDataUrl;
	viewerMetaEl.textContent = `${r.name}  •  ${r.rejected ? 'Rejected' : (r.liked ? 'Liked' : 'Neutral')}  •  Score ${r.score ?? 5}  •  ${state.currentIndex + 1}/${state.records.length}`;
	setStatus(`${state.records.length} images loaded in memory`);
}

function setScore(score) {
	const r = state.records[state.currentIndex];
	r.score = score;
	r.liked = r.liked || score >= 3;
	r.rejected = false;
	renderViewer();
	renderGrid();
}

function toggleLike() {
	const r = state.records[state.currentIndex];
	r.liked = !r.liked;
	if (r.liked) r.rejected = false;
	renderViewer();
	renderGrid();
}

function rejectCurrent() {
	const r = state.records[state.currentIndex];
	r.rejected = true;
	r.liked = false;
	renderViewer();
	renderGrid();
}

function prevImage() {
	if (state.records.length === 0) return;
	state.currentIndex = (state.currentIndex - 1 + state.records.length) % state.records.length;
	renderViewer();
}

function nextImage() {
	if (state.records.length === 0) return;
	state.currentIndex = (state.currentIndex + 1) % state.records.length;
	renderViewer();
}

async function generateThumb(dataUrl, maxSize = 400) {
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => {
			const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
			const w = Math.round(img.width * scale);
			const h = Math.round(img.height * scale);
			const canvas = document.createElement('canvas');
			canvas.width = w; canvas.height = h;
			const ctx = canvas.getContext('2d');
			ctx.drawImage(img, 0, 0, w, h);
			resolve(canvas.toDataURL('image/jpeg', 0.8));
		};
		img.onerror = () => resolve(null);
		img.src = dataUrl;
	});
}

async function openFolder() {
	setStatus('Selecting folder…');
	const { folderPath, images, skipped } = await window.api.selectFolder();
	if (!folderPath) { setStatus('No folder selected'); return; }
	state.folderPath = folderPath;
	state.records = images.map(img => ({ ...img, liked: false, rejected: false, score: 5 }));
	state.currentIndex = 0;
	setStatus(`Generating thumbnails… 0/${state.records.length}`);
	for (let i = 0; i < state.records.length; i++) {
		const r = state.records[i];
		if (!r.thumbDataUrl) {
			r.thumbDataUrl = await generateThumb(r.fullDataUrl, 400);
		}
		if (i % 24 === 0) {
			setStatus(`Generating thumbnails… ${i + 1}/${state.records.length}`);
			renderGrid();
		}
	}
	setStatus(`Loaded ${state.records.length} images in memory (skipped ${skipped})`);
	renderGrid();
	if (state.records.length > 0) { renderViewer(); }
	showGallery();
}

async function saveCsv() {
	if (!state.folderPath) { setStatus('No folder open'); return; }
	const out = await window.api.saveCsv(state.folderPath, state.records);
	setStatus(`Saved CSV to ${out}`);
}

// Keyboard
window.addEventListener('keydown', (e) => {
	if (e.key === 'ArrowLeft') { prevImage(); }
	else if (e.key === 'ArrowRight') { nextImage(); }
	else if (e.key === ' ') { e.preventDefault(); toggleLike(); }
	else if (e.key >= '1' && e.key <= '5') { setScore(parseInt(e.key, 10)); }
	else if (e.key.toLowerCase() === 'n') { rejectCurrent(); }
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
