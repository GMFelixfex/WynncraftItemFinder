const API_BASE = 'https://api.wynncraft.com/v3/item/search/';
const MAP_URL = 'map/main-map.png';
const MAP_W = 4034;
const MAP_H = 6414;
const OFFSET_X = 2383; // 2865px corresponds to x=482 → 2865-482=2383
const OFFSET_Y = 6572; // 4926px corresponds to z=-1646 → 4926-(-1646)=6572
const MIN_SCALE = 0.2;
const MAX_SCALE = 10;
const ZOOM_STEP = 1.2;
const COLOR_UPDATE_DELAY_MS = 200; // Debounce delay for color-driven redraws
let colorUpdateTimer = null; // timer handle for debounced color updates

const el = {
    searchInput: document.getElementById('searchInput'),
    searchButton: document.getElementById('searchButton'),
    resultsSelect: document.getElementById('resultsSelect'),
    loadResultBtn: document.getElementById('loadResultBtn'),
    iconSelect: document.getElementById('iconSelect'),
    colorInput: document.getElementById('colorInput'),
    colorPreview: document.getElementById('colorPreview'),
    corsToggle: document.getElementById('corsToggle'),
    status: document.getElementById('status'),
    jsonInput: document.getElementById('jsonInput'),
    formatJson: document.getElementById('formatJson'),
    clearJson: document.getElementById('clearJson'),
    jsonStats: document.getElementById('jsonStats'),
    convertButton: document.getElementById('convertButton'),
    outputArea: document.getElementById('outputArea'),
    copyButton: document.getElementById('copyButton'),
    // Map
    mapViewport: document.querySelector('.map-viewport'),
    mapCanvas: document.getElementById('mapCanvas'),
    renderMapBtn: document.getElementById('renderMapBtn'),
    mapStats: document.getElementById('mapStats'),
    showRadiusToggle: document.getElementById('showRadiusToggle'),
    showLabelsToggle: document.getElementById('showLabelsToggle'),
    zoomInBtn: document.getElementById('zoomInBtn'),
    zoomOutBtn: document.getElementById('zoomOutBtn'),
    resetViewBtn: document.getElementById('resetViewBtn'),
    fitBtn: document.getElementById('fitBtn'),
    gotoSelect: document.getElementById('gotoSelect'),
    gotoBtn: document.getElementById('gotoBtn'),
};

const mapState = {
    image: null,
    lastWaypoints: [],
    view: { scale: 1, panX: 0, panY: 0 },
};

const appState = {
    searchResults: [], // array of { name, obj }
};

// Default proxy behavior: enable for file:// origin, disable otherwise
/*try {
    const isFile = location && location.protocol === 'file:';
    el.corsToggle.checked = !!isFile;
} catch {}*/
el.corsToggle.checked = true;

function setStatus(msg, isError = false) {
    el.status.textContent = msg || '';
    el.status.style.color = isError ? getComputedStyle(document.documentElement).getPropertyValue('--danger') : 'var(--muted)';
}

function updateJsonStats() {
    const text = el.jsonInput.value.trim();
    if (!text) { el.jsonStats.textContent = ''; return; }
    el.jsonStats.textContent = `${new Blob([text]).size} bytes`;
}

function getSelectedColorWithAlpha() {
    // HTML color input returns #RRGGBB; Wynntills expects 8-digit hex.
    // We append 'ff' for full opacity to produce #RRGGBBff.
    const rgb = (el.colorInput && el.colorInput.value) ? el.colorInput.value.toLowerCase() : '#ffffff';
    const withAlpha = rgb.length === 7 ? (rgb + 'ff') : rgb;
    return withAlpha;
}

function updateColorPreview() {
    const c = getSelectedColorWithAlpha();
    if (el.colorPreview) el.colorPreview.textContent = c;
}

// When the color selector changes, apply it to currently rendered
// waypoints (if any) and redraw the map.
function applySelectedColorToMap() {
    const newColor = getSelectedColorWithAlpha().toLowerCase();
    const wp = mapState.lastWaypoints || [];
    if (!wp.length) return;
    for (const w of wp) {
        if (w) w.color = newColor;
    }
    if (mapState.image) {
        drawMap();
    }
}

async function fetchItemByName(name) {
    const q = (name || '').trim();
    if (!q) {
        setStatus('Please enter an item name.', true);
        return;
    }
    setStatus('Searching…');
    try {
        const url = API_BASE + encodeURIComponent(q);
        // Conditionally use public CORS proxy to bypass browser CORS
        const useProxy = !!el.corsToggle.checked;
        const finalUrl = useProxy ? ('https://cors.io/?u=' + encodeURIComponent(url)) : url;
        const res = await fetch(finalUrl, { method: 'GET', cache: 'no-cache', mode: 'cors' });
        if (!res.ok) {
            throw new Error(`API error: ${res.status} ${res.statusText}`);
        }
        let data;
        if (useProxy) {
            // cors.io wraps the response: { url, status, headers, body: "<json string>" }
            const wrapper = await res.json();
            if (wrapper && typeof wrapper.body === 'string') {
                try { data = JSON.parse(wrapper.body); }
                catch (e) { throw new Error('Proxy body parse failed: ' + String(e)); }
            } else {
                data = wrapper;
            }
        } else {
            data = await res.json();
        }
        // Enumerate results and handle multi-select
        const results = enumerateSearchResults(data);
        appState.searchResults = results;
        populateResultsDropdown(results);
        if (results.length === 0) {
            setStatus('No items found.', true);
            return;
        }
        if (results.length === 1) {
            // Single result, proceed as before
            const itemObj = results[0].obj;
            el.jsonInput.value = JSON.stringify(itemObj, null, 2);
            updateJsonStats();
            const icon = el.iconSelect.value;
            const color = getSelectedColorWithAlpha();
            const waypoints = convertToWynntills(itemObj, icon, color);
            el.outputArea.value = JSON.stringify(waypoints, null, 2);
            setStatus(`1 item found: ${results[0].name}. Converted ${waypoints.length} waypoint(s).`);
            if (mapState && mapState.image) {
                const vwp = buildVisualizationWaypoints(itemObj, color);
                await renderMapWithWaypoints(vwp);
            }
        } else {
            // Multiple results, ask user to select
            setStatus(`Found ${results.length} items. Select one and click "Load Selected".`);
        }
    } catch (err) {
        console.error(err);
        setStatus(err.message || 'Request failed.', true);
    }
}

function safeParseJson(text) {
    const raw = (text || '').trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return { __parseError: String(e) }; }
}

function extractItemData(itemJson) {
    // The API usually returns an object keyed by item name: { "Item Name": { ... } }
    // Accept either that structure or a direct object with fields.
    let itemObj = null;
    let itemName = 'Unknown Item';
    if (itemJson && typeof itemJson === 'object' && !Array.isArray(itemJson)) {
        if ('droppedBy' in itemJson || 'dropMeta' in itemJson) {
            itemObj = itemJson;
        } else {
            const entries = Object.entries(itemJson);
            if (entries.length > 0 && typeof entries[0][1] === 'object') {
                itemObj = entries[0][1];
                itemName = String(entries[0][0] || itemName);
            }
        }
    }
    if (!itemObj) return { itemName, droppedBy: [], dropMeta: null };
    // Prefer explicit internalName if present, else keep the key-derived name
    if (typeof itemObj.internalName === 'string' && itemObj.internalName.trim()) {
        itemName = itemObj.internalName.trim();
    }
    const droppedBy = Array.isArray(itemObj.droppedBy) ? itemObj.droppedBy : [];
    const dropMeta = (itemObj && typeof itemObj.dropMeta === 'object') ? itemObj.dropMeta : null;
    return { itemName, droppedBy, dropMeta };
}

function enumerateSearchResults(data) {
    const results = [];
    if (Array.isArray(data)) {
        for (const item of data) {
            if (item && typeof item === 'object') {
                const n = (item.internalName || item.name || 'Unknown').toString();
                results.push({ name: n, obj: item });
            }
        }
        return results;
    }
    if (data && typeof data === 'object') {
        // Single object with item fields
        if ('droppedBy' in data || 'dropMeta' in data) {
            const n = (data.internalName || data.name || 'Unknown').toString();
            results.push({ name: n, obj: data });
            return results;
        }
        // Object keyed by item names
        for (const [k, v] of Object.entries(data)) {
            if (v && typeof v === 'object') {
                const n = (v.internalName || k || 'Unknown').toString();
                results.push({ name: n, obj: v });
            }
        }
    }
    return results;
}

function populateResultsDropdown(results) {
    if (!el.resultsSelect) return;
    el.resultsSelect.innerHTML = '';
    results.forEach((r, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = r.name;
        el.resultsSelect.appendChild(opt);
    });
}

function convertToWynntills(itemJson, icon, color) {
    const { itemName, droppedBy, dropMeta } = extractItemData(itemJson);
    const waypoints = [];
    // 1) droppedBy format: coords as [x, y, z, radius];
    for (const entry of droppedBy) {
        const srcName = (entry && entry.name) ? String(entry.name) : 'Unknown';
        const coords = Array.isArray(entry.coords) ? entry.coords : [];
        let idx = 0;
        for (const c of coords) {
            if (!Array.isArray(c) || c.length < 3) continue;
            const [x, y, z, radius] = c;
            idx += 1;
            waypoints.push({
                name: `${srcName} - ${radius}m - ${itemName} - ${idx}`,
                color: (color || '#ffffffff').toLowerCase(),
                icon: icon || 'flag',
                visibility: 'default',
                location: { x, y, z },
            });
        }
    }
    // 2) dropMeta format: single coordinates as [x, y, z]; ignore when type === 'guild'
    if (dropMeta && dropMeta.type !== 'guild') {
        const metaName = typeof dropMeta.name === 'string' && dropMeta.name.trim() ? dropMeta.name.trim() : 'Unknown Source';
        const metaCoords = Array.isArray(dropMeta.coordinates) ? dropMeta.coordinates : [];
        if (metaCoords.length >= 3) {
            const [mx, my, mz] = metaCoords;
            waypoints.push({
                name: `${metaName} - ${itemName}`,
                color: (color || '#ffffffff').toLowerCase(),
                icon: icon || 'flag',
                visibility: 'default',
                location: { x: mx, y: my, z: mz },
            });
        }
    }
    return waypoints;
}

// Build waypoints for map visualization directly from original item JSON,
// including radius from droppedBy[*].coords[3] when available.
function buildVisualizationWaypoints(itemJson, color) {
    const { itemName, droppedBy, dropMeta } = extractItemData(itemJson);
    const vwp = [];
    // droppedBy entries (with optional radius)
    for (const entry of droppedBy) {
        const srcName = (entry && entry.name) ? String(entry.name) : 'Unknown';
        const coords = Array.isArray(entry.coords) ? entry.coords : [];
        let idx = 0;
        for (const c of coords) {
            if (!Array.isArray(c) || c.length < 3) continue;
            const [x, y, z] = c;
            const radius = (c.length >= 4 && Number.isFinite(Number(c[3]))) ? Number(c[3]) : undefined;
            idx += 1;
            vwp.push({
                name: `${srcName} - ${itemName} - ${idx}`,
                color: (color || '#ffffffff').toLowerCase(),
                visibility: 'default',
                location: { x, y, z },
                ...(radius !== undefined ? { radius } : {}),
            });
        }
    }
    // dropMeta entry (no radius), exclude guild type
    if (dropMeta && dropMeta.type !== 'guild') {
        const metaName = typeof dropMeta.name === 'string' && dropMeta.name.trim() ? dropMeta.name.trim() : 'Unknown Source';
        const metaCoords = Array.isArray(dropMeta.coordinates) ? dropMeta.coordinates : [];
        if (metaCoords.length >= 3) {
            const [mx, my, mz] = metaCoords;
            vwp.push({
                name: `${metaName} - ${itemName}`,
                color: (color || '#ffffffff').toLowerCase(),
                visibility: 'default',
                location: { x: mx, y: my, z: mz },
            });
        }
    }
    return vwp;
}

function hex8ToRgba(hex8) {
    const m = /^#?([0-9a-f]{8})$/i.exec(String(hex8 || ''));
    if (!m) return 'rgba(255,255,255,1)';
    const h = m[1];
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = parseInt(h.slice(6, 8), 16) / 255;
    return `rgba(${r},${g},${b},${a})`;
}

function loadMapImage() {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(e);
        img.src = MAP_URL; // Load local map image
    });
}

function screenToWorld(sx, sy) {
    const { scale, panX, panY } = mapState.view;
    return { x: (sx - panX) / scale, y: (sy - panY) / scale };
}

function setScaleAtPoint(factor, sx, sy) {
    const old = mapState.view.scale;
    let next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, old * factor));
    const { x: wx, y: wy } = screenToWorld(sx, sy);
    mapState.view.scale = next;
    mapState.view.panX = sx - wx * next;
    mapState.view.panY = sy - wy * next;
}

function drawMap() {
    if (!el.mapCanvas || !mapState.image) return;
    const ctx = el.mapCanvas.getContext('2d');
    // Clear with identity
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.mapCanvas.width, el.mapCanvas.height);
    // Apply view transform
    const { scale, panX, panY } = mapState.view;
    ctx.setTransform(scale, 0, 0, scale, panX, panY);
    // Draw map image
    ctx.drawImage(mapState.image, 0, 0, MAP_W, MAP_H);
    const showRadius = !!(el.showRadiusToggle && el.showRadiusToggle.checked);
    const showLabels = !!(el.showLabelsToggle && el.showLabelsToggle.checked);
    for (const w of (mapState.lastWaypoints || [])) {
        if (!w || !w.location) continue;
        const px = Math.round(Number(w.location.x) + OFFSET_X);
        const py = Math.round(Number(w.location.z) + OFFSET_Y);
        const color = hex8ToRgba(w.color || '#ffffffff');
        // Radius
        const r = Number(w.radius);
        if (showRadius && Number.isFinite(r) && r > 0) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2 / Math.max(1, (1 / scale));
            ctx.beginPath();
            ctx.arc(px, py, r, 0, Math.PI * 2);
            ctx.stroke();
        }
        // Pin
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
        // Label
        if (showLabels && w.name) {
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(0,0,0,0.6)';
            ctx.fillStyle = '#ffffff';
            ctx.font = '12px Segoe UI, Arial, sans-serif';
            const tx = px + 8;
            const ty = py - 8;
            ctx.strokeText(String(w.name), tx, ty);
            ctx.fillText(String(w.name), tx, ty);
        }
    }
    if (el.mapStats) el.mapStats.textContent = `${(mapState.lastWaypoints || []).length} waypoint(s) • zoom ${scale.toFixed(2)}`;
}

function updateGotoList() {
    if (!el.gotoSelect) return;
    const wp = mapState.lastWaypoints || [];
    el.gotoSelect.innerHTML = '';
    wp.forEach((w, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        const name = (w && w.name) ? String(w.name) : `Waypoint ${i+1}`;
        opt.textContent = name;
        el.gotoSelect.appendChild(opt);
    });
}

function centerOnWaypointIndex(idx, desiredScale = 6) {
    const i = Number(idx);
    if (!Number.isInteger(i) || i < 0) return;
    const w = (mapState.lastWaypoints || [])[i];
    if (!w || !w.location) return;
    const px = Math.round(Number(w.location.x) + OFFSET_X);
    const py = Math.round(Number(w.location.z) + OFFSET_Y);
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, desiredScale));
    mapState.view.scale = scale;

    // Determine the center of the visible viewport in canvas pixel space
    const canvasRect = el.mapCanvas.getBoundingClientRect();
    const scaleX = el.mapCanvas.width / canvasRect.width;
    const scaleY = el.mapCanvas.height / canvasRect.height;

    let sx = el.mapCanvas.width / 2;
    let sy = el.mapCanvas.height / 2;
    if (el.mapViewport) {
        const vpRect = el.mapViewport.getBoundingClientRect();
        const cx = vpRect.left + vpRect.width / 2;
        const cy = vpRect.top + vpRect.height / 2;
        // Convert viewport center (CSS px) to canvas internal px
        sx = (cx - canvasRect.left) * scaleX;
        sy = (cy - canvasRect.top) * scaleY;
    }

    mapState.view.panX = sx - px * scale;
    mapState.view.panY = sy - py * scale;
    drawMap();
}

function fitToWaypoints() {
    const wp = mapState.lastWaypoints || [];
    if (!wp.length) {
        setStatus('No waypoints to fit.', true);
        return;
    }
    // Compute bounds in map pixel space
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const w of wp) {
        if (!w || !w.location) continue;
        const px = Math.round(Number(w.location.x) + OFFSET_X);
        const py = Math.round(Number(w.location.z) + OFFSET_Y);
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
    }
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
        setStatus('Waypoints invalid for fit.', true);
        return;
    }
    // Padding in internal canvas pixels
    const PAD = 40;
    const bboxW = Math.max(1, (maxX - minX) + PAD);
    const bboxH = Math.max(1, (maxY - minY) + PAD);

    // Viewport size converted to internal canvas pixels
    const canvasRect = el.mapCanvas.getBoundingClientRect();
    const scaleX = el.mapCanvas.width / canvasRect.width;
    const scaleY = el.mapCanvas.height / canvasRect.height;
    let vpW = canvasRect.width * scaleX;
    let vpH = canvasRect.height * scaleY;
    if (el.mapViewport) {
        const vpRect = el.mapViewport.getBoundingClientRect();
        vpW = vpRect.width * scaleX;
        vpH = vpRect.height * scaleY;
    }

    // Choose scale to fit within viewport
    const fitScaleX = vpW / bboxW;
    const fitScaleY = vpH / bboxH;
    const desiredScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(fitScaleX, fitScaleY)));
    mapState.view.scale = desiredScale;

    // Center bbox under viewport center
    let sx = el.mapCanvas.width / 2;
    let sy = el.mapCanvas.height / 2;
    if (el.mapViewport) {
        const vpRect = el.mapViewport.getBoundingClientRect();
        const cx = vpRect.left + vpRect.width / 2;
        const cy = vpRect.top + vpRect.height / 2;
        sx = (cx - canvasRect.left) * scaleX;
        sy = (cy - canvasRect.top) * scaleY;
    }
    const cxWorld = (minX + maxX) / 2;
    const cyWorld = (minY + maxY) / 2;
    mapState.view.panX = sx - cxWorld * mapState.view.scale;
    mapState.view.panY = sy - cyWorld * mapState.view.scale;
    drawMap();
    setStatus('Fitted to waypoints.');
}

async function renderMapWithWaypoints(waypoints) {
    try {
        if (!el.mapCanvas) { setStatus('Map canvas not found.', true); return; }
        el.mapCanvas.width = MAP_W;
        el.mapCanvas.height = MAP_H;
        if (!mapState.image) {
            mapState.image = await loadMapImage();
        }
        mapState.lastWaypoints = waypoints || [];
        updateGotoList();
        // Center initial preview on map middle on first render
        /*if (!mapState._initialCentered) {
            const scale = mapState.view.scale || 1;
            const canvasRect = el.mapCanvas.getBoundingClientRect();
            const scaleX = el.mapCanvas.width / canvasRect.width;
            const scaleY = el.mapCanvas.height / canvasRect.height;
            let sx = el.mapCanvas.width / 2;
            let sy = el.mapCanvas.height / 2;
            if (el.mapViewport) {
                const vpRect = el.mapViewport.getBoundingClientRect();
                const cx = vpRect.left + vpRect.width / 2;
                const cy = vpRect.top + vpRect.height / 2;
                // Convert viewport center (CSS px) to canvas internal px
                sx = (cx - canvasRect.left) * scaleX;
                sy = (cy - canvasRect.top) * scaleY;
            }
            const px = MAP_W / 2;
            const py = MAP_H / 2;
            mapState.view.panX = sx - px * scale;
            mapState.view.panY = sy - py * scale;
            mapState._initialCentered = true;
        }
        drawMap();*/
        fitToWaypoints();
        setStatus('Map rendered.');
    } catch (e) {
        console.error(e);
        setStatus('Failed to render map: ' + String(e && e.message || e), true);
    }
}

// Events
el.searchButton.addEventListener('click', () => fetchItemByName(el.searchInput.value));
el.searchInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
        ev.preventDefault();
        fetchItemByName(el.searchInput.value);
    }
});
el.formatJson.addEventListener('click', () => {
    const parsed = safeParseJson(el.jsonInput.value);
    if (parsed && !parsed.__parseError) {
        el.jsonInput.value = JSON.stringify(parsed, null, 2);
        updateJsonStats();
        setStatus('JSON formatted.');
    } else {
        setStatus('Invalid JSON. Cannot format.', true);
    }
});
el.clearJson.addEventListener('click', () => {
    el.jsonInput.value = '';
    updateJsonStats();
    setStatus('Editor cleared.');
});
el.jsonInput.addEventListener('input', updateJsonStats);

// Initialize color preview and keep it updated
updateColorPreview();
el.colorInput.addEventListener('input', () => {
    updateColorPreview();
    if (colorUpdateTimer) clearTimeout(colorUpdateTimer);
    colorUpdateTimer = setTimeout(() => {
        applySelectedColorToMap();
        colorUpdateTimer = null;
    }, COLOR_UPDATE_DELAY_MS);
});

el.convertButton.addEventListener('click', () => {
    const parsed = safeParseJson(el.jsonInput.value);
    if (!parsed) { setStatus('No JSON to convert.', true); return; }
    if (parsed.__parseError) { setStatus('Invalid JSON: ' + parsed.__parseError, true); return; }
    const icon = el.iconSelect.value;
    const color = getSelectedColorWithAlpha();
    const waypoints = convertToWynntills(parsed, icon, color);
    el.outputArea.value = JSON.stringify(waypoints, null, 2);
    setStatus(`Converted ${waypoints.length} waypoint(s).`);
});

el.copyButton.addEventListener('click', async () => {
    const text = el.outputArea.value;
    if (!text) { setStatus('Nothing to copy.', true); return; }
    try {
        await navigator.clipboard.writeText(text);
        setStatus('Copied to clipboard.');
    } catch (e) {
        // Fallback
        el.outputArea.select();
        const ok = document.execCommand('copy');
        setStatus(ok ? 'Copied to clipboard.' : 'Copy failed.', !ok);
    }
});

// Render on Map button
el.renderMapBtn.addEventListener('click', async () => {
    try {
        const parsed = safeParseJson(el.jsonInput.value);
        if (!parsed || parsed.__parseError) { setStatus('No item JSON to visualize.', true); return; }
        const color = getSelectedColorWithAlpha();
        const vwp = buildVisualizationWaypoints(parsed, color);
        await renderMapWithWaypoints(vwp);
    } catch (e) {
        console.error(e);
        setStatus('Failed to visualize on map.', true);
    }
});

// Load Selected result
if (el.loadResultBtn) {
    el.loadResultBtn.addEventListener('click', async () => {
        const idxStr = el.resultsSelect ? el.resultsSelect.value : '';
        const idx = Number(idxStr);
        if (!Number.isInteger(idx) || idx < 0 || idx >= appState.searchResults.length) {
            setStatus('Select an item from results first.', true);
            return;
        }
        const sel = appState.searchResults[idx];
        const itemObj = sel.obj;
        el.jsonInput.value = JSON.stringify(itemObj, null, 2);
        updateJsonStats();
        const icon = el.iconSelect.value;
        const color = getSelectedColorWithAlpha();
        const waypoints = convertToWynntills(itemObj, icon, color);
        el.outputArea.value = JSON.stringify(waypoints, null, 2);
        setStatus(`Loaded: ${sel.name}. Converted ${waypoints.length} waypoint(s).`);
        if (mapState && mapState.image) {
            const vwp = buildVisualizationWaypoints(itemObj, color);
            await renderMapWithWaypoints(vwp);
        }
    });
}

// Map interactions
(function setupMapInteractions() {
    if (!el.mapCanvas) return;
    let isDragging = false;
    let startX = 0, startY = 0;
    let startPanX = 0, startPanY = 0;
    el.mapCanvas.addEventListener('wheel', (ev) => {
        if (!mapState.image) return; // no map yet
        ev.preventDefault();
        const rect = el.mapCanvas.getBoundingClientRect();
        const scaleX = el.mapCanvas.width / rect.width;
        const scaleY = el.mapCanvas.height / rect.height;
        const sx = (ev.clientX - rect.left) * scaleX;
        const sy = (ev.clientY - rect.top) * scaleY;
        const factor = ev.deltaY < 0 ? ZOOM_STEP : (1 / ZOOM_STEP);
        setScaleAtPoint(factor, sx, sy);
        drawMap();
    }, { passive: false });
    el.mapCanvas.addEventListener('mousedown', (ev) => {
        if (!mapState.image) return;
        isDragging = true;
        startX = ev.clientX;
        startY = ev.clientY;
        startPanX = mapState.view.panX;
        startPanY = mapState.view.panY;
    });
    window.addEventListener('mousemove', (ev) => {
        if (!isDragging) return;
        const rect = el.mapCanvas.getBoundingClientRect();
        const scaleX = el.mapCanvas.width / rect.width;
        const scaleY = el.mapCanvas.height / rect.height;
        mapState.view.panX = startPanX + (ev.clientX - startX) * scaleX;
        mapState.view.panY = startPanY + (ev.clientY - startY) * scaleY;
        drawMap();
    });
    window.addEventListener('mouseup', () => { isDragging = false; });
    el.zoomInBtn.addEventListener('click', () => {
        const canvasRect = el.mapCanvas.getBoundingClientRect();
        const scaleX = el.mapCanvas.width / canvasRect.width;
        const scaleY = el.mapCanvas.height / canvasRect.height;
        let sx = el.mapCanvas.width / 2;
        let sy = el.mapCanvas.height / 2;
        if (el.mapViewport) {
            const vpRect = el.mapViewport.getBoundingClientRect();
            const cx = vpRect.left + vpRect.width / 2;
            const cy = vpRect.top + vpRect.height / 2;
            sx = (cx - canvasRect.left) * scaleX;
            sy = (cy - canvasRect.top) * scaleY;
        }
        setScaleAtPoint(ZOOM_STEP, sx, sy);
        drawMap();
    });
    el.zoomOutBtn.addEventListener('click', () => {
        const canvasRect = el.mapCanvas.getBoundingClientRect();
        const scaleX = el.mapCanvas.width / canvasRect.width;
        const scaleY = el.mapCanvas.height / canvasRect.height;
        let sx = el.mapCanvas.width / 2;
        let sy = el.mapCanvas.height / 2;
        if (el.mapViewport) {
            const vpRect = el.mapViewport.getBoundingClientRect();
            const cx = vpRect.left + vpRect.width / 2;
            const cy = vpRect.top + vpRect.height / 2;
            sx = (cx - canvasRect.left) * scaleX;
            sy = (cy - canvasRect.top) * scaleY;
        }
        setScaleAtPoint(1 / ZOOM_STEP, sx, sy);
        drawMap();
    });
    el.resetViewBtn.addEventListener('click', () => {
        mapState.view.scale = 1;
        const canvasRect = el.mapCanvas.getBoundingClientRect();
        const scaleX = el.mapCanvas.width / canvasRect.width;
        const scaleY = el.mapCanvas.height / canvasRect.height;
        let sx = el.mapCanvas.width / 2;
        let sy = el.mapCanvas.height / 2;
        if (el.mapViewport) {
            const vpRect = el.mapViewport.getBoundingClientRect();
            const cx = vpRect.left + vpRect.width / 2;
            const cy = vpRect.top + vpRect.height / 2;
            sx = (cx - canvasRect.left) * scaleX;
            sy = (cy - canvasRect.top) * scaleY;
        }
        const px = MAP_W / 2;
        const py = MAP_H / 2;
        mapState.view.panX = sx - px * mapState.view.scale;
        mapState.view.panY = sy - py * mapState.view.scale;
        drawMap();
    });
    el.showRadiusToggle.addEventListener('change', drawMap);
    el.showLabelsToggle.addEventListener('change', drawMap);
    if (el.fitBtn) {
        el.fitBtn.addEventListener('click', () => {
            if (!mapState.image) { setStatus('Load the map first.', true); return; }
            fitToWaypoints();
        });
    }
    el.gotoBtn.addEventListener('click', () => {
        if (!mapState.image) return;
        const idx = el.gotoSelect ? el.gotoSelect.value : '0';
        centerOnWaypointIndex(idx, 6);
    });
})();