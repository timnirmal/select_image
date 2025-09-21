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
const homeEl = document.getElementById('home');
const viewerContainerEl = document.getElementById('viewerContainer');
const viewerImageEl = document.getElementById('viewerImage');
const viewerMetaEl = document.getElementById('viewerMeta');
const zoomSelect = document.getElementById('zoomSelect');
const zoomSlider = document.getElementById('zoomSlider');
const zoomLabel = document.getElementById('zoomLabel');
const gridSlider = document.getElementById('gridSlider');
const keyboardHelpEl = document.getElementById('keyboardHelp');
const closeKeyboardHelpBtn = document.getElementById('closeKeyboardHelp');
const toastContainer = document.getElementById('toastContainer');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettings');
const clearThumbsBtn = document.getElementById('clearThumbsBtn');
const showKeyboardHelpBtn = document.getElementById('showKeyboardHelp');
const themeSelect = document.getElementById('themeSelect');
const defaultThumbSize = document.getElementById('defaultThumbSize');
const thumbSizeLabel = document.getElementById('thumbSizeLabel');
const autoSaveInterval = document.getElementById('autoSaveInterval');
const maxThumbnailTasks = document.getElementById('maxThumbnailTasks');
let viewerZoomMode = 'fit'; // 'fit' or numeric percent
let isFullscreen = false;
let thumbnailGenerationProgress = { current: 0, total: 0, isGenerating: false };

// Toast notification system
function showToast(message, type = 'info', duration = 3000) {
	const toast = document.createElement('div');
	toast.className = `toast ${type}`;
	toast.textContent = message;
	
	toastContainer.appendChild(toast);
	
	// Trigger animation
	requestAnimationFrame(() => {
		toast.classList.add('show');
	});
	
	// Auto remove
	setTimeout(() => {
		toast.classList.remove('show');
		setTimeout(() => {
			if (toast.parentNode) {
				toast.parentNode.removeChild(toast);
			}
		}, 300);
	}, duration);
}

// Keyboard help modal
function showKeyboardHelp() {
	keyboardHelpEl.classList.remove('hidden');
}

function hideKeyboardHelp() {
	keyboardHelpEl.classList.add('hidden');
}

// Settings modal functions
function showSettings() {
	settingsModal.classList.remove('hidden');
	loadSettings();
}

function hideSettings() {
	settingsModal.classList.add('hidden');
	saveSettings();
}

// Settings persistence
const DEFAULT_SETTINGS = {
	theme: 'dark',
	defaultThumbSize: 200,
	autoSaveInterval: 400,
	maxThumbnailTasks: 8
};

let appSettings = { ...DEFAULT_SETTINGS };

function loadSettings() {
	try {
		const saved = localStorage.getItem('photoSelectorSettings');
		if (saved) {
			appSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
		}
	} catch (e) {
		console.warn('Failed to load settings:', e);
		appSettings = { ...DEFAULT_SETTINGS };
	}
	
	// Apply settings to UI
	themeSelect.value = appSettings.theme;
	defaultThumbSize.value = appSettings.defaultThumbSize;
	thumbSizeLabel.textContent = appSettings.defaultThumbSize + 'px';
	autoSaveInterval.value = appSettings.autoSaveInterval;
	maxThumbnailTasks.value = appSettings.maxThumbnailTasks;
	
	// Apply settings to app
	applyGridSize(appSettings.defaultThumbSize);
	if (gridSlider) gridSlider.value = appSettings.defaultThumbSize;
}

function saveSettings() {
	appSettings = {
		theme: themeSelect.value,
		defaultThumbSize: Number(defaultThumbSize.value),
		autoSaveInterval: Number(autoSaveInterval.value),
		maxThumbnailTasks: Number(maxThumbnailTasks.value)
	};
	
	try {
		localStorage.setItem('photoSelectorSettings', JSON.stringify(appSettings));
	} catch (e) {
		console.warn('Failed to save settings:', e);
	}
	
	// Apply changes immediately
	applyGridSize(appSettings.defaultThumbSize);
	if (gridSlider) gridSlider.value = appSettings.defaultThumbSize;
	
	showToast('Settings saved', 'success', 1500);
}

// Fullscreen functionality
function toggleFullscreen() {
	isFullscreen = !isFullscreen;
	document.body.classList.toggle('fullscreen', isFullscreen);
	
	if (isFullscreen) {
		showToast('Fullscreen mode - Press F11 or Esc to exit', 'info', 3000);
	} else {
		showToast('Exited fullscreen', 'info', 1500);
	}
}

function isGalleryVisible() { return !galleryEl.classList.contains('hidden'); }
function setStatus(text) { statusEl.textContent = text; }
function showHome() { homeEl.classList.remove('hidden'); galleryEl.classList.add('hidden'); viewerEl.classList.add('hidden'); document.body.classList.add('mode-gallery'); document.body.classList.remove('mode-viewer'); }
function showGallery() { homeEl.classList.add('hidden'); galleryEl.classList.remove('hidden'); viewerEl.classList.add('hidden'); document.body.classList.add('mode-gallery'); document.body.classList.remove('mode-viewer'); updateGridSelection(); }
function showViewer() { homeEl.classList.add('hidden'); viewerEl.classList.remove('hidden'); galleryEl.classList.add('hidden'); document.body.classList.add('mode-viewer'); document.body.classList.remove('mode-gallery'); }

function badgeHtml(score) {
	if (score === -1) return '';
	if (score === 0) return '<span class="badge red">Rejected</span>';
	const colors = ['#d96a6a','#e0916a','#e0c36a','#a6d96a','#6ad97c'];
	const idx = Math.max(1, Math.min(5, score)) - 1;
	return `<span class="badge" style="background:${colors[idx]}; color:#111;">Score ${score}</span>`;
}

const MAX_PARALLEL = 8;
let lazyObserver = null;
let activeThumbTasks = 0;
const pendingThumbIndices = new Set();

async function ensureFullImage(i) {
	const r = state.records[i];
	if (!r || r.fullDataUrl) return;
	
	try {
		const fullImage = await window.api.loadFullImage(r.path);
		if (fullImage && fullImage.fullDataUrl) {
			r.fullDataUrl = fullImage.fullDataUrl;
		}
	} catch (e) {
		console.warn('Failed to load full image:', r.path, e);
	}
}

async function ensureThumb(i) {
	const r = state.records[i];
	if (!r) return;
	
	const card = state.cardByIndex[i];
	if (!card) return;
	
	// Check for cached thumbnail first
	if (!r.thumbDataUrl) {
		try {
			const cached = await window.api.getThumb(state.folderPath, r.id);
			if (cached && !cached.error) {
				r.thumbDataUrl = cached;
				const placeholder = card.querySelector('.image-placeholder');
				if (placeholder) {
					const img = document.createElement('img');
					img.src = cached;
					img.alt = r.name;
					img.style.width = '100%';
					img.style.height = 'calc(var(--thumb-size, 200px) * 0.8)';
					img.style.objectFit = 'cover';
					img.style.display = 'block';
					img.style.opacity = '0';
					img.style.transition = 'opacity 0.3s ease';
					
					placeholder.replaceWith(img);
					
					requestAnimationFrame(() => {
						img.style.opacity = '1';
					});
				}
				return;
			}
		} catch (e) {
			console.warn('Failed to load cached thumbnail for', r.path, e);
		}
	}
	
	// If no cached thumb, generate one in background
	if (!r.thumbDataUrl && !r.isGeneratingThumb) {
        if (activeThumbTasks >= MAX_PARALLEL) {
            pendingThumbIndices.add(i);
            return;
        }
		r.isGeneratingThumb = true;
        activeThumbTasks++;
		
		try {
			console.log('Generating thumbnail for:', r.path);
			// Load full image and generate thumbnail
			const fullImage = await window.api.loadFullImage(r.path);
			if (fullImage && fullImage.error) {
				console.warn('Failed to load full image:', fullImage.error);
				// Show error placeholder
				const placeholder = card.querySelector('.image-placeholder');
				if (placeholder) {
					placeholder.innerHTML = `
						<div style="text-align: center; color: #ef4444;">
							<div style="font-size: 24px; margin-bottom: 4px;">⚠️</div>
							<div>Failed to load</div>
						</div>
					`;
				}
				return;
			}
			
			if (fullImage && fullImage.fullDataUrl) {
				const thumbDataUrl = await generateThumb(fullImage.fullDataUrl, 400);
				if (thumbDataUrl) {
					r.thumbDataUrl = thumbDataUrl;
					try {
						await window.api.cacheThumb(state.folderPath, r.id, thumbDataUrl);
					} catch (e) {
						console.warn('Failed to cache thumbnail:', e);
					}
					
					// Replace placeholder with actual image
					const placeholder = card.querySelector('.image-placeholder');
					if (placeholder) {
						const img = document.createElement('img');
						img.src = thumbDataUrl;
						img.alt = r.name;
						img.style.width = '100%';
						img.style.height = 'calc(var(--thumb-size, 200px) * 0.8)';
						img.style.objectFit = 'cover';
						img.style.display = 'block';
						img.style.opacity = '0';
						img.style.transition = 'opacity 0.3s ease';
						
						placeholder.replaceWith(img);
						
						requestAnimationFrame(() => {
							img.style.opacity = '1';
						});
					}
				} else {
					console.warn('Failed to generate thumbnail canvas for', r.path);
					// Show error placeholder
					const placeholder = card.querySelector('.image-placeholder');
					if (placeholder) {
						placeholder.innerHTML = `
							<div style="text-align: center; color: #ef4444;">
								<div style="font-size: 24px; margin-bottom: 4px;">⚠️</div>
								<div>Thumbnail failed</div>
							</div>
						`;
					}
				}
			} else {
				console.warn('No full image data received for', r.path);
				// Show error placeholder
				const placeholder = card.querySelector('.image-placeholder');
				if (placeholder) {
					placeholder.innerHTML = `
						<div style="text-align: center; color: #ef4444;">
							<div style="font-size: 24px; margin-bottom: 4px;">⚠️</div>
							<div>No image data</div>
						</div>
					`;
				}
			}
		} catch (e) {
			console.error('Failed to generate thumbnail for', r.path, e);
			// Show error placeholder
			const placeholder = card.querySelector('.image-placeholder');
			if (placeholder) {
				placeholder.innerHTML = `
					<div style="text-align: center; color: #ef4444;">
						<div style="font-size: 24px; margin-bottom: 4px;">⚠️</div>
						<div>Error: ${e.message}</div>
					</div>
				`;
			}
		} finally {
			r.isGeneratingThumb = false;
            activeThumbTasks = Math.max(0, activeThumbTasks - 1);
            // Schedule next pending thumb if any
            const nextIdx = pendingThumbIndices.values().next();
            if (!nextIdx.done) {
                pendingThumbIndices.delete(nextIdx.value);
                // Yield back to UI before starting next
                setTimeout(() => ensureThumb(nextIdx.value), 0);
            }
		}
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
    }, { root: null, rootMargin: '200px 0px', threshold: 0.01 });
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
		// Create placeholder or image
		let imageElement;
		if (r.thumbDataUrl) {
			imageElement = document.createElement('img');
			imageElement.src = r.thumbDataUrl;
			imageElement.alt = r.name;
			imageElement.loading = 'lazy';
			card.appendChild(imageElement);
		} else {
			// Gray placeholder while thumbnail loads
			const placeholder = document.createElement('div');
			placeholder.className = 'image-placeholder';
			placeholder.style.height = 'calc(var(--thumb-size, 200px) * 0.8)';
			placeholder.style.background = 'linear-gradient(135deg, #1a1f2e, #252a3a)';
			placeholder.style.display = 'flex';
			placeholder.style.alignItems = 'center';
			placeholder.style.justifyContent = 'center';
			placeholder.style.color = '#6b7585';
			placeholder.style.fontSize = '12px';
			placeholder.style.borderRadius = '8px 8px 0 0';
			placeholder.innerHTML = `
				<div style="text-align: center;">
					<div style="font-size: 24px; margin-bottom: 4px;">📷</div>
					<div>Loading...</div>
				</div>
			`;
			imageElement = placeholder;
			card.appendChild(placeholder);
		}
		
        // Add event listeners to the card instead of just the image
        card.addEventListener('mousedown', (ev) => { if (ev.button === 0) { handleCardClick(i, ev); ev.preventDefault(); } });
		card.addEventListener('dblclick', async () => { state.currentIndex = i; await renderViewer(); showViewer(); });
        const meta = document.createElement('div');
		meta.className = 'meta';
		meta.dataset.id = r.id;
		meta.innerHTML = `${r.name} ${badgeHtml(r.score)}`;
		state.metaById.set(r.id, meta);
        card.appendChild(imageElement);
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
    if (isShift) {
        const anchor = state.anchorIndex != null ? state.anchorIndex : state.currentIndex;
        state.selectedIndices.clear();
        const [a, b] = [anchor, i].sort((x, y) => x - y);
        for (let k = a; k <= b; k++) state.selectedIndices.add(k);
        state.currentIndex = i;
    } else if (isToggle) {
        if (state.selectedIndices.has(i)) state.selectedIndices.delete(i); else state.selectedIndices.add(i);
        state.anchorIndex = i;
        // Keep focus on the toggled card so actions apply immediately
        state.currentIndex = i;
	} else {
		clearSelection();
		state.currentIndex = i;
		state.anchorIndex = i;
	}
	updateGridSelection();
}

function applyScoreToSelection(score) {
    const inGallery = isGalleryVisible();
    const indices = inGallery
        ? (state.selectedIndices.size > 0 ? Array.from(state.selectedIndices) : [state.currentIndex])
        : [state.currentIndex];
    for (const idx of indices) {
        const rec = state.records[idx];
        if (!rec) continue;
        rec.score = score;
        updateCardMeta(rec);
    }
    if (inGallery) updateGridSelection(); else renderViewer();
    scheduleCsvSync();
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

async function renderViewer() {
	if (state.records.length === 0) return;
	const r = state.records[state.currentIndex];
	
	// Load full image if not already loaded
	if (!r.fullDataUrl) {
		viewerImageEl.src = ''; // Clear while loading
		setStatus('Loading image...');
		await ensureFullImage(state.currentIndex);
	}
	
	viewerImageEl.src = r.fullDataUrl || '';
	const stateLabel = r.score === -1 ? 'Not selected' : (r.score === 0 ? 'Rejected' : `Accepted • Score ${r.score}`);
	viewerMetaEl.textContent = `${r.name}  •  ${stateLabel}  •  ${state.currentIndex + 1}/${state.records.length}`;
	setStatus(`${state.records.length} images loaded`);
	applyViewerZoom();
	
	// Preload next and previous images in background
	preloadAdjacentImages();
}

// Preload next and previous images for smooth navigation
function preloadAdjacentImages() {
	if (state.records.length <= 1) return;
	
	const nextIndex = (state.currentIndex + 1) % state.records.length;
	const prevIndex = (state.currentIndex - 1 + state.records.length) % state.records.length;
	
	// Preload in background without blocking UI
	setTimeout(() => {
		ensureFullImage(nextIndex).catch(() => {}); // Silent fail
	}, 100);
	
	setTimeout(() => {
		ensureFullImage(prevIndex).catch(() => {}); // Silent fail
	}, 200);
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

async function prevImage() {
	if (!state.records.length) return;
	state.currentIndex = (state.currentIndex - 1 + state.records.length) % state.records.length;
	if (isGalleryVisible()) updateGridSelection(); else await renderViewer();
}

async function nextImage() {
	if (!state.records.length) return;
	state.currentIndex = (state.currentIndex + 1) % state.records.length;
	if (isGalleryVisible()) updateGridSelection(); else await renderViewer();
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
	const delay = appSettings.autoSaveInterval || 400;
	if (delay === 0) return; // Manual save only
	csvSyncTimer = setTimeout(async () => {
		await window.api.updateCsv(state.folderPath, state.records);
		setStatus('Changes saved');
		showToast('Changes saved', 'success', 2000);
	}, delay);
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

// Gallery grid size control
function applyGridSize(px) {
    const size = Math.max(120, Math.min(400, Math.round(px)));
    document.documentElement.style.setProperty('--thumb-size', size + 'px');
}
if (gridSlider) {
    applyGridSize(Number(gridSlider.value));
    gridSlider.addEventListener('input', () => {
        applyGridSize(Number(gridSlider.value));
    });
}

// Ctrl+wheel in gallery adjusts grid size
galleryEl.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const current = Number(getComputedStyle(document.documentElement).getPropertyValue('--thumb-size').replace('px','')) || 200;
    const step = 10;
    const next = current + (e.deltaY < 0 ? step : -step);
    applyGridSize(next);
    if (gridSlider) gridSlider.value = String(Math.max(120, Math.min(400, next)));
}, { passive: false });

const openBtn = document.getElementById('openBtn');
const saveBtn = document.getElementById('saveBtn');
const galleryBtn = document.getElementById('galleryBtn');
const viewerBtn = document.getElementById('viewerBtn');
const projectsBtn = document.getElementById('projectsBtn');
const projectGridEl = document.getElementById('projectGrid');
const addProjectBtn = document.getElementById('addProjectBtn');
const newProjectNameEl = document.getElementById('newProjectName');

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
		if (!res || res.error) { 
			setStatus(res && res.error ? `Error: ${res.error}` : 'Selection failed'); 
			showToast(res && res.error ? res.error : 'Selection failed', 'error');
			return; 
		}
		folderPath = res.folderPath;
		if (!folderPath) { 
			setStatus('Selection canceled'); 
			return; 
		}
		const images = res.images || [];
		const skipped = res.skipped || 0;
		state.folderPath = folderPath;
		const scoreMap = await loadCsvScores(folderPath);
		state.records = images.map(img => ({ ...img, score: (scoreMap[img.path] ?? -1) }));
		state.currentIndex = 0;
        state.anchorIndex = 0;
		renderGrid();
		setStatus(`Ready • ${state.records.length} images`);
		showGallery();
		showToast(`Loaded ${state.records.length} images${skipped ? ` (${skipped} skipped)` : ''}`, 'success');
	} catch (e) {
		const errorMsg = `Error: ${e && e.message ? e.message : 'Failed to open folder'}`;
		setStatus(errorMsg);
		showToast(errorMsg, 'error');
	} finally {
		setLoading(false);
		readyStatus();
	}
}

// Home: DB rendering
async function renderHome() {
    const db = await window.api.dbLoad();
    projectGridEl.innerHTML = '';
    
    if (!db.projects || db.projects.length === 0) {
        // Empty state
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <h3>No projects yet</h3>
            <p>Create your first project to organize your photo collections</p>
        `;
        projectGridEl.appendChild(emptyState);
        return;
    }
    
    for (const p of db.projects) {
        const card = document.createElement('div');
        card.className = 'project-card';
        
        // Calculate stats
        const folderCount = (p.folders || []).length;
        const projectInitial = (p.name || 'P')[0].toUpperCase();
        
        card.innerHTML = `
            <div class="project-header">
                <div class="project-icon">${projectInitial}</div>
                <div class="project-title">
                    <input class="project-name-input" type="text" value="${p.name || ''}" data-project-id="${p.id}">
                </div>
            </div>
            
            <div class="project-stats">
                <div class="stat-item">
                    <span class="stat-value">${folderCount}</span>
                    <span class="stat-label">Folders</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">0</span>
                    <span class="stat-label">Images</span>
                </div>
            </div>
            
            <div class="project-folders">
                <h4>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                    Folders
                </h4>
                <div class="folder-list"></div>
            </div>
            
            <div class="project-actions">
                <button class="add-folder-btn primary" data-project-id="${p.id}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 5v14M5 12h14"/>
                    </svg>
                    Add Folder
                </button>
                <button class="open-all-btn" data-project-id="${p.id}" ${folderCount === 0 ? 'disabled' : ''}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                    </svg>
                    Open All
                </button>
            </div>
        `;
        
        // Populate folder list
        const folderList = card.querySelector('.folder-list');
        for (const fp of (p.folders || [])) {
            const folderItem = document.createElement('div');
            folderItem.className = 'folder-item';
            folderItem.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <span class="folder-path" title="${fp}">${fp}</span>
                <div class="folder-actions">
                    <button class="open-folder-btn ghost" data-folder-path="${fp}">Open</button>
                    <button class="reveal-folder-btn ghost" data-folder-path="${fp}">Show</button>
                </div>
            `;
            folderList.appendChild(folderItem);
        }
        
        projectGridEl.appendChild(card);
    }
    
    // Add event listeners
    projectGridEl.addEventListener('change', async (e) => {
        if (e.target.classList.contains('project-name-input')) {
            const projectId = e.target.dataset.projectId;
            const newName = e.target.value.trim();
            if (newName) {
                await window.api.dbRenameProject(projectId, newName);
                showToast('Project renamed', 'success', 1500);
            }
        }
    });
    
    projectGridEl.addEventListener('click', async (e) => {
        if (e.target.classList.contains('add-folder-btn') || e.target.closest('.add-folder-btn')) {
            e.preventDefault();
            e.stopPropagation();
            const btn = e.target.classList.contains('add-folder-btn') ? e.target : e.target.closest('.add-folder-btn');
            const projectId = btn.dataset.projectId;
            
            // Disable button during selection
            btn.disabled = true;
            try {
                const res = await window.api.selectFolder();
                if (res && res.folderPath) {
                    await window.api.dbAddFolderToProject(projectId, res.folderPath);
                    await renderHome();
                    showToast('Folder added to project', 'success', 2000);
                }
            } finally {
                btn.disabled = false;
            }
        } else if (e.target.classList.contains('open-all-btn') || e.target.closest('.open-all-btn')) {
            e.preventDefault();
            e.stopPropagation();
            const btn = e.target.classList.contains('open-all-btn') ? e.target : e.target.closest('.open-all-btn');
            const projectId = btn.dataset.projectId;
            const project = db.projects.find(p => p.id === projectId);
            if (!project || !project.folders.length) return;
            
            btn.disabled = true;
            try {
                const res = await window.api.openFolders(project.folders);
                if (!res || !res.result) { showToast('Failed to open folders', 'error'); return; }
                
                const merged = [];
                for (const r of res.result) {
                    if (!r || !r.folderPath) continue;
                    const scoreMap = await loadCsvScores(r.folderPath);
                    for (const img of (r.images || [])) {
                        merged.push({ ...img, score: (scoreMap[img.path] ?? scoreMap[img.relPath] ?? scoreMap[img.name] ?? -1) });
                    }
                }
                
                if (!merged.length) { showToast('No images found', 'info'); return; }
                state.folderPath = project.folders[0];
                state.records = merged;
                state.currentIndex = 0;
                renderGrid(); showGallery(); readyStatus();
                showToast(`Loaded ${merged.length} images from ${project.folders.length} folders`, 'success');
            } finally {
                btn.disabled = false;
            }
        } else if (e.target.classList.contains('open-folder-btn')) {
            e.preventDefault();
            e.stopPropagation();
            const folderPath = e.target.dataset.folderPath;
            const res = await window.api.openFolders([folderPath]);
            if (res && res.result && res.result[0]) {
                const r = res.result[0];
                const scoreMap = await loadCsvScores(folderPath);
                state.folderPath = folderPath;
                state.records = (r.images || []).map(img => ({ ...img, score: (scoreMap[img.path] ?? scoreMap[img.relPath] ?? scoreMap[img.name] ?? -1) }));
                state.currentIndex = 0;
                renderGrid(); showGallery(); readyStatus();
                showToast(`Loaded ${state.records.length} images`, 'success');
            }
        } else if (e.target.classList.contains('reveal-folder-btn')) {
            e.preventDefault();
            e.stopPropagation();
            const folderPath = e.target.dataset.folderPath;
            window.api.revealInFinder(folderPath);
        }
    });
}

async function saveCsv() {
	if (!state.folderPath || isLoading) { 
		setStatus('No folder open'); 
		showToast('No folder open', 'error');
		return; 
	}
	try {
	await window.api.updateCsv(state.folderPath, state.records);
	setStatus('CSV saved');
		showToast('CSV saved successfully', 'success');
	setTimeout(readyStatus, 800);
	} catch (e) {
		const errorMsg = `Failed to save CSV: ${e.message}`;
		setStatus(errorMsg);
		showToast(errorMsg, 'error');
	}
}

// Check if user is currently typing in an input field
function isTypingInInput() {
	const activeElement = document.activeElement;
	if (!activeElement) return false;
	
	const tagName = activeElement.tagName.toLowerCase();
	const inputTypes = ['input', 'textarea', 'select'];
	const editableContent = activeElement.contentEditable === 'true';
	
	return inputTypes.includes(tagName) || editableContent;
}

// Check if we're in a view where photo shortcuts should work
function isInPhotoView() {
	// Only allow photo shortcuts in Gallery or Viewer modes
	return !galleryEl.classList.contains('hidden') || !viewerEl.classList.contains('hidden');
}

// Keyboard
window.addEventListener('keydown', (e) => {
	// Handle modal keyboard events first
	if (!keyboardHelpEl.classList.contains('hidden')) {
		if (e.key === 'Escape') { hideKeyboardHelp(); return; }
		return;
	}
	
	// Always allow global shortcuts with modifier keys, even in input fields
	if ((e.ctrlKey || e.metaKey) && e.key === 'o') { e.preventDefault(); openFolder(); return; }
	if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveCsv(); return; }
	
	// Don't trigger shortcuts when user is typing in input fields
	if (isTypingInInput()) {
		// Only allow Escape to work in input fields (to blur/cancel)
		if (e.key === 'Escape') { 
			document.activeElement.blur(); 
			showGallery(); 
			return; 
		}
		return; // Let the input field handle all other keys
	}
	
	// Help shortcut (only when not typing)
	if (e.key === '?' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); showKeyboardHelp(); return; }
	
	// Fullscreen toggle
	if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); return; }
	
	// Global navigation shortcuts (work from any view)
	if (e.key === 'Escape') { 
		if (isFullscreen) { 
			toggleFullscreen(); 
		} else { 
			showGallery(); 
		} 
		return; 
	}
	if (e.key.toLowerCase() === 'g' && !e.ctrlKey && !e.metaKey) { showGallery(); return; }
	if (e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.metaKey) { if (state.records.length) { renderViewer(); showViewer(); } return; }
	if (e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey) { showHome(); renderHome(); return; }
	
	// Photo-specific shortcuts (only work in Gallery/Viewer)
	if (!isInPhotoView()) return; // Stop here if not in photo view
	
	// Image navigation and scoring (only in photo views)
	if (e.key === 'ArrowLeft') { prevImage(); }
	else if (e.key === 'ArrowRight') { nextImage(); }
    else if (e.key === ' ') { e.preventDefault(); const r = state.records[state.currentIndex]; applyScoreToSelection(r.score === -1 || r.score === 0 ? 5 : -1); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); applyScoreToSelection(0); showToast('Image rejected', 'info', 1500); }
    else if (e.key >= '1' && e.key <= '5') { e.preventDefault(); const score = parseInt(e.key, 10); applyScoreToSelection(score); showToast(`Score set to ${score}`, 'success', 1500); }
    else if (e.key === 'Enter') { if (isGalleryVisible() && state.records.length) { renderViewer().then(() => showViewer()); } }
    else if (e.key.toLowerCase() === 'z') { // zoom in
        if (viewerZoomMode === 'fit') viewerZoomMode = 100;
        e.preventDefault();
        viewerZoomMode = Math.min(800, Number(viewerZoomMode) + 10);
        zoomSelect.value = String(viewerZoomMode);
        applyViewerZoom();
    } else if (e.key.toLowerCase() === 'x') { // zoom out
        if (viewerZoomMode === 'fit') viewerZoomMode = 100;
        e.preventDefault();
        viewerZoomMode = Math.max(10, Number(viewerZoomMode) - 10);
        if (viewerZoomMode === 100) zoomSelect.value = '100';
        applyViewerZoom();
    }
});

// Modal event listeners
closeKeyboardHelpBtn.addEventListener('click', hideKeyboardHelp);
keyboardHelpEl.addEventListener('click', (e) => {
	if (e.target === keyboardHelpEl) hideKeyboardHelp();
});

// Settings modal event listeners
settingsBtn.addEventListener('click', showSettings);
closeSettingsBtn.addEventListener('click', hideSettings);
settingsModal.addEventListener('click', (e) => {
	if (e.target === settingsModal) hideSettings();
});

showKeyboardHelpBtn.addEventListener('click', () => {
	hideSettings();
	showKeyboardHelp();
});

// Settings controls
defaultThumbSize.addEventListener('input', () => {
	thumbSizeLabel.textContent = defaultThumbSize.value + 'px';
});

clearThumbsBtn.addEventListener('click', async () => {
	if (state.folderPath) { 
		await window.api.clearThumbCache(state.folderPath); 
		setStatus('Thumbnail cache cleared'); 
		showToast('Thumbnail cache cleared', 'info', 2000);
	}
});

// Buttons
openBtn.addEventListener('click', openFolder);
saveBtn.addEventListener('click', saveCsv);
galleryBtn.addEventListener('click', showGallery);
viewerBtn.addEventListener('click', async () => { if (state.records.length) { await renderViewer(); showViewer(); }});
projectsBtn && projectsBtn.addEventListener('click', () => { showHome(); renderHome(); });
addProjectBtn && addProjectBtn.addEventListener('click', async () => {
    const name = (newProjectNameEl && newProjectNameEl.value || '').trim();
    if (!name) return; 
    await window.api.dbAddProject(name); 
    newProjectNameEl.value = ''; 
    await renderHome();
    showToast(`Project "${name}" created`, 'success', 2000);
});

readyStatus();
// Load settings on startup
loadSettings();
// Initial home view
document.body.classList.add('mode-gallery');
showHome();
renderHome();

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
