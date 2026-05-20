// --- Map ---
const map = L.map('map', { center: [32.5, -119.5], zoom: 6 })
  .addLayer(L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CARTO', subdomains: 'abcd', maxZoom: 14,
  }));

// --- State ---
let allStations = [];
let allVariables = [];
let markers = {};
let activeCategory = null;
let selectedVariable = null;
let dropdownFocusIdx = -1;
let stationSearchEnabled = true;

function toggleStationSearch() {
  stationSearchEnabled =
    !stationSearchEnabled;

  const btn =
    document.getElementById(
      'station-toggle'
    );

  if (btn) {

    btn.textContent =
      stationSearchEnabled
        ? 'Station Search: ON'
        : 'Station Search: OFF';
  }
}

function usesStaId(datasetId) {

  return [

    "siocalcofiHydroCast",
    "siocalcofiHydroBottle"

  ].includes(datasetId);
}

function buildERDDAPUrl(variable) {

  const dataset =
    variable.dataset_id;

  const base =
    variable.source?.access_url ||
    variable.url;

  if (!base) return null;

  const selected =
    window.selectedVariables || [variable];

  // selected variables from UI

  const variableNames = selected
    .filter(v => v.dataset_id === dataset)
    .map(v => v.erddap_variable)
    .filter(Boolean);

  // required fields

const fields = [

  "time",

  "latitude",

  "longitude"
];

if (
  usesStaId(dataset)
) {

  fields.push("sta_id");

} else {

  fields.push("line");
  fields.push("station");
}

fields.push(...variableNames);

  let url =
    `https://oceanview.pfeg.noaa.gov/erddap/tabledap/${dataset}.html?` +
    encodeURIComponent(fields.join(","));

  if (
    stationSearchEnabled &&
    window.currentStation
  ) {

    const s = window.currentStation;

    // CASE 1 — sta_id exists

    if (
  usesStaId(dataset)
) {

  // SIO hydro datasets

  url +=
    `&sta_id=` +
    encodeURIComponent(
      `"${s.station_id}"`
    );
}

else {

  // NOAA datasets use line/station

  const parsed =
    parseStationId(
      s.station_id
    );

  if (parsed) {

    url +=
      `&line=` +
      encodeURIComponent(
        parsed.line
      );

    url +=
      `&station=` +
      encodeURIComponent(
        parsed.station
      );
  }
}
  }

  // selected variable constraints

  selected.forEach(v => {

    if (
      v.constraint_min !== undefined &&
      v.erddap_variable
    ) {

      url +=
        `&${encodeURIComponent(v.erddap_variable + ">=")}` +
        `${encodeURIComponent(v.constraint_min)}`;
    }

    if (
      v.constraint_max !== undefined &&
      v.erddap_variable
    ) {

      url +=
        `&${encodeURIComponent(v.erddap_variable + "<=")}` +
        `${encodeURIComponent(v.constraint_max)}`;
    }
  });

  return url;
}


function buildEuphausiidUrl(variable) {

  const station =
    window.currentStation;

  const parsed =
    parseStationId(
      station?.station_id
    );

  const params =
    new URLSearchParams();

  params.set("mode", "save");

  params.set("beginYear", "1955");
  params.set("endYear", "2010");

  for (let m = 1; m <= 12; m++) {
    params.append("month[]", m);
  }

  params.append("cruise[]", "");

  params.set("timeType", "all");

  params.set(
    "locType",
    stationSearchEnabled
      ? "station"
      : "all"
  );

  if (
    stationSearchEnabled &&
    parsed
  ) {

    params.set(
      "beginLine",
      parsed.line
    );

    params.set(
      "endLine",
      parsed.line
    );

    params.set(
      "beginStation",
      parsed.station
    );

    params.set(
      "endStation",
      parsed.station
    );
  }

  params.append(
    "GS[]",
    variable.variable_name
  );

  params.append(
    "PS[]",
    ".*"
  );

  params.set("sex", "%male");

  params.set("beginSize", "");
  params.set("endSize", "");

  params.set(
    "calcType",
    "individual"
  );

  params.set(
    "calcUnit",
    "m2"
  );

  params.set("paginate", "1");
  params.set("nlines", "100");

  return (
    "https://oceaninformatics.ucsd.edu/euphausiid/save.php?" +
    params.toString()
  );
}


function buildZooDBUrl(variable) {

  const station =
    window.currentStation;

  const parsed =
    parseStationId(
      station?.station_id
    );

  const params =
    new URLSearchParams();

  params.set("mode", "save");

  params.set("beginYear", "2000");
  params.set("endYear", "2010");

  for (let m = 1; m <= 12; m++) {
    params.append("month[]", m);
  }

  params.append("cruise[]", "");

  params.set("timeType", "all");

  params.set(
    "locType",
    stationSearchEnabled
      ? "station"
      : "region"
  );

  if (
    stationSearchEnabled &&
    parsed
  ) {

    params.set(
      "beginLine",
      parsed.line
    );

    params.set(
      "endLine",
      parsed.line
    );

    params.set(
      "beginStation",
      parsed.station
    );

    params.set(
      "endStation",
      parsed.station
    );
  }

  if (
    variable.taxonomy?.higher_taxonomy
  ) {

    params.append(
      "HT[]",
      variable.taxonomy.higher_taxonomy
    );
  }

  params.append(
    "GS[]",
    variable.variable_name
  );

  params.append("PS[]", ".*");

  params.set("beginSize", "");
  params.set("endSize", "");

  params.set(
    "calcType",
    "individual"
  );

  params.set(
    "calcUnit",
    "m2"
  );

  params.set("pooled", "0");

  return (
    "https://oceaninformatics.ucsd.edu/zoodb/save.php?" +
    params.toString()
  );
}

function parseStationId(stationId) {

  if (!stationId)
    return null;

  const clean =
    stationId
      .replace(/"/g, "")
      .trim();

  const parts =
    clean.split(/\s+/);

  if (parts.length !== 2)
    return null;

  return {

    line:
      parts[0],

    station:
      parts[1]
  };
}

// --- Station markers ---
function makeMarkerStyle(highlighted) {
  return {
    radius:      highlighted ? 9 : 7,
    fillColor:   highlighted ? '#00c2ff' : '#1a4a6e',
    color:       highlighted ? '#00ffb3' : '#0d7aad',
    weight:      1.5,
    fillOpacity: highlighted ? 0.95 : 0.7,
    opacity:     1,
  };
}

function dimMarkerStyle() {
  return { fillColor: '#0d2a40', color: '#0d4060', fillOpacity: 0.2, radius: 5 };
}

function openStation(station) {

  window.currentStation = station;

  document.getElementById(
    'panel-empty'
  ).style.display = 'none';

  document.getElementById(
    'panel-header'
  ).style.display = 'block';

  document.getElementById(
    'panel-station-id'
  ).textContent =
    `Station ${station.station_id}`;

  document.getElementById(
    'panel-coords'
  ).textContent =
    `${station.lat.toFixed(4)}°N ` +
    `${Math.abs(station.lon).toFixed(4)}°W`;

  const content =
    document.getElementById(
      'panel-content'
    );

  content.classList.add('visible');

  // FILTER VARIABLES FROM STATIC JSON

  const stationVariables =
    allVariables.filter(v => {

      // station toggle OFF

      if (!stationSearchEnabled)
        return true;

      // station-based matching

      return (
        v.station_ids &&
        v.station_ids.includes(
          station.station_id
        )
      );
    });

  // GROUP

  const bySource = {};

  stationVariables.forEach(v => {

    const source =
      v.provider || "Unknown";

    const category =
      v.entity_type || "Other";

    if (!bySource[source])
      bySource[source] = {};

    if (!bySource[source][category])
      bySource[source][category] = [];

    bySource[source][category]
      .push(v);
  });

  content.innerHTML =
    Object.entries(bySource)
      .map(([source, cats]) => `

      <div class="source-group">

        <div class="source-label">
          📦 ${source}
        </div>

        ${Object.entries(cats)
          .map(([cat, vars]) => `

          <div class="category-sublabel">
            ${cat}
          </div>

          ${vars.map(v => `

            <div class="data-link"
                 onclick='openModal(${JSON.stringify(v)})'>

              <span class="data-link-name">
                ${v.display_name}
              </span>

            </div>

          `).join('')}

        `).join('')}

      </div>

    `).join('');
}

async function loadStations() {

  try {

    const res = await fetch(
      "./data/stations.json"
    );

    const stations =
      await res.json();

    // =================================================
    // STORE GLOBALLY
    // =================================================

    window.allStations = stations;

    window.stationMap = {};

    // =================================================
    // CLEAR OLD MARKERS
    // =================================================

    if (window.stationLayer) {

      map.removeLayer(
        window.stationLayer
      );
    }

    window.stationLayer =
      L.layerGroup().addTo(map);

    // =================================================
    // BUILD MARKERS
    // =================================================

    stations.forEach(station => {

      // lookup map

      window.stationMap[
        station.station_id
      ] = station;

      // validate coordinates

      if (
        station.lat == null ||
        station.lon == null
      ) {
        return;
      }

      const marker =
        L.circleMarker(
          [station.lat, station.lon],
          {
            radius: 4,
            fillColor: "#4db6ff",
            color: "#ffffff",
            weight: 1,
            opacity: 1,
            fillOpacity: 0.9
          }
        );

      // IMPORTANT

      marker.stationData =
        station;

      // CLICK HANDLER

      marker.on("click", () => {

        openStation(station);
      });

      // store marker reference

      station.marker = marker;

      marker.addTo(
        window.stationLayer
      );
    });

    console.log(
      `Loaded ${stations.length} stations`
    );

  } catch (err) {

    console.error(
      "Failed loading stations:",
      err
    );
  }
}
// --- Variables + categories ---
async function loadVariables() {

  try {

    const res = await fetch(
      "./data/variables.json"
    );

    const variables =
      await res.json();

    // =================================================
    // STORE GLOBALLY
    // =================================================

    window.allVariables = variables;

    window.variableMap = {};

    // selected variables

    window.selectedVariables = [];

    // =================================================
    // BUILD LOOKUP MAP
    // =================================================

    variables.forEach(v => {

      // IMPORTANT

      v.variable_id =
        v.variable_id ||
        `${v.dataset_id}::${v.variable_name}`;

      window.variableMap[
        v.variable_id
      ] = v;

      // normalize arrays

      v.station_ids =
        v.station_ids || [];

      v.keywords =
        v.keywords || [];

      v.science_concepts =
        v.science_concepts || [];

      // normalize fields

      v.display_name =
        v.display_name ||
        v.variable_name;

      v.provider =
        v.provider ||
        "Unknown";

      v.entity_type =
        v.entity_type ||
        "Other";

      v.platform =
        v.platform ||
        "external";
    });

    console.log(
      `Loaded ${variables.length} variables`
    );

  } catch (err) {

    console.error(
      "Failed loading variables:",
      err
    );
  }
}

// function renderCategoryFilters(categories) {
//   const container = document.getElementById('category-filters');
//   categories.forEach(cat => {
//     const btn = document.createElement('button');
//     btn.className = 'filter-btn';
//     btn.textContent = cat;
//     btn.onclick = () => toggleCategory(cat, btn);
//     container.appendChild(btn);
//   });
// }

// --- Dropdown search ---
const searchInput = document.getElementById('search');
const dropdown   = document.getElementById('dropdown');

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  dropdownFocusIdx = -1;
  if (!q) { closeDropdown(); clearHighlights(); return; }
  renderDropdown(q);
});

searchInput.addEventListener('keydown', e => {
  const items = dropdown.querySelectorAll('.dropdown-item');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    dropdownFocusIdx = Math.min(dropdownFocusIdx + 1, items.length - 1);
    updateDropdownFocus(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    dropdownFocusIdx = Math.max(dropdownFocusIdx - 1, 0);
    updateDropdownFocus(items);
  } else if (e.key === 'Enter') {
    if (dropdownFocusIdx >= 0 && items[dropdownFocusIdx]) {
      items[dropdownFocusIdx].click();
    }
  } else if (e.key === 'Escape') {
    closeDropdown();
  }
});

searchInput.addEventListener('blur', () => {
  // small delay so clicks on dropdown register first
  setTimeout(closeDropdown, 150);
});

function renderDropdown(filtered = null) {

  const list =
    document.getElementById(
      "dropdown-list"
    );

  const vars =
    filtered || window.allVariables;

  list.innerHTML = vars.map(v => `

    <div class="dropdown-item"
         onclick='selectVariable("${v.variable_id}")'>

      <div class="dropdown-title">
        ${v.display_name}
      </div>

      <div class="dropdown-meta">

        ${v.provider}
        •
        ${v.entity_type}

      </div>

    </div>

  `).join("");
}

function updateDropdownFocus(items) {
  items.forEach((el, i) => el.classList.toggle('focused', i === dropdownFocusIdx));
  if (items[dropdownFocusIdx]) items[dropdownFocusIdx].scrollIntoView({ block: 'nearest' });
}

function closeDropdown() {
  dropdown.classList.remove('open');
  dropdownFocusIdx = -1;
}

function selectVariable(variableId) {

  const variable =
    window.variableMap[
      variableId
    ];

  if (!variable) return;

  window.selectedVariables =
    [variable];

  console.log(
    "Selected variable:",
    variable
  );

  highlightStations(variable);

  openModal(variable);
}

function escapeRe(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Category filter ---
function toggleCategory(cat, btn) {
  if (activeCategory === cat) {
    activeCategory = null;
    btn.classList.remove('active');
    if (!selectedVariable) { clearHighlights(); document.getElementById('clear-btn').classList.remove('visible'); }
  } else {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeCategory = cat;

    // Filter to stations that have any variable in this category
    const ids = new Set();
    allVariables.filter(v => v.category === cat).forEach(v => v.station_ids.forEach(id => ids.add(id)));
    highlightStations(ids);

    const banner = document.getElementById('search-banner');
    banner.textContent = `${ids.size} stations have ${cat} data`;
    banner.classList.add('visible');
    document.getElementById('clear-btn').classList.add('visible');
  }
}

// --- Highlight stations ---
function highlightStations(variable) {

  clearHighlights();

  if (
    !variable.station_ids
  ) return;

  variable.station_ids.forEach(id => {

    const station =
      window.stationMap[id];

    if (
      station &&
      station.marker
    ) {

      station.marker.setStyle({

        radius: 7,

        fillColor: "#ffcc00",

        color: "#ffffff",

        weight: 2
      });
    }
  });
}

function clearHighlights() {
  allStations.forEach(s => { if (markers[s.station_id]) markers[s.station_id].setStyle(makeMarkerStyle(true)); });
}

function clearAll() {
  selectedVariable = null;
  activeCategory = null;
  searchInput.value = '';
  closeDropdown();
  clearHighlights();
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('search-banner').classList.remove('visible');
  document.getElementById('clear-btn').classList.remove('visible');
}


function openModal(v) {
  const modalBackdrop = document.getElementById('modal-backdrop');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const footer = document.getElementById('modal-footer');

  modalTitle.textContent = v.name;

  // ---------- BODY ----------
  modalBody.innerHTML = `
    <div class="modal-row">
      <span class="modal-row-label">Source</span>
      <span class="modal-row-value accent">${v.source || 'Unknown'}</span>
    </div>

    <div class="modal-row">
      <span class="modal-row-label">Category</span>
      <span class="modal-row-value">${v.category || 'Uncategorized'}</span>
    </div>

    ${v.unit ? `
      <div class="modal-row">
        <span class="modal-row-label">Unit</span>
        <span class="modal-row-value">${v.unit}</span>
      </div>` : ''}

    ${v.date_range_start ? `
      <div class="modal-row">
        <span class="modal-row-label">Date Range</span>
        <span class="modal-row-value">
          ${v.date_range_start} → ${v.date_range_end || 'Present'}
        </span>
      </div>` : ''}

    <div class="modal-row">
      <span class="modal-row-label">Format</span>
      <span class="modal-row-value">${v.format || 'ERDDAP / CSV'}</span>
    </div>

    ${v.notes ? `
      <div class="modal-row">
        <span class="modal-row-label">Notes</span>
        <span class="modal-row-value" style="font-size:10px;color:var(--muted)">
          ${v.notes}
        </span>
      </div>` : ''}
  `;

  // ---------- WARNINGS ----------
  const transitSources = ['Marine Mammals', 'Seabirds', 'Underway'];
  if (transitSources.includes(v.source)) {
    modalBody.innerHTML += `
      <div style="margin-top:12px;padding:10px 12px;
                  background:rgba(255,107,53,0.08);
                  border:1px solid rgba(255,107,53,0.25);
                  border-radius:4px;font-size:10px;color:var(--warm);line-height:1.6;">
        ⚠️ Transit-based data (not fixed stations)
      </div>`;
  }

  const subsetSources = ['DIC', 'Primary Production', 'Phytoplankton', 'Genomics/eDNA'];
  if (subsetSources.includes(v.source)) {
    modalBody.innerHTML += `
      <div style="margin-top:12px;padding:10px 12px;
                  background:rgba(0,194,255,0.06);
                  border:1px solid rgba(0,194,255,0.2);
                  border-radius:4px;font-size:10px;color:var(--muted);line-height:1.6;">
        ℹ️ Available at subset of stations
      </div>`;
  }

  

let finalUrl = null;

if (v.platform === "erddap") {

  finalUrl =
    buildERDDAPUrl(v);
}

else if (
  v.dataset_id === "euphausiid"
) {

  finalUrl =
    buildEuphausiidUrl(v);
}

else if (
  v.dataset_id === "zoodb"
) {

  finalUrl =
    buildZooDBUrl(v);
}

else {

  finalUrl =
    v.source?.access_url ||
    v.url;
}

footer.innerHTML = `

  <div style="
    width:100%;
    display:flex;
    flex-direction:column;
    gap:8px;
  ">

    <a class="btn-docs"
       href="${finalUrl}"
       target="_blank"
       style="text-align:center">

      Open Dataset ↗

    </a>

  </div>
`;
}

// --- Boot ---
loadStations();
loadVariables();