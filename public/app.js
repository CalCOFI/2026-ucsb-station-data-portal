/* CalCOFI Station Data Portal — integrated-DB coverage view.
 *
 * Stations ARE the integrated-DB `grid` cells. Each station carries per-dataset
 * coverage (time/depth ranges, obs/sample/survey counts, year + month bins) from
 * public/data/stations.json (built by scripts/build_stations.sql). Variable search
 * (public/data/variables.json) highlights the stations where that variable's
 * dataset has coverage. No live queries — all summaries are prebuilt. */

// ---- map (dark basemap, matching calcofi.io/db-schema palette) ----
const map = L.map('map', { center: [32.8, -120.2], zoom: 6, worldCopyJump: true })
  .addLayer(L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap · © CARTO', subdomains: 'abcd', maxZoom: 19 }));

// dataset display metadata: label + color + realm (env = cool, bio = warm)
const DATASET_META = {
  'calcofi_bottle':             { label: 'Bottle (hydro)',    realm: 'env', color: '#4dabf7' },
  'calcofi_ctd-cast':           { label: 'CTD',               realm: 'env', color: '#3bc9db' },
  'calcofi_dic':                { label: 'DIC / carbonate',   realm: 'env', color: '#63e6be' },
  'swfsc_ichthyo':              { label: 'Ichthyoplankton',   realm: 'bio', color: '#ffa94d' },
  'swfsc_cufes':                { label: 'CUFES fish eggs',    realm: 'bio', color: '#ffd43b' },
  'pic_zooplankton':            { label: 'Zooplankton',       realm: 'bio', color: '#69db7c' },
  'cce-lter_euphausiids':       { label: 'Euphausiids',       realm: 'bio', color: '#b197fc' },
  'calcofi_phyllosoma':         { label: 'Phyllosoma',        realm: 'bio', color: '#f783ac' },
  'cce-lter_zoodb':             { label: 'ZooDB holoplankton',realm: 'bio', color: '#38d9a9' },
  'cce-lter_zooscan':           { label: 'ZooScan PRPOOS',    realm: 'bio', color: '#a9e34b' },
  'calcofi_bird_mammal_census': { label: 'Birds & Mammals',   realm: 'bio', color: '#ff8787' }
};
const dsMeta = id => DATASET_META[id] || { label: id, realm: 'bio', color: '#adb5bd' };
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

let STATIONS = [], VARS = [];
const BY_KEY = {}, MARKERS = {}, DS_STATIONS = {};   // dataset_id -> Set(grid_key)
let selectedVar = null;

// ---- load prebuilt data ----
Promise.all([
  fetch('./data/stations.json').then(r => r.json()),
  fetch('./data/variables.json').then(r => r.json())
]).then(([st, va]) => {
  STATIONS = st; VARS = va;
  STATIONS.forEach(s => {
    BY_KEY[s.grid_key] = s;
    (s.datasets || []).forEach(d => { (DS_STATIONS[d.dataset_id] ||= new Set()).add(s.grid_key); });
  });
  renderStations();
  wireSearch();
}).catch(e => console.error('load failed', e));

// ---- station markers ----
function baseStyle(s, dim = false) {
  const nd = s.n_datasets || 0, has = nd > 0;
  return {
    radius: has ? 4 + Math.sqrt(nd) * 2.3 : 3,
    weight: 1, color: has ? '#cfd8e3' : '#5a626b',
    fillColor: has ? '#4dabf7' : '#3a3f44',
    fillOpacity: dim ? 0.12 : (has ? 0.72 : 0.35),
    opacity: dim ? 0.2 : 0.9
  };
}
function renderStations() {
  STATIONS.forEach(s => {
    const m = L.circleMarker([s.lat, s.lon], baseStyle(s)).addTo(map);
    m.on('click', () => openStation(s));
    m.bindTooltip(`${s.station_id}` + (s.n_datasets ? ` · ${s.n_datasets} datasets` : ' · no data'),
      { direction: 'top', offset: [0, -2] });
    MARKERS[s.grid_key] = m;
  });
}

// ---- helpers ----
const yr = d => (d ? String(d).slice(0, 4) : '—');
const day = d => (d ? String(d).slice(0, 10) : '—');
const num = n => (n == null ? '0' : n.toLocaleString());

function yearBars(years, color) {
  if (!years || !years.length) return '<div class="bars empty">no dates</div>';
  const y0 = years[0].y, y1 = years[years.length - 1].y, m = {};
  years.forEach(o => m[o.y] = o.n);
  const max = Math.max(...years.map(o => o.n));
  let cells = '';
  for (let y = y0; y <= y1; y++) {
    const n = m[y] || 0, h = n ? (6 + 30 * n / max) : 1;
    cells += `<span class="ybar" style="height:${h}px;background:${color};opacity:${n ? 0.85 : 0.13}" title="${y}: ${num(n)}"></span>`;
  }
  return `<div class="bars"><span class="yl">${y0}</span><div class="ybars">${cells}</div><span class="yl">${y1}</span></div>`;
}
function monthBars(months, color) {
  const m = {};
  (months || []).forEach(o => m[o.m] = o.n);
  const max = Math.max(1, ...Object.values(m));
  let cells = '';
  for (let i = 1; i <= 12; i++) {
    const n = m[i] || 0, op = 0.13 + 0.87 * n / max;
    cells += `<span class="mbar" style="background:${color};opacity:${op}" title="${MONTHS[i - 1]}: ${num(n)}">${MONTHS[i - 1]}</span>`;
  }
  return `<div class="mbars">${cells}</div>`;
}
function datasetCard(d) {
  const meta = dsMeta(d.dataset_id);
  const depth = (d.depth_min != null || d.depth_max != null)
    ? `${Math.round(d.depth_min ?? 0)}–${Math.round(d.depth_max ?? 0)} m` : 'depth n/a';
  return `<div class="ds-card" style="--c:${meta.color}">
      <div class="ds-head"><span class="ds-dot"></span><span class="ds-label">${meta.label}</span>
        <span class="ds-realm ${d.realm}">${d.realm}</span></div>
      <div class="ds-stats">
        <span title="temporal extent">🗓 ${day(d.time_min)} → ${day(d.time_max)}</span>
        <span title="depth range">↧ ${depth}</span>
        <span title="surveys / observations">⚓ ${num(d.n_surveys)} surveys · ${num(d.n_obs)} obs</span>
      </div>
      <div class="bars-label">observations by year</div>${yearBars(d.years, meta.color)}
      <div class="bars-label">seasonality (by month)</div>${monthBars(d.months, meta.color)}
    </div>`;
}

// ---- station panel ----
function openStation(s) {
  document.getElementById('panel-empty').style.display = 'none';
  document.getElementById('panel-header').style.display = '';
  document.getElementById('panel-station-id').textContent = `Station ${s.station_id}`;
  document.getElementById('panel-coords').textContent =
    `${s.lat.toFixed(3)}, ${s.lon.toFixed(3)}` + (s.pattern ? ` · ${s.pattern}` : '') +
    (s.zone ? ` · ${s.zone}` : '') + ` · ${s.grid_key}`;
  const c = document.getElementById('panel-content');
  if (!s.n_datasets) {
    c.innerHTML = `<div class="cov-empty">No integrated-database observations recorded at this grid station.</div>`;
    return;
  }
  const cards = (s.datasets || []).map(datasetCard).join('');
  c.innerHTML = `<div class="cov-summary">
      <div><span class="k">datasets</span><span class="v">${s.n_datasets}</span></div>
      <div><span class="k">surveys</span><span class="v">${num(s.n_surveys)}</span></div>
      <div><span class="k">observations</span><span class="v">${num(s.n_obs)}</span></div>
      <div><span class="k">span</span><span class="v">${yr(s.time_min)}–${yr(s.time_max)}</span></div>
    </div>${cards}`;
}

// ---- variable search ----
const searchInput = document.getElementById('search');
const dropdown = document.getElementById('dropdown');

function wireSearch() {
  searchInput.addEventListener('input', () => renderDropdown(searchInput.value.trim()));
  searchInput.addEventListener('focus', () => renderDropdown(searchInput.value.trim()));
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrapper')) dropdown.classList.remove('open');
  });
}
function varMatch(v, q) {
  q = q.toLowerCase();
  return (v.name || '').toLowerCase().includes(q)
    || (v.display_name || '').toLowerCase().includes(q)
    || (v.common_name || '').toLowerCase().includes(q)
    || (v.keywords || []).some(k => String(k).toLowerCase().includes(q));
}
function renderDropdown(q) {
  if (!q) { dropdown.classList.remove('open'); return; }
  const hits = VARS.filter(v => varMatch(v, q)).slice(0, 40);
  dropdown.innerHTML = hits.length ? hits.map(v => {
    const meta = dsMeta(v.dataset_id);
    return `<div class="dd-item" data-id="${encodeURIComponent(v.variable_id)}">
        <span class="dd-dot" style="background:${meta.color}"></span>
        <span class="dd-name">${v.display_name || v.name}</span>
        <span class="dd-meta">${meta.label}${v.units ? ' · ' + v.units : ''} · ${v.realm}</span>
      </div>`;
  }).join('') : `<div class="dd-empty">no variables match “${q}”</div>`;
  dropdown.querySelectorAll('.dd-item').forEach(el =>
    el.addEventListener('mousedown', () => selectVariable(decodeURIComponent(el.dataset.id))));
  dropdown.classList.add('open');
}

function selectVariable(vid) {
  const v = VARS.find(x => x.variable_id === vid);
  if (!v) return;
  selectedVar = v;
  dropdown.classList.remove('open');
  searchInput.value = v.display_name || v.name;
  highlight(v);
  showVariablePanel(v);
}
function highlight(v) {
  const meta = dsMeta(v.dataset_id);
  const set = DS_STATIONS[v.dataset_id] || new Set();
  STATIONS.forEach(s => {
    const on = set.has(s.grid_key), mk = MARKERS[s.grid_key];
    if (on) mk.setStyle({ ...baseStyle(s), color: '#fff', weight: 1.5,
                          fillColor: meta.color, fillOpacity: 0.95, opacity: 1 });
    else mk.setStyle(baseStyle(s, true));
  });
  const banner = document.getElementById('search-banner');
  banner.innerHTML = `<b style="color:${meta.color}">${v.display_name || v.name}</b> — `
    + `${set.size} stations with <b>${meta.label}</b> coverage`;
  banner.style.display = 'block';
}
function showVariablePanel(v) {
  const meta = dsMeta(v.dataset_id);
  document.getElementById('panel-empty').style.display = 'none';
  document.getElementById('panel-header').style.display = '';
  document.getElementById('panel-station-id').textContent = v.display_name || v.name;
  document.getElementById('panel-coords').textContent =
    `${meta.label} · ${v.realm}${v.units ? ' · ' + v.units : ''}`;
  const src = v.source && (v.source.access_url || v.source.metadata_url);
  document.getElementById('panel-content').innerHTML = `
    <div class="var-panel">
      <div class="ds-card" style="--c:${meta.color}">
        <div class="ds-head"><span class="ds-dot"></span><span class="ds-label">${meta.label}</span>
          <span class="ds-realm ${v.realm}">${v.realm}</span></div>
        <div class="var-meta">
          ${v.variable_type === 'taxon' ? '<div><span class="k">type</span> taxon</div>' : ''}
          ${v.units ? `<div><span class="k">units</span> ${v.units}</div>` : ''}
          ${v.aphia_id ? `<div><span class="k">WoRMS</span> <a target="_blank" rel="noopener" href="https://www.marinespecies.org/aphia.php?p=taxdetails&id=${v.aphia_id}">AphiaID ${v.aphia_id}</a></div>` : ''}
          ${v.is_canonical ? '<div><span class="k">canonical</span> ✓ headline measurement</div>' : ''}
          ${v.description ? `<div class="var-desc">${v.description}</div>` : ''}
        </div>
        ${src ? `<a class="src-link" target="_blank" rel="noopener" href="${v.source.access_url || v.source.metadata_url}">↗ open in source portal</a>` : ''}
      </div>
      <div class="var-hint">Highlighted stations show where <b>${meta.label}</b> data is available. Click a station for its full coverage.</div>
    </div>`;
}

// ---- inline-handler globals (referenced by index.html) ----
function clearAll() {
  selectedVar = null;
  searchInput.value = '';
  dropdown.classList.remove('open');
  const banner = document.getElementById('search-banner');
  banner.style.display = 'none'; banner.innerHTML = '';
  STATIONS.forEach(s => MARKERS[s.grid_key].setStyle(baseStyle(s)));
  document.getElementById('panel-header').style.display = 'none';
  document.getElementById('panel-content').innerHTML = '';
  document.getElementById('panel-empty').style.display = '';
}
function togglePanel() { document.getElementById('side-panel').classList.toggle('collapsed'); }
function showAboutModal() { document.getElementById('about-backdrop').classList.add('open'); }
function hideAboutModal() { document.getElementById('about-backdrop').classList.remove('open'); }
function closeModal(e) {
  if (e && e.target && !e.target.classList.contains('modal-backdrop')) return;
  document.getElementById('modal-backdrop').classList.remove('open');
}
