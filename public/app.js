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
let stationGroups = {};
let selectedStation = null;


function usesStaId(datasetId) {

  return [

    "siocalcofiHydroCast",
    "siocalcofiHydroBottle"

  ].includes(datasetId);
}

async function loadStationGroups() {

  const response =
    await fetch(
      "./data/station_groups.json"
    );

  window.stationGroups =
    await response.json();

  console.log(
    Object.keys(
      window.stationGroups
    ))
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
    .map(v => v.variable_name)
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

  if (window.currentStation
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
      v.variable_name
    ) {

      url +=
        `&${encodeURIComponent(v.variable_name + ">=")}` +
        `${encodeURIComponent(v.constraint_min)}`;
    }

    if (
      v.constraint_max !== undefined &&
      v.variable_name
    ) {

      url +=
        `&${encodeURIComponent(v.variable_name + "<=")}` +
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

  params.set("locType", "station");

  if (parsed) {

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

  params.set("locType", "station");

  if (parsed) {

    params.set(
      "beginLine",
      parsed.line - 1
    );

    params.set(
      "endLine",
      parsed.line + 1
    );

    params.set(
      "beginStation",
      parsed.station - 1
    );

    params.set(
      "endStation",
      parsed.station + 1
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

function normalizeStationId(id) {

  if (!id) return "";

  return String(id)
    .replace(/"/g, "")
    .trim();
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


function openStation(station) {

 window.currentStation =
  station;

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

  const key =
    normalizeStationId(station.station_id);

  const stationVariables =

    window.stationVariableMap?.[
    key
    ] || [];

  console.log(
    key,
    stationVariables.length
  );

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
                 onclick='handleVariableClick("${v.variable_id}")'>

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

    const data =
      await res.json();

    const stations =
      Array.isArray(data)
        ? data
        : data.stations || [];

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
        station.station_key
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
            radius: 10,
            color: "#00c2ff",
            fillOpacity: 0.7
          }
        );

      // IMPORTANT

      marker.stationData =
        station;

      marker.bindTooltip(

        station.station_id,

        {

          direction: "top",

          offset: [0, -8],

          opacity: 0.9,

          sticky: true
        }
      );

      // CLICK HANDLER

      marker.on("click", () => {

        if (selectedVariable) {

          window.currentStation =
            station;

          openStation(station);

          openVariableModal(
            selectedVariable
          );

          return;
        }

        // restore previous selected station

        if (
          window.selectedStation?.marker
        ) {

          restoreMarkerStyle(
            window.selectedStation.marker
          );
        }

        // set new selected station

        window.selectedStation = station;

        applySelectedStyle(
          station.marker
        );

        // normal station workflow

        openStation(station);
      });

      // store marker reference

      station.marker = marker;

      marker.addTo(
        window.stationLayer
      );

      console.log(
        "station id",
        station.station_id, "station key",
        station.station_key
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

    const raw =
      await res.json();

    const variables =
      Array.isArray(raw)
        ? raw
        : raw.variables || [];



    window.allVariables =
      variables;

    console.log(window.allVariables)

    console.log(
      "Variables loaded:",
      variables.length
    )
    window.variableMap = {};

    window.stationVariableMap = {};

    variables.forEach(v => {

      const variableId =
        (
          v.variable_id ||
          `${v.dataset_id}::${v.variable_name}`
        )
          .trim()
          .toLowerCase();

      v.variable_id = variableId;

      v.station_ids =
        window.stationGroups?.[
        v.station_group
        ] || [];

      v.station_ids.forEach(id => {

        const key =
          normalizeStationId(id);

        if (
          !window.stationVariableMap[
          key
          ]
        ) {

          window.stationVariableMap[
            key
          ] = [];
        }

        window.stationVariableMap[
          key
        ].push(v);
      });

      window.variableMap[
        variableId
      ] = v;


    })
      ;

  } catch (err) {

    console.error(
      "Failed loading variables:",
      err
    );
  }
}


// --- Dropdown search ---
const searchInput = document.getElementById('search');
const dropdown = document.getElementById('dropdown');

dropdown.addEventListener("mousedown", (e) => {

  clearAll();
  const item = e.target.closest(".dropdown-item");

  if (!item) return;

  selectVariable(item.dataset.id);

  closeDropdown();

});

searchInput.addEventListener("input", (e) => {
  renderDropdown(e.target.value);
});

// searchInput.addEventListener('input', () => {
//   const q = searchInput.value.trim();
//   dropdownFocusIdx = -1;
//   if (!q) { closeDropdown(); clearHighlights(); return; }
//   openDropdown();
//   renderDropdown(q);
// });

searchInput.addEventListener('focus', () => {
  openDropdown();
  renderDropdown(searchInput.value.trim());
});

searchInput.addEventListener('input', () => {
  dropdownFocusIdx = -1;
  openDropdown();
  renderDropdown(searchInput.value.trim());
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


searchInput.addEventListener("blur", () => {
  setTimeout(closeDropdown, 150);
});

searchInput.addEventListener('focusout', (e) => {
  closeDropdown();
});


function updateDropdownFocus(items) {
  items.forEach((el, i) => el.classList.toggle('focused', i === dropdownFocusIdx));
  if (items[dropdownFocusIdx]) items[dropdownFocusIdx].scrollIntoView({ block: 'nearest' });
}

function openDropdown() {
  dropdown.classList.add('open');
}

function closeDropdown() {
  console.log("closing dropdown");
  dropdown.classList.remove('open');
  dropdownFocusIdx = -1;
}

function renderDropdown(searchTerm = "") {
  const vars = window.allVariables || [];

  if (!Array.isArray(vars)) {
    console.error("renderDropdown expected array:", vars);
    return;
  }

  const list = document.getElementById("dropdown");

  if (!list) {
    console.error("Dropdown element not found (#dropdown)");
    return;
  }

  const filtered = vars.filter(v => {
    const text = (
      (v.display_name || "") +
      " " +
      (v.keywords || []).join(" ")
    ).toLowerCase();

    return text.includes(searchTerm.toLowerCase());
  });

  // if (filtered.length === 0 || !searchTerm) {
  //   list.innerHTML = "";
  //   list.classList.remove("open");
  //   return;
  // }

  const results =
    searchTerm
      ? filtered
      : vars.slice(0, 100);

  list.classList.add("open");

  // list.innerHTML = filtered.map(v => `
  //   <div class="dropdown-item"
  //        data-id="${v.variable_id}">

  //     <div class="dropdown-title">
  //       ${v.display_name}
  //     </div>

  if (results.length === 0) {
    list.innerHTML = `
    <div class="dropdown-empty">
      No variables found
    </div>
  `;
    return;
  }

  list.innerHTML = results.map(v => `
<div class="dropdown-item"
       data-id="${v.variable_id}">

    <div class="dropdown-name">

      ${v.display_name}

      <span style="
        color: var(--muted);
        margin-left: 6px;
        font-size: 10px;
      ">

        | ${v.dataset_name || v.provider || v.dataset_id} | Station based: ${v.station_based}

      </span>

    </div>
    </div>
  `).join("");
}

document.getElementById("dropdown").addEventListener("mousedown", (e) => {
  const item = e.target.closest(".dropdown-item");
  if (!item) return;

  const id = item.dataset.id;

  const selected = (window.allVariables || [])
    .find(v => v.variable_id === id);

  if (selected) {
    selectVariable(selected.variable_id);
    closeDropdown();
  }
});





// function selectVariable(variableId) {

//   const v =
//     window.allVariables.find(v => v.variable_id === variableId);

//   console.log(v)

//   if (!v) {

//     console.error(
//       "Variable not found:",
//       variableId
//     );

//     console.log(
//       "Available keys sample:",
//       Object.keys(
//         window.variableMap || {}
//       ).slice(0, 10)
//     );

//     return;
//   }


//   highlightStations(v);

//   openVariableModal(v);
// }

function styleDefaultStation(marker) {

  marker.setStyle({

    radius: 10,

    fillColor: "#00c2ff",

    color: "#0d7aad",

    weight: 2,

    fillOpacity: 0.7,
  });
}



function darkenColor(hex, factor = 0.75) {

  if (!hex) return hex;

  hex = hex.replace("#", "");

  const r = parseInt(
    hex.substring(0, 2),
    16
  );

  const g = parseInt(
    hex.substring(2, 4),
    16
  );

  const b = parseInt(
    hex.substring(4, 6),
    16
  );

  const darkened = [

    Math.floor(r * factor),

    Math.floor(g * factor),

    Math.floor(b * factor * factor)

  ];

  return (
    "#" +
    darkened
      .map(v =>
        v
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  );
}

function applySelectedStyle(marker) {

  const currentStyle =
    marker.options;

  // save original style

  marker._previousStyle = {

    fillColor:
      currentStyle.fillColor,

    color:
      currentStyle.color,

    radius:
      currentStyle.radius,

    weight:
      currentStyle.weight,

    fillOpacity:
      currentStyle.fillOpacity
  };

  marker.setStyle({

    fillColor: darkenColor(
      currentStyle.fillColor
    ),

    color: darkenColor(
      currentStyle.color || "#ffffff"
    ),

    radius:
      (currentStyle.radius || 6) + 1,

    weight:
      (currentStyle.weight || 1.5) + 1
  });
}

function restoreMarkerStyle(marker) {

  if (!marker?._previousStyle)
    return;

  marker.setStyle(
    marker._previousStyle
  );

  delete marker._previousStyle;
}


function selectVariable(variableId) {

  const v =
    window.allVariables.find(
      v => v.variable_id === variableId
    );

  if (!v) return;

  selectedVariable = v;


  searchInput.value =
    v.display_name || "";

  closeDropdown();

  highlightStations(v);

  document.getElementById(
    'clear-btn'
  ).classList.add('visible');

  const banner =
    document.getElementById(
      'search-banner'
    );

  console.log(
    v.display_name,
    v.station_group,
    v.station_ids?.length,
    v.station_ids
  );

  banner.textContent =
    `${v.station_ids?.length || 0} stations contain ${v.display_name}`;

  banner.classList.add('visible');

  // IF NON-STATION VARIABLE:
  // open immediately

  const isStationBased =
    Array.isArray(v.station_ids) &&
    v.station_ids.length > 0;

  // NON-STATION DATA

  if (!isStationBased) {

    openVariableModal(v);

    return;
  }

  // STATION-BASED DATA

  highlightStations(v);

  document.getElementById(
    'clear-btn'
  ).classList.add('visible');


  banner.textContent =
    `${v.station_ids?.length || 0} stations contain ${v.display_name}`;

  banner.classList.add('visible');

  renderVariableSelectionPanel(v);
}

function escapeRe(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderVariableSelectionPanel(v) {

  const content =
    document.getElementById(
      'panel-content'
    );

  document.getElementById(
    'panel-empty'
  ).style.display = 'none';

  document.getElementById(
    'panel-header'
  ).style.display = 'block';

  document.getElementById(
    'panel-station-id'
  ).textContent =
    v.display_name;

  document.getElementById(
    'panel-coords'
  ).textContent =
    'Select a highlighted station';

  content.classList.add('visible');

  content.innerHTML = `

    <div style="
      color:var(--muted);
      font-size:11px;
      line-height:1.8;
    ">

      ${v.description || ''
    }

      <br><br>

      <span style="color:var(--accent)">
        ${v.station_ids?.length || 0}
        stations available
      </span>

    </div>

  `;
}

function resetPanelUI() {

  // header reset
  const header = document.getElementById('panel-header');
  if (header) header.style.display = 'none';

  document.getElementById('panel-station-id').textContent = '';
  document.getElementById('panel-coords').textContent = '';

  // content reset
  const content = document.getElementById('panel-content');
  if (content) {
    content.classList.remove('visible');
    content.innerHTML = '';
  }

  // empty state restore
  const empty = document.getElementById('panel-empty');
  if (empty) {
    empty.style.display = 'flex'; // important: matches your CSS flex layout
  }

  // global state reset (important for your earlier bug)
  selectedVariable = null;
  window.currentStation = null;

  // UI extras
  document.getElementById('clear-btn')?.classList.remove('visible');

  const banner = document.getElementById('search-banner');
  if (banner) {
    banner.classList.remove('visible');
    banner.textContent = '';
  }
}

// --- Highlight stations ---
function highlightStations(variable) {

  clearHighlights();

  if (!variable?.station_ids)
    return;

  variable.station_ids.forEach(id => {

    const station =
      window.stationMap[
      normalizeStationId(id)
      ];

    if (
      station?.marker
    ) {

      station.marker.setStyle({

        radius: 10,

        fillColor: "#ffd84d",

        color: "#fff3bf",

        weight: 2,

        fillOpacity: 0.95,

        opacity: 1
      });
    }
  });
}

function clearHighlights() {

  Object.values(window.stationMap || {})
    .forEach(station => {

      if (!station.marker) return;

      station.marker.setStyle({

        radius: 5,
        fillColor: "#4a90e2",
        color: "#ffffff",
        weight: 1,
        fillOpacity: 0.7,
        opacity: 1

      });
    });
}

function handleVariableClick(variableId) {
  const variable = window.variableMap?.[variableId];
  if (!variable) return;

  selectVariable(variableId);

  // always try to open after state settles
  requestAnimationFrame(() => {
    if (window.currentStation) {
      openVariableModal(variable);
    }
  });
}

function clearAll() {
  selectedVariable = null;
  activeCategory = null;
  searchInput.value = '';
  closeDropdown();
  clearHighlights();
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  //document.getElementById('search-banner').classList.remove('visible');
  document.getElementById('clear-btn').classList.remove('visible');
  //resetPanelUI();
}



function openVariableModal(v) {

  console.log(
    "Opening variable modal:",
    v
  );

  const backdrop =
    document.getElementById(
      "modal-backdrop"
    );

  const modal =
    document.getElementById(
      "modal"
    );

  const title =
    document.getElementById(
      "modal-title"
    );

  const body =
    document.getElementById(
      "modal-body"
    );

  const footer =
    document.getElementById(
      "modal-footer"
    );

  const warning =
    document.getElementById(
      "external-warning"
    );

  if (
    !backdrop ||
    !modal ||
    !title ||
    !body ||
    !footer
  ) {

    console.error(
      "Modal elements missing"
    );

    return;
  }

  // prevent backdrop click bubbling
  modal.onclick = (e) => {
    e.stopPropagation();
  };

  // title
  title.textContent =
    v.display_name ||
    v.variable_name ||
    "Dataset";

  // body
  body.innerHTML = `

    <div class="variable-description">

      ${v.description || ""}

    </div>

    <div class="variable-meta">

      <div>
        <strong>Dataset:</strong>
        ${v.dataset_name || ""}
      </div>

      <div>
        <strong>Provider:</strong>
        ${v.provider || ""}
      </div>

      <div>
        <strong>Platform:</strong>
        ${v.platform || ""}
      </div>

      ${v.units
      ? `
          <div>
            <strong>Units:</strong>
            ${v.units}
          </div>
        `
      : ""
    }

    </div>
  `;

  // clear footer
  footer.innerHTML = "";

  // build URL safely
  let url = "#";

  try {

    if (
      v.platform === "erddap"
    ) {

      url =
        buildERDDAPUrl(v);

    } else if (
      v.platform === "euphausiid"
    ) {

      url =
        buildEuphausiidUrl(v);

    } else if (
      v.platform === "zoodb"
    ) {

      url =
        buildZooDBUrl(v);

    } else {

      url =
        v.source?.access_url ||
        "#";
    }

  } catch (err) {

    console.error(
      "URL generation failed:",
      err
    );
  }

  // force https for deployed app compatibility
  if (
    url &&
    url.startsWith("http://")
  ) {

    url =
      url.replace(
        "http://",
        "https://"
      );
  }

  console.log(
    "Generated dataset URL:",
    url
  );

  // create REAL anchor link
  const link =
    document.createElement("a");

  link.href =
    url;

  link.target =
    "_blank";

  link.rel =
    "noopener noreferrer";

  link.className =
    "btn-docs";

  link.textContent =
    "Open Dataset ↗";

  footer.appendChild(
    link
  );

  // external dataset warning
  // footer.appendChild(
  //   warning
  // );

  if (!v.station_based) {
  if (warning) {
    warning.style.display = "block";
  }
} else {
  if (warning) {
    warning.style.display = "none";
  }
}

  // show modal
  backdrop.style.display =
    "flex";
}

function closeModal(event) {

  // allow backdrop click close
  if (
    event &&
    event.target &&
    event.target.id !== "modal-backdrop"
  ) {
    return;
  }

  const backdrop =
    document.getElementById(
      "modal-backdrop"
    );

  if (backdrop) {
    backdrop.style.display =
      "none";
  }
  //clearAll();
}



// --- Boot ---
loadStations();
loadStationGroups();
loadVariables();