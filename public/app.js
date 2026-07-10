// create map
const map = L.map('map', { center: [32.5, -119.5], zoom: 6 })
  .addLayer(L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CARTO', subdomains: 'abcd', maxZoom: 14,
  }));

// default states
let allStations = [];
let allVariables = [];
let markers = {};
let activeCategory = null;
let selectedVariable = null;
let dropdownFocusIdx = -1;
let stationGroups = {};
let selectedStation = null;

// check the format of stationID for specific erddap dataset
function usesStaId(datasetId) {
  return [
    "siocalcofiHydroCast",
    "siocalcofiHydroBottle"
  ].includes(datasetId);
}

// load station group lookup (dataset -> [station_ids])
async function loadStationGroups() {
  const response = await fetch("./data/station_groups.json");
  window.stationGroups = await response.json();
}

// resolve the outbound link for a variable's source dataset (erddap/euphausiid/zoodb/other)
function getDatasetUrl(v) {
  let url = "#";
  try {
    if (v.platform === "erddap") {
      url = buildERDDAPUrl(v);
    } else if (v.platform === "euphausiid") {
      url = buildEuphausiidUrl(v);
    } else if (v.platform === "zoodb") {
      url = buildZooDBUrl(v);
    } else {
      url = v.source?.access_url || "#";
    }
  } catch (err) {
    console.error("URL generation failed:", err);
  }
  if (url && url.startsWith("http://")) {
    url = url.replace("http://", "https://");
  }
  return url;
}

// build erddap query url
function buildERDDAPUrl(variable) {
  const dataset = variable.dataset_id;
  const base = variable.source?.access_url || variable.url;
  if (!base) return null;

  const selected = window.selectedVariables || [variable];
  const variableNames = selected
    .filter(v => v.dataset_id === dataset)
    .map(v => v.variable_name)
    .filter(Boolean);

  const fields = ["time", "latitude", "longitude"];
  if (usesStaId(dataset)) {
    fields.push("sta_id");
  } else {
    fields.push("line");
    fields.push("station");
  }
  fields.push(...variableNames);

  let url = `https://oceanview.pfeg.noaa.gov/erddap/tabledap/${dataset}.html?` +
    encodeURIComponent(fields.join(","));

  if (window.currentStation) {
    const s = window.currentStation;
    if (usesStaId(dataset)) {
      url += `&sta_id=` + encodeURIComponent(`"${s.station_id}"`);
    } else {
      const parsed = parseStationId(s.station_id);
      if (parsed) {
        url += `&line=` + encodeURIComponent(parsed.line);
        url += `&station=` + encodeURIComponent(parsed.station);
      }
    }
  }

  selected.forEach(v => {
    if (v.constraint_min !== undefined && v.variable_name) {
      url += `&${encodeURIComponent(v.variable_name + ">=")}${encodeURIComponent(v.constraint_min)}`;
    }
    if (v.constraint_max !== undefined && v.variable_name) {
      url += `&${encodeURIComponent(v.variable_name + "<=")}${encodeURIComponent(v.constraint_max)}`;
    }
  });

  return url;
}

function buildEuphausiidUrl(variable) {
  const station = window.currentStation;
  const parsed = parseStationId(station?.station_id);
  const params = new URLSearchParams();
  params.set("mode", "save");
  params.set("beginYear", "1955");
  params.set("endYear", "2010");
  for (let m = 1; m <= 12; m++) { params.append("month[]", m); }
  params.append("cruise[]", "");
  params.set("timeType", "all");
  params.set("locType", "station");
  if (parsed) {
    params.set("beginLine", parsed.line);
    params.set("endLine", parsed.line);
    params.set("beginStation", parsed.station);
    params.set("endStation", parsed.station);
  }
  params.append("GS[]", variable.variable_name);
  params.append("PS[]", ".*");
  params.set("sex", "%male");
  params.set("beginSize", "");
  params.set("endSize", "");
  params.set("calcType", "individual");
  params.set("calcUnit", "m2");
  params.set("paginate", "1");
  params.set("nlines", "100");
  return "https://oceaninformatics.ucsd.edu/euphausiid/save.php?" + params.toString();
}

function buildZooDBUrl(variable) {
  const station = window.currentStation;
  const parsed = parseStationId(station?.station_id);
  const params = new URLSearchParams();
  params.set("mode", "save");
  params.set("beginYear", "2000");
  params.set("endYear", "2010");
  for (let m = 1; m <= 12; m++) { params.append("month[]", m); }
  params.append("cruise[]", "");
  params.set("timeType", "all");
  params.set("locType", "station");
  if (parsed) {
    params.set("beginLine", parsed.line - 1);
    params.set("endLine", parsed.line + 1);
    params.set("beginStation", parsed.station - 1);
    params.set("endStation", parsed.station + 1);
  }
  if (variable.taxonomy?.higher_taxonomy) {
    params.append("HT[]", variable.taxonomy.higher_taxonomy);
  }
  params.append("GS[]", variable.variable_name);
  params.append("PS[]", ".*");
  params.set("beginSize", "");
  params.set("endSize", "");
  params.set("calcType", "individual");
  params.set("calcUnit", "m2");
  params.set("pooled", "0");
  return "https://oceaninformatics.ucsd.edu/zoodb/save.php?" + params.toString();
}

function normalizeStationId(id) {
  if (!id) return "";
  return String(id).replace(/"/g, "").trim();
}

function parseStationId(stationId) {
  if (!stationId) return null;
  const clean = stationId.replace(/"/g, "").trim();
  const parts = clean.split(/\s+/);
  if (parts.length !== 2) return null;
  return { line: parts[0], station: parts[1] };
}

// -------------------------------------------------------
// Metadata field keywords — shown as summary line per tab
// not as individual clickable rows
// -------------------------------------------------------
const METADATA_KEYWORDS = [
  "time", "date", "latitude", "longitude", "lat", "lon",
  "cast count", "bottle count", "bottle identifier",
  "line and station", "station id", "depth", "end time"
];

// Distinctive multi-word admin/identifier fields — safe to match anywhere
// in the string since they can't collide with taxa/species names.
const ADMIN_KEYWORDS = [
  "latitude", "longitude",
  "line and station", "line number", "actual line", "actual station",
  "nominal calcofi", "organizational id", "original station identifier",
  "cast id", "data descriptor code", "cloud amount code", "cloud type code",
  "visibility code", "wave direction code", "weather code",
  "civil twilight", "local apparent noon", "incubation start time",
  "incubation end time", "reported station", "reported line number",
  "time zone", "calcofi line", "calcofi station",
];

// Single ambiguous words — only exact match to avoid over-catching
const ADMIN_EXACT = ["year", "month", "station", "line"];

const CRUISE_KEYWORDS = [
  "cruise", "ship", "leg", "order occupied", "julian",
  "quarter", "event", "data type"
];

// Fields to drop entirely — not shown as a row, not shown in "Also includes"
// Replicate fields are no longer hidden outright — for some measurements
// (e.g. alkalinity, DIC) the ONLY variables that exist are "Replicate 1"/
// "Replicate 2", so excluding them entirely deleted the only way to reach
// that data. Instead, fixDisplayName() strips the suffix so both
// replicates render to the same label and merge via the existing
// dataset-grouping logic (one row, not two).
const REMOVE_KEYWORDS = [];

// Map dataset_id to a clean tab label
const DATASET_TAB_LABELS = {
  "siocalcofiHydroBottle": "Hydrographic Bottle",
  "siocalcofiHydroCast":   "Hydrographic Cast",
  "erdCalCOFINOAAhydros":  "NOAA CTD",
  "euphausiid":            "Euphausiids",
  "zoodb":                 "Zooplankton",
  "erdCalCOFIlrvcnt":      "Larval Fish",
  "erdCalCOFIlrvsiz":      "Larval Fish",
  "erdCalCOFIlrvstg":      "Larval Fish",
  "erdCalCOFIeggcnt":      "Fish Eggs",
  "erdCalCOFIeggstg":      "Fish Eggs",
  "erdCalCOFIinvcnt":      "Invertebrates",
  "erdCalCOFIinvsiz":      "Invertebrates",
  "erdCalCOFItows":        "Net Tows",
  "erdCalCOFIzoovol":      "Zooplankton Volume",
  "erdCalCOFIcufes":       "CUFES",
};

const ENTITY_TYPE_LABELS = {
  "physical_variable":  "Physical",
  "chemical_variable":  "Chemical",
  "taxon":              "Taxa",
  "scientific_variable":"Other measurements",
  "scientific_dataset": "Dataset",
};

const TAB_ORDER = [
  "Hydrographic Bottle",
  "Hydrographic Cast",
  "NOAA CTD",
  "Larval Fish",
  "Fish Eggs",
  "Invertebrates",
  "Net Tows",
  "Zooplankton",
  "Zooplankton Volume",
  "Euphausiids",
  "CUFES",
];

function isMetadataField(displayName) {
  const n = (displayName || "").toLowerCase().trim();
  // exact match or starts-with to avoid partial matches
  // e.g. "longitude" should not match "stylocheiron longicorne"
  if (METADATA_KEYWORDS.some(k => n === k || n.startsWith(k + " ") || n.startsWith(k + ","))) return true;
  if (ADMIN_KEYWORDS.some(k => n.includes(k))) return true;
  if (ADMIN_EXACT.some(k => n === k)) return true;
  return false;
}

function isRemovedField(displayName) {
  const n = (displayName || "").toLowerCase().trim();
  return REMOVE_KEYWORDS.some(k => n.includes(k));
}

function isCruiseField(displayName) {
  const n = (displayName || "").toLowerCase().trim();
  return CRUISE_KEYWORDS.some(k => n === k || n.startsWith(k + " ") || n.startsWith(k + ","));
}

function buildStationTabs(stationVariables) {
  // group by tab label (dataset)
  const tabs = {};
  stationVariables.forEach(v => {
    const label = DATASET_TAB_LABELS[v.dataset_id] || v.dataset_name || v.dataset_id;
    if (!tabs[label]) tabs[label] = [];
    tabs[label].push(v);
  });

  // sort tabs by TAB_ORDER
  return Object.keys(tabs)
    .sort((a, b) => {
      const ai = TAB_ORDER.indexOf(a);
      const bi = TAB_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    })
    .reduce((acc, k) => { acc[k] = tabs[k]; return acc; }, {});
}

// Keywords to exclude from the station panel's variable list. Hoisted to
// module level (rather than a local const inside renderStationTab) so it
// can be tested/audited independently, same as isMetadataField/isCruiseField.
const PANEL_EXCLUDE = [
  "quality", " quality", "flag", "bottle number", "bottle depth",
  "bottle identifier", "cast count", "bottle count", "tow number",
  // pH already has its own clean field ("pH", from ph1); the un-numbered
  // "Replicate" variant (ph2) isn't caught by the Replicate-N merge logic
  // since its raw label has no trailing digit, so it needs its own exclude
  // entry -- same fix already applied to the search dropdown/inventory
  // panel via EXCLUDE_DISPLAY_KEYWORDS, just missing here until now.
  "ph replicate",
];
function isPanelExcluded(displayName) {
  const n = (displayName || "").toLowerCase();
  return PANEL_EXCLUDE.some(k => n.includes(k));
}

function renderStationTab(vars) {
  // drop replicate/precision-of-replicate fields entirely — not shown
  // as a row, not shown in "Also includes" either
  vars = vars.filter(v => !isRemovedField(v.display_name));

  // separate metadata, cruise, and scientific vars
  const metaVars = vars.filter(v => isMetadataField(v.display_name));
  const cruiseVars = vars.filter(v => isCruiseField(v.display_name));
  const sciVars = vars.filter(v =>
    !isMetadataField(v.display_name) &&
    !isCruiseField(v.display_name) &&
    !isPanelExcluded(v.display_name)
  );

  // group scientific vars by entity_type, alphabetically within each
  // override entity_type for known misclassified variables
  function getDisplayType(v) {
    // Taxon entries (species) must never go through the keyword matching
    // below -- "ph" (meant to catch pH measurements) is a bare substring
    // match, and it happens to appear inside "Euphausia" itself, plus
    // "Pasiphaea", "Xiphias", and others -- silently misclassifying real
    // species as "Chemical". Route taxa straight to their real
    // entity_type before any of that runs.
    if (v.entity_type === "taxon") return "Taxa";

    const n = fixDisplayName(v.display_name || "").toLowerCase();
    if (n.includes("c14") || n.includes("chlorophyll") || n.includes("phaeopigment") || n.includes("productivity")) {
      return "Productivity & Pigments";
    }
    // entity_type was computed upstream (build_vars.py) against the terse
    // ERDDAP variable_name code, not the readable display_name -- e.g.
    // "t_degc" doesn't contain "temp" as a substring even though it IS
    // temperature, so it fell through to the generic "scientific_variable"
    // fallback and landed in "Other Measurements" while "r_temp" (Reported
    // Potential Temperature) correctly matched and landed in Physical.
    // Checking the display_name directly is more reliable; mirrors the
    // same keyword grouping used for the portal-wide browse categories in
    // build_vars.py's VARNAME_GROUP, so "Physical" here means the same
    // thing it means everywhere else in the portal.
    const PHYSICAL_KEYWORDS = ["temperature", "salinity", "density", "depth", "dynamic height", "secchi", "forel"];
    const CHEMICAL_KEYWORDS = ["oxygen", "ph", "phosphate", "silicate", "nitrate", "nitrite", "ammonium",
      "alkalinity", "dissolved inorganic carbon", "carbonate"];
    if (PHYSICAL_KEYWORDS.some(k => n.includes(k))) return "Physical";
    if (CHEMICAL_KEYWORDS.some(k => n.includes(k))) return "Chemical";
    return ENTITY_TYPE_LABELS[v.entity_type] || "Other Measurements";
  }

  // Multiple variable_ids can share the same rendered label -- e.g. the
  // same measurement appearing under more than one dataset, or replicate
  // fields that collapse to one display name. groupVariablesByLabel()
  // already solves this for the search dropdown and inventory accordion;
  // reuse it here so the station panel shows one row per label instead of
  // a raw, undeduplicated list.
  const byType = {};
  groupVariablesByLabel(sciVars).forEach(entries => {
    const v = entries[0].v;
    const type = getDisplayType(v);
    if (!byType[type]) byType[type] = [];
    byType[type].push(v);
  });

  const TYPE_ORDER = ["Physical", "Chemical", "Productivity & Pigments", "Taxa", "Other Measurements", "Dataset"];

  const sciHTML = Object.keys(byType)
    .sort((a, b) => {
      const ai = TYPE_ORDER.indexOf(a);
      const bi = TYPE_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    })
    .map(type => {
      const sorted = byType[type].sort((a, b) =>
        (a.display_name || "").localeCompare(b.display_name || "")
      );
      return `
        <div class="var-type-label">${type}</div>
        ${sorted.map(v => {
          const rawLabel = (v.display_name === "All genera and species")
            ? "Zooplankton (All Genera & Species)"
            : v.display_name;
          const label = fixDisplayName(rawLabel);
          return `
            <div class="data-link" onclick='handleVariableClick("${v.variable_id}")'>
              <span class="data-link-name">${label}</span>
            </div>
          `;
        }).join("")}
      `;
    }).join("");

  // build dynamic metadata summary line
  const metaSummary = metaVars.length > 0
    ? `<div class="metadata-summary">
        📍 Also includes: ${metaVars.map(v => v.display_name.toLowerCase()).sort().join(", ")}
       </div>`
    : "";

  return sciHTML + metaSummary;
}

function openStation(station) {
  window.currentStation = station;
  document.getElementById("panel-empty").style.display = "none";
  document.getElementById("panel-header").style.display = "block";
  const backToInventory = document.getElementById("panel-back-inventory");
  if (backToInventory) {
    backToInventory.textContent = "← All Categories";
    backToInventory.onclick = () => resetPanelUI();
    backToInventory.style.display = "block";
  }
  document.getElementById("panel-station-id").textContent = `Station ${station.station_id}`;
  document.getElementById("panel-coords").textContent =
    `${station.lat.toFixed(4)}°N  ${Math.abs(station.lon).toFixed(4)}°W`;

  const panelContent = document.getElementById("panel-content");
  panelContent.classList.add("visible");

  const key = normalizeStationId(station.station_id);
  const stationVariables = window.stationVariableMap?.[key] || [];

  if (stationVariables.length === 0) {
    panelContent.innerHTML = `
      <div class="panel-empty-msg">No variables recorded at this station.</div>`;
    return;
  }

  const tabs = buildStationTabs(stationVariables);
  const tabNames = Object.keys(tabs);
  let activeTab = tabNames[0];

  function renderTabs() {
    panelContent.innerHTML = `
      <div class="tab-bar">
        ${tabNames.map(name => `
          <button class="tab-btn ${name === activeTab ? "active" : ""}"
            onclick="window._setStationTab('${name.replace(/'/g,"\'")}')">
            ${name}
          </button>
        `).join("")}
      </div>
      <div class="tab-content">
        ${renderStationTab(tabs[activeTab])}
      </div>
    `;
  }

  window._setStationTab = (name) => {
    activeTab = name;
    renderTabs();
  };

  renderTabs();
}

async function loadStations() {
  try {
    const res = await fetch("./data/stations.json");
    const data = await res.json();
    const stations = Array.isArray(data) ? data : data.stations || [];

    window.allStations = stations;
    window.stationMap = {};
    window.stationIdMap = {};

    const totalEl = document.getElementById('station-total');
    if (totalEl) totalEl.textContent = `${stations.length} CalCOFI Stations`;

    if (window.stationLayer) { map.removeLayer(window.stationLayer); }
    window.stationLayer = L.layerGroup().addTo(map);

    stations.forEach(station => {
      station.station_key = normalizeStationId(station.station_id);
      window.stationMap[station.station_key] = station;
      window.stationIdMap[station.station_id] = station;

      if (station.lat == null || station.lon == null) return;

      const marker = L.circleMarker([station.lat, station.lon], {
        radius: 10, color: "#00c2ff", fillOpacity: 0.7
      });

      marker.stationData = station;
      marker.bindTooltip(station.station_id, { direction: "top", offset: [0, -8], opacity: 0.9, sticky: true });

      marker.on("click", () => {
        // Safety net: if a variable search's yellow highlights are still
        // on the map but no variable is actively selected, clear them so
        // the map doesn't visually lag behind the panel's real state.
        if (!selectedVariable) clearHighlights();

        if (window.selectedStation?.marker) {
          restoreMarkerStyle(window.selectedStation.marker);
        }
        window.selectedStation = station;
        applySelectedStyle(station.marker);
        window.currentStation = station;

        if (selectedVariable) {
          // A variable is actively selected (via search/browse) -- the side
          // panel is showing that variable's info, which the person may
          // still be reading. Clicking a station shouldn't blow that away;
          // the popup already covers this station's value for it, so just
          // show that instead of also replacing the panel.
          const key = normalizeStationId(station.station_id);
          const stationVars = window.stationVariableMap?.[key] || [];

          if (selectedVariable.is_umbrella) {
            const matches = stationVars.filter(v =>
              selectedVariable.constituent_variable_ids.includes(v.variable_id));
            if (matches.length === 1) {
              openVariableModal(matches[0]);
            } else if (matches.length > 1) {
              openSourceChooser(matches, station, selectedVariable.display_name);
            }
            // matches.length === 0: station was highlighted via the union
            // but isn't in this particular constituent's real index -- do
            // nothing rather than show a misleading popup.
          } else {
            const hasVariable = stationVars.some(v => v.variable_id === selectedVariable.variable_id);
            if (hasVariable) {
              openVariableModal(selectedVariable);
            }
          }
        } else {
          // Browsing mode, no variable selected -- clicking a station opens
          // the full "everything monitored here" tabs panel, same as before.
          openStation(station);
        }
      });

      station.marker = marker;
      marker.addTo(window.stationLayer);
    });

  } catch (err) {
    console.error("Failed loading stations:", err);
  }
}

// Content keywords — checked FIRST, and these WIN even if the JSON already
// has a browse_group set for this variable. Some datasets (notably CUFES,
// and apparently the CTD/Hydrographic Cast dataset too) are mixed: they log
// biological counts AND underway weather/physical readings in the same
// table, but every row inherited one blanket browse_group value from the
// dataset itself. Trusting that blindly is why "Start Wind Speed" stayed
// under "Larval Fish & Eggs" and "Dry Bulb Temperature" stayed under
// "Physical Oceanography" even after the dataset-level fallback was fixed —
// the JSON's own browse_group was overriding the fallback entirely. This
// function returns null (no override) when the name doesn't clearly signal
// a specific category, so browse_group / dataset defaults still apply there.
function contentKeywordGroup(v) {
  const n = (v.display_name || v.variable_name || "").toLowerCase();
  if (n.includes("ph") && (n === "ph" || n.startsWith("ph ") || n.includes("ph replicate")))
    return "Carbonate system";
  if (["phosphate","silicate","nitrate","nitrite","ammonium"].some(k => n.includes(k)))
    return "Nutrients & chemistry";
  if (["chlorophyll","phaeopigment","c14","productivity","pigment"].some(k => n.includes(k)))
    return "Productivity & pigments";
  if (["alkalinity","dic","dissolved inorganic carbon","carbonate","pco2"].some(k => n.includes(k)))
    return "Carbonate system";
  if (["wind","wave","weather","cloud","visibility","bulb","atmospheric","pump speed"].some(k => n.includes(k)))
    return "Meteorology & sea state";
  if (["temperature","salinity","density","oxygen","o2","pressure","depth","secchi","forel","dynamic height"].some(k => n.includes(k)))
    return "Physical oceanography";
  return null;
}

// Dataset-level fallback — only used when contentKeywordGroup() above found
// no specific signal AND the JSON has no browse_group of its own.
function runtimeGroup(v) {
  const d = v.dataset_id || "";

  if (["erdCalCOFIlrvcnt","erdCalCOFIlrvsiz","erdCalCOFIlrvstg",
       "erdCalCOFIeggcnt","erdCalCOFIeggstg","erdCalCOFIinvcnt",
       "erdCalCOFIinvsiz","erdCalCOFItows","erdCalCOFIcufes"].includes(d))
    return "Larval fish & eggs";
  if (["zoodb","erdCalCOFIzoovol","nt620vn7810",
       "knb-lter-cce.188.4"].includes(d))
    return "Plankton";
  if (d === "euphausiid") return "Euphausiids (krill)";
  if (["CAC_FI_SBAS_obs","CAC_FI_SBAS_sp","knb-lter-cce.262.2"].includes(d))
    return "Seabirds & marine mammals";
  if (["555783","ruizt/marine-mammal-edna",
       "datazoo/catalogs/ccelter/datasets/159"].includes(d))
    return "Microbial & genomics";
  if (d === "gov.noaa.nodc:0301029") return "Carbonate system";
  if (["ctd-cast-files/","underway/"].includes(d))
    return "Raw data & external links";

  return "Other";
}

// -------------------------------------------------------
// FIX 1: loadVariables — do NOT overwrite station_ids
// from variables.json with stationGroups lookup.
// The data already has station_ids set correctly by
// the fixed build_vars.py. Just use it directly.
// -------------------------------------------------------
async function loadVariables() {
  try {
    const res = await fetch("./data/variables.json");
    const raw = await res.json();
    const variables = Array.isArray(raw) ? raw : raw.variables || [];

    window.allVariables = variables;
    window.variableMap = {};
    window.stationVariableMap = {};

    // FIX: build browse groups while we load
    window.browseGroups = {};
    window.datasetGroups = {};

    variables.forEach(v => {
      const variableId = (v.variable_id || `${v.dataset_id}::${v.variable_name}`)
        .trim().toLowerCase();
      v.variable_id = variableId;

      // FIX: use station_ids from the JSON directly.
      // Fall back to stationGroups only if station_ids is missing/empty
      // (handles old-format JSON without the fix applied yet).
      if (!v.station_ids || v.station_ids.length === 0) {
        v.station_ids = window.stationGroups?.[v.station_group] || [];
      }

      // build station → variables reverse index
      v.station_ids.forEach(id => {
        const key = normalizeStationId(id);
        if (!window.stationVariableMap[key]) {
          window.stationVariableMap[key] = [];
        }
        window.stationVariableMap[key].push(v);
      });

      window.variableMap[variableId] = v;

      // FIX 2: index by browse_group for the dropdown panel.
      // Content keywords win first (see contentKeywordGroup) even if the
      // JSON already has a browse_group — that's what actually fixes the
      // CUFES/CTD mixed-dataset miscategorization. Only fall through to
      // the JSON's own browse_group, then the dataset-level default, when
      // the variable's name gives no specific content signal.
      const group = contentKeywordGroup(v) || v.browse_group || runtimeGroup(v);
      if (!window.browseGroups[group]) window.browseGroups[group] = [];
      window.browseGroups[group].push(v);

      // Index by dataset too, for the "browse by dataset" view -- lets
      // someone start from "what does the Hydrographic Bottle dataset
      // measure?" instead of only from a subject category.
      if (!window.datasetGroups) window.datasetGroups = {};
      const dsKey = v.dataset_id || "unknown";
      if (!window.datasetGroups[dsKey]) {
        window.datasetGroups[dsKey] = { name: v.dataset_name || dsKey, variables: [] };
      }
      window.datasetGroups[dsKey].variables.push(v);
    });

    // render inventory panel (right side)
    // browse panel pills are hidden — inventory panel serves same purpose
    renderBrowsePanel(); // still builds data, just hidden via CSS
    renderInventoryPanel();

  } catch (err) {
    console.error("Failed loading variables:", err);
  }
}

// -------------------------------------------------------
// FIX 2: Browse panel — replaces blank-state UX
// Shows all parameter groups as clickable pills so users
// don't need to know a variable name to start exploring.
// -------------------------------------------------------
function renderBrowsePanel() {
  const container = document.getElementById('browse-panel');
  if (!container) return;

  const groups = window.browseGroups || {};

  // order: physical/chemical first, then biology, then taxa, then other
  const ORDER = [
    "Physical oceanography",
    "Chemical oceanography",
    "Meteorology",
    "Biology",
    "Euphausiids (krill)",
    "Zooplankton (ZooDB)",
    "QC / metadata",
    "Other",
  ];

  // hide internal/QC groups that aren't useful for browsing
  const HIDE_FROM_BROWSE = new Set(["QC / metadata", "Other"]);

  const sortedGroups = Object.keys(groups)
    .filter(g => !HIDE_FROM_BROWSE.has(g))
    .sort((a, b) => {
      const ai = ORDER.indexOf(a);
      const bi = ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

  container.innerHTML = `
    <div class="browse-label">Browse by category</div>
    <div class="browse-groups">
      ${sortedGroups.map(group => {
        const count = groups[group].length;
        return `
          <button class="browse-pill" onclick="openBrowseGroup('${group.replace(/'/g, "\\'")}')">
            ${group}
            <span class="browse-count">${count}</span>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

// Opens a browse group: shows dropdown pre-filtered to that group
function openBrowseGroup(groupName) {
  const vars = ((window.browseGroups || {})[groupName] || []).filter(v => !isExcludedFromBrowse(v));
  const dropdown = document.getElementById('dropdown');

  // mark the dropdown as showing a browse group (not a search)
  window.browseGroupActive = groupName;

  // populate dropdown with this group's variables
  dropdown.classList.add('open');
  dropdown.innerHTML = `
    <div class="dropdown-group-header">
      ${groupName} — ${vars.length} variables
      <button class="dropdown-close-btn" onclick="closeDropdown()">✕</button>
    </div>
    ${vars.slice(0, 300).map(v => {
      const rawLabel = (v.display_name === "All genera and species")
        ? "Zooplankton (All Genera & Species)"
        : v.display_name;
      const label = fixDisplayName(rawLabel);
      return `
        <div class="dropdown-item" data-id="${v.variable_id}">
          <div class="dropdown-name">
            ${label}
            <span style="color:var(--muted);margin-left:6px;font-size:10px;">
              | ${v.dataset_name || v.dataset_id}
              ${v.station_based ? "" : " | Underway/Transect"}
            </span>
          </div>
        </div>
      `;
    }).join("")}
    ${vars.length > 300 ? `<div class="dropdown-empty">Showing 300 of ${vars.length} — type to filter</div>` : ""}
  `;
}

// -------------------------------------------------------
// INVENTORY PANEL — shown in right panel when no station selected
// Lists all browse categories with counts, each row clickable
// -------------------------------------------------------

const CATEGORY_ICONS = {
  "Hydrography":                    "",
  "Water Chemistry":                "",
  "Primary Production":             "",
  "Dissolved Inorganic Carbon (DIC)": "",
  "Meteorology & Sea State":        "",
  "Fish Eggs & Larvae":             "",
  "Zooplankton":                    "",
  "Euphausiids (krill)":            "",
  "Genomics / eDNA":                "",
  "Seabirds & Marine Mammals":      "",
  "Raw Data & External Links":      "",
};

const HIDE_FROM_INVENTORY = new Set(["QC / metadata", "Other"]);


// Expands/collapses a category inline within the panel (accordion),
// instead of routing through the search dropdown. Search stays reserved
// for free-text typed queries; this is pure browse-and-choose.
function toggleInventoryGroup(groupName) {
  window.expandedInventoryGroup =
    (window.expandedInventoryGroup === groupName) ? null : groupName;
  renderInventoryPanel();
}

// Tracks which umbrella rows (labels backed by >1 dataset) have their
// per-dataset breakdown expanded. Collapsed by default -- the breakdown
// only appears once the person explicitly clicks the umbrella row's
// source toggle, rather than being shown open for every umbrella at once.
window.expandedUmbrellaKeys = window.expandedUmbrellaKeys || new Set();

function toggleUmbrellaSources(key, event) {
  if (event) event.stopPropagation();
  if (window.expandedUmbrellaKeys.has(key)) {
    window.expandedUmbrellaKeys.delete(key);
  } else {
    window.expandedUmbrellaKeys.add(key);
  }
  renderInventoryPanel();
}

function buildCategoryRows() {
  const groups = window.browseGroups || {};

  // ORDER uses current group names from browseGroups (old names until build_vars_v2.py runs)
  // After build_vars_v2.py runs these will update to CalCOFI.org aligned names
  const ALL_KEYS = Object.keys(groups).filter(g => !HIDE_FROM_INVENTORY.has(g));
  const PREFERRED_ORDER = [
    "Physical oceanography",
    "Nutrients & chemistry",
    "Productivity & pigments",
    "Carbonate system",
    "Meteorology & sea state",
    "Larval fish & eggs",
    "Plankton",
    "Zooplankton (ZooDB)",
    "Euphausiids (krill)",
    "Microbial & genomics",
    "Seabirds & marine mammals",
    "Raw data & external links",
    // New names after build_vars_v2.py runs:
    "Hydrography",
    "Water Chemistry",
    "Primary Production",
    "Dissolved Inorganic Carbon (DIC)",
    "Meteorology & Sea State",
    "Fish Eggs & Larvae",
    "Zooplankton",
    "Genomics / eDNA",
    "Seabirds & Marine Mammals",
    "Raw Data & External Links",
  ];
  const ORDER = [
    ...PREFERRED_ORDER.filter(g => ALL_KEYS.includes(g)),
    ...ALL_KEYS.filter(g => !PREFERRED_ORDER.includes(g))
  ];

  return ORDER
    .filter(g => groups[g] && !HIDE_FROM_INVENTORY.has(g))
    .map(g => {
      // Compute the real, filtered count up front (not the raw
      // groups[g].length) -- otherwise a category made up entirely of
      // excluded entries (e.g. dataset-level placeholder stubs like the
      // old Genomics/eDNA and Raw Data & External Links rows) still shows
      // a nonzero badge and an expandable row that opens to "No
      // parameters found." If nothing real is left after filtering, skip
      // the category entirely, same as the QC/metadata groups already do.
      const visibleVars = groups[g].filter(v => !isExcludedFromBrowse(v));
      const count = visibleVars.length;
      if (count === 0) return "";

      const icon = CATEGORY_ICONS[g] || "📊";
      const safeG = g.replace(/'/g, "\\'");
      const isOpen = window.expandedInventoryGroup === g;
      const arrow = isOpen ? "↓" : "→";

      const groupedSubVars = isOpen
        ? groupVariablesByLabel(visibleVars)
        : [];

      // Zooplankton-specific ordering: lead with the community-wide "All
      // Genera & Species" entry, then individual zoodb species
      // alphabetically, and push the handful of non-species datasets
      // (zooplankton biovolume, phytoplankton visual estimates, Dungeness
      // crab postlarvae, Stanford zooplankton data) to the bottom -- they
      // aren't part of the same species list and were otherwise just
      // appearing first by accident of insertion order in variables.json.
      if (g === "Zooplankton" && isOpen) {
        const tier = (entries) => {
          const { v, rawLabel } = entries[0];
          if (v.dataset_id === "zoodb" && rawLabel === "All genera and species") return 0;
          if (v.dataset_id === "zoodb") return 1;
          return 2;
        };
        groupedSubVars.sort((a, b) => {
          const ta = tier(a), tb = tier(b);
          if (ta !== tb) return ta - tb;
          return fixDisplayName(a[0].rawLabel).localeCompare(fixDisplayName(b[0].rawLabel));
        });
      }

      const subItems = isOpen
        ? groupedSubVars.map(entries => {
            const { v: firstV, rawLabel } = entries[0];
            const label = fixDisplayName(rawLabel);
            const datasetNames = [...new Set(entries.map(e => e.v.dataset_name || e.v.provider || e.v.dataset_id))];
            const umbrella = entries.length > 1 ? buildUmbrellaVariable(entries, label) : null;

            const countBadgeFor = (v) => (typeof v.sighting_count === "number")
              ? `<span class="inventory-subitem-count">${v.sighting_count.toLocaleString()} sighted</span>`
              : (typeof v.tow_occurrence_count === "number")
              ? `<span class="inventory-subitem-count">${v.tow_occurrence_count.toLocaleString()} of ${v.total_tows_surveyed.toLocaleString()} tows</span>`
              : "";

            if (!umbrella) {
              // Single dataset behind this label -- unchanged from before.
              return `
                <div class="inventory-subitem" onclick='event.stopPropagation(); selectVariable("${firstV.variable_id}")'>
                  <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">
                    <span class="inventory-subitem-name">${label}</span>
                    ${countBadgeFor(firstV)}
                  </div>
                  <span class="inventory-subitem-meta">${datasetNames.join("; ")}</span>
                </div>
              `;
            }

            // Multiple datasets share this label -- clicking the label
            // itself only expands/collapses the per-dataset breakdown.
            // It intentionally does NOT navigate to the map: showing the
            // umbrella's unioned view left it unclear which dataset the
            // map/slider was actually reflecting, so a specific dataset
            // must be chosen below before anything renders.
            const umbrellaKey = `${safeG}::${label}`.replace(/'/g, "\\'");
            const sourcesOpen = window.expandedUmbrellaKeys.has(umbrellaKey);

            const subLinks = sourcesOpen
              ? `<div class="inventory-sublinks">${entries.map(({ v }, i) => `
                  ${i > 0 ? '<div class="inventory-sublink-divider"></div>' : ''}
                  <div class="inventory-subitem inventory-subitem-nested" onclick='event.stopPropagation(); selectVariable("${v.variable_id}")'>
                    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">
                      <span class="inventory-subitem-name">${v.dataset_name || v.dataset_id}</span>
                      ${countBadgeFor(v)}
                    </div>
                  </div>
                `).join("")}</div>`
              : "";

            return `
              <div class="inventory-subitem" onclick='toggleUmbrellaSources("${umbrellaKey}", event)'>
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                  <span class="inventory-subitem-name">${label}</span>
                  <span class="inventory-umbrella-caret">${sourcesOpen ? '▾' : '▸'}</span>
                </div>
              </div>
              ${subLinks}
            `;
          }).join("")
        : "";

      const subList = isOpen
        ? `<div class="inventory-sublist">${subItems || '<div style="color:var(--muted);padding:8px 12px;font-size:11px;">No parameters found.</div>'}</div>`
        : "";

      return `
        <div class="inventory-row${isOpen ? ' inventory-row-open' : ''}" onclick="toggleInventoryGroup('${safeG}')">
          <span class="inventory-icon">${icon}</span>
          <span class="inventory-label">${toTitleCase(g)}</span>
          <span class="inventory-count">${count}</span>
          <span class="inventory-arrow">${arrow}</span>
        </div>
        ${subList}
      `;
    }).join("");
}

// -------------------------------------------------------
// "Browse by dataset" view -- same accordion pattern as categories,
// but the top-level grouping is the source dataset itself (e.g. "CalCOFI
// SIO Hydrographic Bottle Data") instead of a subject category. Answers
// "what does THIS dataset measure?" directly, which the category view
// can't: a dataset's parameters are often scattered across several
// categories there (e.g. Hydrographic Bottle contributes to Physical
// Oceanography, Water Chemistry, and Primary Production all at once).
// -------------------------------------------------------
window.expandedInventoryDataset = window.expandedInventoryDataset || null;

function toggleInventoryDataset(datasetId) {
  window.expandedInventoryDataset =
    (window.expandedInventoryDataset === datasetId) ? null : datasetId;
  renderInventoryPanel();
}

function buildDatasetRows() {
  const datasets = window.datasetGroups || {};

  const sortedIds = Object.keys(datasets).sort((a, b) =>
    (datasets[a].name || a).localeCompare(datasets[b].name || b));

  return sortedIds
    .map(dsId => {
      const ds = datasets[dsId];

      // Same visibility rule as the category view: a variable only
      // counts as a real measured parameter if it isn't excluded by name
      // AND its computed group isn't QC/metadata (identifiers, timestamps,
      // coordinate fields, ship/cruise bookkeeping -- real columns in the
      // source table, but not something anyone is "measuring").
      const visibleVars = ds.variables.filter(v =>
        !isExcludedFromBrowse(v) &&
        !HIDE_FROM_INVENTORY.has(contentKeywordGroup(v) || v.browse_group || runtimeGroup(v)));
      const count = visibleVars.length;
      if (count === 0) return "";

      const isOpen = window.expandedInventoryDataset === dsId;
      const arrow = isOpen ? "↓" : "→";
      const safeId = dsId.replace(/'/g, "\\'");
      const anyUnderway = visibleVars.some(v => !v.station_based);

      const subItems = isOpen
        ? (() => {
            // Group by the same stripped label groupVariablesByLabel/
            // fixDisplayName use for cross-dataset merging. Within a
            // single dataset that stripping can collapse genuinely
            // different columns to one label (e.g. "C14 Assimilation of
            // replicate 1" / "...replicate 2" both -> "C14 Assimilation").
            // There's no cross-dataset ambiguity to resolve here, so when
            // that happens each row falls back to its fuller, un-stripped
            // label instead of silently looking like a repeated entry.
            const grouped = {};
            visibleVars.forEach(v => {
              const rawLabel = v.display_name === "All genera and species"
                ? "Zooplankton (All Genera & Species)"
                : v.display_name;
              const baseLabel = fixDisplayName(rawLabel);
              if (!grouped[baseLabel]) grouped[baseLabel] = [];
              grouped[baseLabel].push({ v, rawLabel });
            });

            const rows = [];
            Object.values(grouped).forEach(entries => {
              entries.forEach(({ v, rawLabel }) => {
                const label = entries.length > 1 ? fullVariableLabel(rawLabel) : fixDisplayName(rawLabel);
                rows.push({ v, label });
              });
            });

            return rows
              .sort((a, b) => a.label.localeCompare(b.label))
              .map(({ v, label }) => {
                const countBadge = (typeof v.sighting_count === "number")
                  ? `<span class="inventory-subitem-count">${v.sighting_count.toLocaleString()} sighted</span>`
                  : (typeof v.tow_occurrence_count === "number")
                  ? `<span class="inventory-subitem-count">${v.tow_occurrence_count.toLocaleString()} of ${v.total_tows_surveyed.toLocaleString()} tows</span>`
                  : "";
                return `
                  <div class="inventory-subitem" onclick='event.stopPropagation(); selectVariable("${v.variable_id}")'>
                    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">
                      <span class="inventory-subitem-name">${label}</span>
                      ${countBadge}
                    </div>
                  </div>
                `;
              }).join("");
          })()
        : "";

      const subList = isOpen
        ? `<div class="inventory-sublist">${subItems || '<div style="color:var(--muted);padding:8px 12px;font-size:11px;">No parameters found.</div>'}</div>`
        : "";

      return `
        <div class="inventory-row${isOpen ? ' inventory-row-open' : ''}" onclick="toggleInventoryDataset('${safeId}')">
          <span class="inventory-label">
            ${toTitleCase(ds.name || dsId)}
            ${anyUnderway ? '<span class="inventory-subitem-meta" style="display:inline;margin-left:6px;">Underway/Transect</span>' : ''}
          </span>
          <span class="inventory-count">${count}</span>
          <span class="inventory-arrow">${arrow}</span>
        </div>
        ${subList}
      `;
    }).join("");
}

window.inventoryViewMode = window.inventoryViewMode || "category";

function setInventoryViewMode(mode) {
  if (window.inventoryViewMode === mode) return;
  window.inventoryViewMode = mode;
  // Switching views starts from a clean slate rather than carrying over
  // an expanded row from the other view (its key namespace doesn't match).
  window.expandedInventoryGroup = null;
  window.expandedInventoryDataset = null;
  renderInventoryPanel();
}

function renderInventoryPanel() {
  const empty = document.getElementById("panel-empty");
  if (!empty) return;

  const mode = window.inventoryViewMode || "category";
  const rows = mode === "dataset" ? buildDatasetRows() : buildCategoryRows();

  const subtitle = mode === "dataset"
    ? "Click a dataset below to see every parameter it measures, or click any station on the map to see everything measured there"
    : "Click a category below to see which stations record it, or click any station on the map to see everything measured there";

  empty.innerHTML = `
    <div class="inventory-panel">
      <div class="inventory-title">WHAT CALCOFI MEASURES</div>
      <div class="inventory-subtitle">${subtitle}</div>
      <div class="inventory-view-tabs">
        <button class="inventory-view-tab${mode === "category" ? " inventory-view-tab-active" : ""}" onclick="setInventoryViewMode('category')">By Category</button>
        <button class="inventory-view-tab${mode === "dataset" ? " inventory-view-tab-active" : ""}" onclick="setInventoryViewMode('dataset')">By Dataset</button>
      </div>
      <div class="inventory-list">
        ${rows || '<div style="color:var(--muted);padding:12px;">Loading...</div>'}
      </div>
    </div>
  `;
}

// -------------------------------------------------------
// Search dropdown (unchanged logic, improved rendering)
// -------------------------------------------------------
const searchInput = document.getElementById('search');
const dropdown = document.getElementById('dropdown');

dropdown.addEventListener("mousedown", (e) => {
  clearAll();
  const item = e.target.closest(".dropdown-item");
  if (!item) return;
  selectVariable(item.dataset.id);
  closeDropdown();
});

searchInput.addEventListener('focus', () => {
  // if a browse group is already showing, don't override it
  if (window.browseGroupActive) return;
  // Previously this opened with a default ~100-item list the instant the
  // (empty) search box was focused -- clicking in was enough to dump a
  // huge dropdown before typing anything. Only open once there's an
  // actual query; browsing everything is already covered by the category
  // inventory panel, so this isn't losing functionality, just clutter.
  const query = searchInput.value.trim();
  if (!query) return;
  openDropdown();
  renderDropdown(query);
});

searchInput.addEventListener('input', () => {
  dropdownFocusIdx = -1;
  window.browseGroupActive = null; // user is typing, leave browse mode
  const query = searchInput.value.trim();
  if (!query) { closeDropdown(); return; }
  openDropdown();
  renderDropdown(query);
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

// Close dropdown when clicking anywhere outside search area
// but NOT when clicking browse pills or inventory rows (they open the dropdown)
document.addEventListener("click", (e) => {
  const searchBar = document.querySelector(".search-bar");
  const browsePanel = document.getElementById("browse-panel");
  const inventoryPanel = document.querySelector(".inventory-panel");
  const isInsideSearch = searchBar?.contains(e.target);
  const isInsideBrowse = browsePanel?.contains(e.target);
  const isInsideInventory = inventoryPanel?.contains(e.target);
  if (!isInsideSearch && !isInsideBrowse && !isInsideInventory) {
    closeDropdown();
    window.browseGroupActive = null;
  }
});

// Variables to hide from browse/search — QC, metadata, cruise admin fields
const EXCLUDE_DISPLAY_KEYWORDS = [
  // Cruise / admin
  "cruise", "ship name", "ship code", "cast id", "bottle number",
  "bottle identifier", "cast count", "bottle count",
  "julian", "quarter", "order occupied", "data type", "leg",
  "time zone", "twilight", "incubation", "gis_key", "idnum",
  // Coordinates / time
  "latitude", "longitude", "start latitude", "start longitude",
  "start time", "end time", "stop time", "sample number",
  // Quality / flags
  "quality", " quality", "q_", "flag",
  // Tow / net metadata
  "tow type", "tow number", "net location", "net type",
  "standard haul factor", "haul factor", "calcofi line", "calcofi station",
  "wire angle", "wire volume", "wire length",
  "time of", "sorting code", "preserved",
  // Standalone time/date
  "volume sampled",
  // Taxonomic/QC identifiers — not a measurable parameter
  "itis tsn", "calcofi species code", "proportion sorted",
  // pH already has its own clean field; the un-numbered "Replicate"
  // variant isn't caught by the Replicate-N merge logic and would
  // otherwise show as a confusing near-duplicate
  "ph replicate",
];

function isExactExclude(displayName) {
  const n = (displayName || "").toLowerCase().trim();
  const EXACT_EXCLUDE = new Set(["time", "date"]);
  return EXACT_EXCLUDE.has(n);
}

// Raw log/reference-table columns from the seabird datasets that are
// redundant now that seabird_observations_underway provides real
// per-species entries (Sooty Shearwater, Common Murre, etc. with actual
// sighting counts). "species"/"behavior" are single generic columns on
// the raw observation log (not one row per species), and "type"/
// "common_name"/"scientific_name" are columns on the species lookup
// table -- neither is a measured parameter in its own right anymore.
const EXCLUDE_VARIABLE_IDS = new Set([
  "cac_fi_sbas_obs::behavior",
  "cac_fi_sbas_obs::species",
  "cac_fi_sbas_sp::species",
  "cac_fi_sbas_sp::type",
  "cac_fi_sbas_sp::common_name",
  "cac_fi_sbas_sp::scientific_name",
]);

function isExcludedFromBrowse(v) {
  const n = (v.display_name || "").toLowerCase();
  return isExactExclude(v.display_name) ||
    EXCLUDE_DISPLAY_KEYWORDS.some(k => n.includes(k)) ||
    isMetadataField(v.display_name) ||
    isRemovedField(v.display_name) ||
    EXCLUDE_VARIABLE_IDS.has((v.variable_id || "").toLowerCase()) ||
    // NOTE: only these two specific dataset_ids -- not every entity_type
    // "scientific_dataset" stub (see the earlier comment history on this
    // function for why that blanket approach was wrong). Both of these
    // are genuine duplicates, now that real per-species data exists for
    // the same underlying dataset:
    //  - "/euphausiid/save.php?mode=save": superseded by "euphausiid"
    //    (39 species, real station coverage)
    //  - "knb-lter-cce.262.2": superseded by
    //    "marine_mammal_sightings_underway" (23 species, real sighting
    //    counts) -- same LTER package 262, just broken out by species
    v.dataset_id === "/euphausiid/save.php?mode=save" ||
    v.dataset_id === "knb-lter-cce.262.2";
}

// Shared by search dropdown AND the category accordion: groups variables
// by their exact final rendered label. Different labels (e.g. "Salinity"
// vs "Reported Salinity") stay separate on purpose — they may be genuinely
// different columns, not just duplicates. Only variables that render to
// the SAME label (e.g. "Oxygen" from both the Hydrographic Bottle dataset
// and the Additional CTD dataset) get grouped together, one entry per
// unique label, each carrying the full list of source datasets.
function groupVariablesByLabel(vars) {
  const grouped = {};
  vars.forEach(v => {
    const rawLabel = (v.display_name === "All genera and species")
      ? "Zooplankton (All Genera & Species)"
      : v.display_name;
    const baseLabel = fixDisplayName(rawLabel);
    if (!grouped[baseLabel]) grouped[baseLabel] = [];
    grouped[baseLabel].push({ v, rawLabel });
  });
  return Object.values(grouped);
}

// When a label is shared across multiple datasets (e.g. "Oxygen" from both
// siocalcofiHydroBottle in µmol/kg and erdCalCOFINOAAhydros in mL/L), a
// single click can only ever open one of them -- silently hiding the
// other's data even though the search/browse UI lists both dataset names.
// This builds a synthetic "umbrella" variable representing the union of
// all contributing datasets' station coverage, for browsing/highlighting
// purposes only. It is NOT a real measurement and carries no single value
// of its own -- selecting a specific station still routes to (or, when
// more than one contributor applies, offers a choice between) the real
// underlying variables, never blends their values together. Returns null
// if the group is all one dataset (nothing to do -- existing behavior,
// entries[0], is already correct and unambiguous).
function buildUmbrellaVariable(entries, label) {
  const constituents = entries.map(e => e.v);
  const datasetIds = [...new Set(constituents.map(v => v.dataset_id))];
  if (datasetIds.length <= 1) return null;

  const stationIdSet = new Set();
  constituents.forEach(v => (v.station_ids || []).forEach(id => stationIdSet.add(id)));

  const hasAnyStationYears = constituents.some(v => v.station_years && Object.keys(v.station_years).length > 0);
  let stationYears = null;
  if (hasAnyStationYears) {
    stationYears = {};
    constituents.forEach(v => {
      if (!v.station_years) return;
      Object.entries(v.station_years).forEach(([sid, years]) => {
        if (!stationYears[sid]) stationYears[sid] = [];
        years.forEach(y => { if (!stationYears[sid].includes(y)) stationYears[sid].push(y); });
      });
    });
  }

  let firstYear, lastYear;
  if (stationYears) {
    const allYears = Object.values(stationYears).flat().map(y => parseInt(y, 10));
    if (allYears.length) {
      firstYear = String(Math.min(...allYears));
      lastYear = String(Math.max(...allYears));
    }
  }

  const base = constituents[0];
  const units = [...new Set(constituents.map(v => v.units).filter(Boolean))];
  const safeLabel = label.replace(/"/g, "'");

  const umbrella = {
    variable_id: `umbrella::${safeLabel}`,
    is_umbrella: true,
    constituent_variable_ids: constituents.map(v => v.variable_id),
    display_name: safeLabel,
    variable_name: safeLabel,
    dataset_id: null,
    dataset_name: [...new Set(constituents.map(v => v.dataset_name || v.dataset_id))].join(" + "),
    description: base.description || "",
    // Joining distinct units (rather than picking one) is deliberate: if
    // the contributing datasets disagree on units, that's exactly the kind
    // of thing that should be visible here, not hidden by only showing one.
    units: units.join(" / "),
    entity_type: base.entity_type,
    station_based: true,
    station_ids: [...stationIdSet],
    browse_group: base.browse_group,
  };
  if (stationYears) {
    umbrella.station_years = stationYears;
    umbrella.first_year = firstYear;
    umbrella.last_year = lastYear;
  }

  // Register immediately so selectVariable(umbrella.variable_id) -- fired
  // from the onclick handlers that create these on the fly -- can find it
  // via the same window.variableMap lookup real variables already use.
  if (window.variableMap) window.variableMap[umbrella.variable_id] = umbrella;

  return umbrella;
}

function renderDropdown(searchTerm = "") {
  const vars = window.allVariables || [];
  const list = document.getElementById("dropdown");
  if (!list) return;

  const filtered = searchTerm
    ? vars.filter(v => {
        if (isExcludedFromBrowse(v)) return false;
        // Search against both original name AND fixed display name (includes common names)
        const fixedName = fixDisplayName(v.display_name || "");
        const text = (
          (v.display_name || "") + " " +
          fixedName + " " +
          (v.keywords || []).join(" ")
        ).toLowerCase();
        return text.includes(searchTerm.toLowerCase());
      })
    : vars.filter(v => v.station_based && !isExcludedFromBrowse(v)).slice(0, 100);

  list.classList.add("open");

  if (filtered.length === 0) {
    list.innerHTML = `<div class="dropdown-empty">No variables found</div>`;
    return;
  }

  // Group by the exact rendered label — see groupVariablesByLabel() above.
  const VAGUE_LABELS = new Set(["species", "count", "type", "behavior", "common_name", "scientific_name"]);
  const groups = groupVariablesByLabel(filtered.slice(0, 200));

  list.innerHTML = groups.map(entries => {
    const { v: firstV, rawLabel } = entries[0];
    const baseLabel = fixDisplayName(rawLabel);
    const datasetPrefix = VAGUE_LABELS.has(rawLabel.toLowerCase()) && firstV.dataset_name
      ? firstV.dataset_name.replace("CalCOFI Farallon Institute ", "").replace("CalCOFI NOAA ", "") + " — "
      : "";
    const label = datasetPrefix + baseLabel;

    // combine dataset names across every entry that shares this exact label
    const datasetNames = [...new Set(entries.map(e => e.v.dataset_name || e.v.provider || e.v.dataset_id))];
    const anyUnderway = entries.some(e => !e.v.station_based);
    const umbrella = entries.length > 1 ? buildUmbrellaVariable(entries, baseLabel) : null;

    const mainRow = `
      <div class="dropdown-item" data-id="${umbrella ? umbrella.variable_id : firstV.variable_id}">
        <div class="dropdown-name">
          ${label}
          <span style="color:var(--muted);margin-left:6px;font-size:10px;">
            | ${datasetNames.join("; ")}
            ${anyUnderway ? " | Underway/Transect" : ""}
          </span>
        </div>
      </div>
    `;

    // Per-dataset sub-rows only when there's genuinely more than one
    // dataset behind this label -- clicking one behaves exactly like a
    // normal single-dataset selection always has, no ambiguity. The
    // umbrella row above them represents their union for browsing/map
    // purposes only, never a blended value.
    const subRows = umbrella
      ? entries.map(({ v }) => `
          <div class="dropdown-item dropdown-subitem" data-id="${v.variable_id}">
            <div class="dropdown-name" style="font-size:11px;color:var(--muted);padding-left:14px;">
              └ ${v.dataset_name || v.dataset_id}
            </div>
          </div>
        `).join("")
      : "";

    return mainRow + subRows;
  }).join("");
}

function updateDropdownFocus(items) {
  items.forEach((el, i) => el.classList.toggle('focused', i === dropdownFocusIdx));
  if (items[dropdownFocusIdx]) items[dropdownFocusIdx].scrollIntoView({ block: 'nearest' });
}

function openDropdown() { dropdown.classList.add('open'); }
function closeDropdown() {
  dropdown.classList.remove('open');
  dropdownFocusIdx = -1;
  window.browseGroupActive = null;
}

document.getElementById("dropdown").addEventListener("mousedown", (e) => {
  const item = e.target.closest(".dropdown-item");
  if (!item) return;
  const id = item.dataset.id;
  const selected = (window.allVariables || []).find(v => v.variable_id === id);
  if (selected) {
    selectVariable(selected.variable_id);
    closeDropdown();
  }
});

// marker styles
function styleDefaultStation(marker) {
  marker.setStyle({ radius: 10, fillColor: "#00c2ff", color: "#0d7aad", weight: 2, fillOpacity: 0.7 });
}

function darkenColor(hex, factor = 0.65) {
  if (!hex) return hex;
  hex = hex.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const darkened = [Math.floor(r * factor), Math.floor(g * factor), Math.floor(b * factor * factor)];
  return "#" + darkened.map(v => v.toString(16).padStart(2, "0")).join("");
}

function applySelectedStyle(marker) {
  const currentStyle = marker.options;
  marker._previousStyle = {
    fillColor: currentStyle.fillColor,
    color: currentStyle.color,
    radius: currentStyle.radius,
    weight: currentStyle.weight,
    fillOpacity: currentStyle.fillOpacity
  };
  marker.setStyle({
    fillColor: darkenColor(currentStyle.fillColor),
    color: darkenColor(currentStyle.color || "#ffffff"),
    radius: (currentStyle.radius || 6) + 1,
    weight: (currentStyle.weight || 1.5) + 1
  });
}

function restoreMarkerStyle(marker) {
  if (!marker?._previousStyle) return;
  marker.setStyle(marker._previousStyle);
  delete marker._previousStyle;
}

function selectVariable(variableId) {
  const v = window.variableMap?.[variableId] || window.allVariables.find(v => v.variable_id === variableId);
  if (!v) return;

  selectedVariable = v;
  searchInput.value = fixDisplayName(v.display_name || "");
  closeDropdown();

  // hide browse panel when a variable is selected
  const browsePanel = document.getElementById('browse-panel');
  if (browsePanel) browsePanel.style.display = 'none';

  highlightStations(v);
  document.getElementById('clear-btn').classList.add('visible');
  renderYearSlider(v);

  const banner = document.getElementById('search-banner');
  // When per-station year data exists, it's the authoritative record of
  // which stations actually have confirmed data for this variable (see
  // highlightStations) -- station_ids alone may be a broader nominal grid.
  const isUnconfirmedTaxon = isUnconfirmedZooDBTaxon(v);
  const hasRealStationData =
    v.station_years && Object.keys(v.station_years).length > 0;
  const stationCount = isUnconfirmedTaxon
    ? 0
    : hasRealStationData
    ? Object.keys(v.station_years).length
    : (v.station_ids?.length || 0);

  if (isUnconfirmedTaxon) {
    banner.textContent =
      `No confirmed station-level records yet for "${fixDisplayName(v.display_name)}" -- awaiting a species-level data export`;
    banner.classList.add('visible');
    openVariableModal(v);
    return;
  }

  if (!v.station_based || stationCount === 0) {
    // non-station-based: show modal directly, no map highlight
    banner.textContent = `"${v.display_name}" is not collected at fixed stations`;
    banner.classList.add('visible');
    openVariableModal(v);
    return;
  }

  banner.textContent = `${stationCount} station${stationCount === 1 ? '' : 's'} collect ${fixDisplayName(v.display_name)}`;
  banner.classList.add('visible');

  renderVariableSelectionPanel(v);
}

// Shared by both variable-detail views (station-based panel and the modal):
// shows real observed-year range and, when notable, which specific years
// within the survey window had zero records for this species.
function yearRangeHtml(v) {
  if (!v.first_year) return "";
  const totalYears = v.n_years_surveyed || null;
  const observedYears = v.n_years_observed || (v.years_observed ? v.years_observed.length : null);
  const summary = totalYears
    ? `Observed in ${observedYears} of ${totalYears} surveyed years (${v.first_year}-${v.last_year})`
    : `Observed ${v.first_year}-${v.last_year}`;
  const missing = v.years_not_observed || [];
  const gapNote = (missing.length > 0 && missing.length <= 6)
    ? `<div style="color:var(--muted);font-size:10px;margin-top:2px;">Not recorded in: ${missing.join(", ")}</div>`
    : "";
  return `<div style="color:var(--muted);font-size:10px;margin-top:2px;">${summary}</div>${gapNote}`;
}

function renderVariableSelectionPanel(v) {
  const content = document.getElementById('panel-content');
  document.getElementById('panel-empty').style.display = 'none';
  document.getElementById('panel-header').style.display = 'block';
  document.getElementById('panel-station-id').textContent = fixDisplayName(v.display_name);
  document.getElementById('panel-coords').textContent = 'Select a highlighted station';
  content.classList.add('visible');

  // Single header back-button: point it at the station if we came from
  // one, otherwise back to the category list. No second button in content.
  const backBtn = document.getElementById('panel-back-inventory');
  if (backBtn) {
    if (window.currentStation) {
      backBtn.textContent = `← Back to Station ${window.currentStation.station_id}`;
      backBtn.onclick = () => openStation(window.currentStation);
    } else {
      backBtn.textContent = '← All Categories';
      backBtn.onclick = () => resetPanelUI();
    }
    backBtn.style.display = 'block';
  }

  // Each stat below is independent -- a variable can have any subset of
  // these (a ZooDB community entry has mean_abundance but no
  // tow_occurrence_count; a euphausiid species has tow_occurrence_count
  // but no sighting_count; etc). Previously this was an if/else-if
  // chain, which meant mean_abundance (ZooDB) only rendered when
  // tow_occurrence_count (euphausiid-only) was ALSO present -- so it
  // silently never showed for ZooDB at all, even with real data.
  const countLineParts = [
    typeof v.sighting_count === "number"
      ? `<span class="panel-highlight"><b>${v.sighting_count.toLocaleString()}</b> sightings recorded</span><br>`
      : "",
    typeof v.tow_occurrence_count === "number"
      ? `<span class="panel-highlight">Present in <b>${v.tow_occurrence_count.toLocaleString()}</b> of ${v.total_tows_surveyed.toLocaleString()} tows</span><br>`
      : "",
    typeof v.cumulative_abundance === "number"
      ? `<span class="panel-subtext">Cumulative abundance: ${v.cumulative_abundance.toLocaleString()} per m² &mdash; Brinton &amp; Townsend Euphausiid Database</span><br>`
      : "",
    typeof v.mean_abundance_when_present === "number"
      ? `<span class="panel-subtext">Mean density when present: ${v.mean_abundance_when_present.toLocaleString()} per m² (max recorded: ${v.max_abundance_recorded.toLocaleString()}) &mdash; Brinton &amp; Townsend Euphausiid Database</span><br>`
      : "",
    typeof v.mean_abundance === "number"
      ? `<span class="panel-subtext">Mean community abundance: ${v.mean_abundance.toLocaleString()} per m² (max recorded: ${v.max_abundance_recorded.toLocaleString()}) &mdash; CalCOFI ZooDB</span><br>`
      : "",
    v.data_note ? `<span class="panel-subtext panel-subtext-muted">${v.data_note}</span><br>` : "",
    yearRangeHtml(v),
    v.taxonomy_note ? `<span class="panel-subtext">${v.taxonomy_note}</span><br>` : "",
  ].filter(Boolean);

  const countLine = countLineParts.length ? countLineParts.join("\n       ") + "<br>" : "";


  const stationCount = (v.station_years && Object.keys(v.station_years).length > 0)
    ? Object.keys(v.station_years).length
    : (v.station_ids?.length || 0);

  content.innerHTML = `
    <div class="panel-info-block">
      <b>Dataset:</b> ${v.dataset_name || ''}<br><br>
      <b>Description:</b> ${v.description || 'No description available.'}<br><br>
      ${v.units ? `<b>Units:</b> ${v.units}<br><br>` : ''}
      ${countLine}
      <span class="panel-station-count">
        Collected at ${stationCount} station${stationCount === 1 ? '' : 's'}
      </span>
      <span class="panel-hint">
        ${v.is_umbrella
          ? 'Click a highlighted station -- if it has more than one source for this, you\'ll be asked which to view'
          : 'Click a highlighted station on the map to open the data portal'}
      </span>
      ${v.is_umbrella ? '' : `
      <a href="${getDatasetUrl(v)}" target="_blank" rel="noopener noreferrer" class="panel-open-dataset-btn">
        Open Dataset ↗
      </a>`}
    </div>
  `;
}

function resetPanelUI() {
  const header = document.getElementById('panel-header');
  if (header) header.style.display = 'none';
  document.getElementById('panel-station-id').textContent = '';
  document.getElementById('panel-coords').textContent = '';
  const content = document.getElementById('panel-content');
  if (content) { content.classList.remove('visible'); content.innerHTML = ''; }
  const empty = document.getElementById('panel-empty');
  if (empty) {
    empty.style.display = 'flex';
    renderInventoryPanel(); // restore inventory when panel resets
  }
  selectedVariable = null;
  window.currentStation = null;
  document.getElementById('clear-btn')?.classList.remove('visible');
  const banner = document.getElementById('search-banner');
  if (banner) { banner.classList.remove('visible'); banner.textContent = ''; }
}

function renderYearSlider(v) {
  const container = document.getElementById('year-slider');
  if (!container) return;

  // Only station-based variables with real per-station year data can be
  // filtered on the map -- everything else (marine mammals, seabirds) has
  // no discrete station markers to filter, so hide the slider for those.
  if (!v.station_years || !v.first_year || !v.last_year) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  const min = parseInt(v.first_year, 10);
  const max = parseInt(v.last_year, 10);

  container.style.display = 'flex';
  container.innerHTML = `
    <div class="year-slider-row">
      <span class="year-slider-label" id="year-slider-start-label">${min}</span>
      <div class="year-range-track">
        <div class="year-range-bg"></div>
        <div class="year-range-fill" id="year-range-fill"></div>
        <input type="range" id="year-slider-start" min="${min}" max="${max}" value="${min}" step="1">
        <input type="range" id="year-slider-end" min="${min}" max="${max}" value="${max}" step="1">
      </div>
      <span class="year-slider-label" id="year-slider-end-label">${max}</span>
      <button class="year-slider-reset" id="year-slider-reset" title="Reset to full range">Reset</button>
    </div>
  `;

  const startInput = document.getElementById('year-slider-start');
  const endInput = document.getElementById('year-slider-end');
  const startLabel = document.getElementById('year-slider-start-label');
  const endLabel = document.getElementById('year-slider-end-label');
  const fill = document.getElementById('year-range-fill');
  const resetBtn = document.getElementById('year-slider-reset');

  // Two overlapping range inputs share one visible track. Each keeps its
  // own value; we just clamp so the handle being dragged can't cross the
  // other one, and redraw the highlighted segment between them.
  function updateFill(s, e) {
    const pctS = ((s - min) / (max - min)) * 100;
    const pctE = ((e - min) / (max - min)) * 100;
    fill.style.left = pctS + '%';
    fill.style.width = (pctE - pctS) + '%';
    startLabel.textContent = s;
    endLabel.textContent = e;
  }

  function applyFilter(movedStart) {
    let s = parseInt(startInput.value, 10);
    let e = parseInt(endInput.value, 10);
    if (s > e) {
      if (movedStart) { s = e; startInput.value = s; }
      else { e = s; endInput.value = e; }
    }
    updateFill(s, e);
    highlightStations(v, [s, e]);
    updateBanner(s, e);
  }

  // Keep the banner text in sync with the slider -- it used to say e.g.
  // "91 stations collect Salinity" no matter where the handles were,
  // which was misleading once the map was actually showing a filtered
  // subset. Count mirrors highlightStations' own year-overlap logic so
  // the number always matches what's really highlighted.
  const banner = document.getElementById('search-banner');
  const fullCount = Object.keys(v.station_years).length;
  function updateBanner(s, e) {
    if (!banner) return;
    const name = fixDisplayName(v.display_name);
    if (s === min && e === max) {
      banner.textContent = `${fullCount} station${fullCount === 1 ? '' : 's'} collect ${name}`;
      return;
    }
    const count = Object.values(v.station_years).filter(years =>
      years.some(y => { const yr = parseInt(y, 10); return yr >= s && yr <= e; })
    ).length;
    banner.textContent = `${count} station${count === 1 ? '' : 's'} collect ${name} between ${s}-${e}`;
  }

  // Whichever handle was last grabbed gets a higher z-index so it stays on
  // top when the two thumbs are near each other and both are clickable.
  startInput.addEventListener('pointerdown', () => {
    startInput.style.zIndex = 3;
    endInput.style.zIndex = 2;
  });
  endInput.addEventListener('pointerdown', () => {
    endInput.style.zIndex = 3;
    startInput.style.zIndex = 2;
  });

  startInput.addEventListener('input', () => applyFilter(true));
  endInput.addEventListener('input', () => applyFilter(false));

  updateFill(min, max);

  resetBtn.addEventListener('click', () => {
    startInput.value = min;
    endInput.value = max;
    applyFilter(true);
  });
}

// The 75 individual ZooDB species entries share one identical, generic
// 115-station placeholder list (assigned as a blanket "spatial
// approximation" in build_vars.py) with zero confirmed signal behind any
// of them -- unlike euphausiid species, which have real per-station data
// in a separate decade-means file (loaded lazily in the modal) even though
// it isn't merged into station_years here. Scope this narrowly to ZooDB so
// we don't suppress euphausiid highlighting, which is backed by real data
// this heuristic just can't see on the variable object itself.
function taxonHasConfirmedData(v) {
  if (v.station_years && Object.keys(v.station_years).length > 0) return true;
  if (typeof v.tow_occurrence_count === 'number') return true;
  if (typeof v.sighting_count === 'number') return true;
  if (typeof v.mean_abundance === 'number') return true;
  return false;
}

function isUnconfirmedZooDBTaxon(v) {
  return v.dataset_id === 'zoodb' &&
    v.entity_type === 'taxon' &&
    !taxonHasConfirmedData(v);
}

function highlightStations(variable, yearRange) {
  clearHighlights();
  if (!Array.isArray(variable?.station_ids)) return;

  if (isUnconfirmedZooDBTaxon(variable)) {
    // Placeholder grid, not real data -- don't imply confirmed records.
    return;
  }

  // station_ids may list a variable's full nominal/historical station grid
  // for context even when only a subset of those stations have confirmed
  // per-station records (station_years). When station_years is present,
  // treat it as authoritative and only highlight stations it backs --
  // regardless of whether a year-range filter is active.
  const hasRealStationData =
    variable.station_years && Object.keys(variable.station_years).length > 0;

  variable.station_ids.forEach(stationId => {
    if (hasRealStationData) {
      const years = variable.station_years[stationId];
      if (!years || years.length === 0) return;

      if (yearRange) {
        const inRange = years.some(y => {
          const yr = parseInt(y, 10);
          return yr >= yearRange[0] && yr <= yearRange[1];
        });
        if (!inRange) return;
      }
    }

    const station =
      window.stationIdMap?.[stationId] ||
      window.stationMap?.[normalizeStationId(stationId)];

    if (!station?.marker) {
      console.warn("Missing station:", stationId);
      return;
    }

    station.marker.setStyle({
      radius: 10,
      fillColor: "#ffd84d",
      color: "#fff3bf",
      weight: 2,
      fillOpacity: 0.95,
      opacity: 1
    });
    station.marker.bringToFront?.();
  });
}

function clearHighlights() {
  Object.values(window.stationMap || {}).forEach(station => {
    if (!station?.marker) return;
    station.marker.setStyle({
      radius: 10, color: "#00c2ff", fillColor: "#00c2ff",
      weight: 1, fillOpacity: 0.7, opacity: 1
    });
  });
}

function handleVariableClick(variableId) {
  const variable = window.variableMap?.[variableId];
  if (!variable) return;
  selectVariable(variableId);
  requestAnimationFrame(() => {
    if (window.currentStation) openVariableModal(variable);
  });
}

function clearAll() {
  selectedVariable = null;
  activeCategory = null;
  window.browseGroupActive = null;
  searchInput.value = '';
  closeDropdown();
  clearHighlights();
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('clear-btn').classList.remove('visible');
  document.getElementById('search-banner').classList.remove('visible');
  const yearSlider = document.getElementById('year-slider');
  if (yearSlider) { yearSlider.style.display = 'none'; yearSlider.innerHTML = ''; }
  resetPanelUI();

  // restore browse panel
  const browsePanel = document.getElementById('browse-panel');
  if (browsePanel) browsePanel.style.display = 'block';
}

// Title-case: capitalize every word (used for category labels)
function toTitleCase(str) {
  return (str || "").replace(/\b\w/g, c => c.toUpperCase());
}

// Fix known display name issues from ERDDAP metadata
// Fix underscores in field names (e.g. common_name → Common Name)
// Applied in fixDisplayName before other fixes
function cleanFieldName(name) {
  if (!name) return name;
  if (name.includes("_")) {
    return name.replace(/_/g, " ");
  }
  return name;
}

const DISPLAY_NAME_FIXES = {
  // Truncations from ERDDAP long_name field
  "Phaeopigment Concentratio":              "Phaeopigment Concentration",
  "Phaeopigment concentratio":              "Phaeopigment Concentration",

  // pH — preserve lowercase h
  "ph":                                     "pH",
  "Ph":                                     "pH",
  "PH":                                     "pH",
  "ph replicate":                           "pH Replicate",
  "pH replicate":                           "pH Replicate",

  // Coordinate metadata fields (filtered from browse but fix if shown)
  "latitude_degrees":                       "Latitude Degrees",
  "latitude_hemisphere":                    "Latitude Hemisphere",
  "latitude_minutes":                       "Latitude Minutes",
  "longitude_degrees":                      "Longitude Degrees",
  "longitude_hemisphere":                   "Longitude Hemisphere",
  "longitude_minutes":                      "Longitude Minutes",

  // Platform labels
  "erddap":                                 "ERDDAP",
  "oceaninformatics":                       "Ocean Informatics",
  "ucsd":                                   "UCSD",

  // ZooDB species common names (only well-established English names)
  "calanus pacificus":          "Calanus pacificus (California Copepod)",
  "neocalanus cristatus":       "Neocalanus cristatus (Crystalline Copepod)",
  "neocalanus flemingeri":      "Neocalanus flemingeri (Fleming's Copepod)",
  "neocalanus gracilis":        "Neocalanus gracilis (Graceful Copepod)",
  "neocalanus plumchrus":       "Neocalanus plumchrus (Subarctic Copepod)",
  "pleuroncodes planipes":      "Pleuroncodes planipes (Pelagic Red Crab)",
  "pyrosoma atlanticum":        "Pyrosoma atlanticum (Atlantic Pyrosome)",
  "thalia democratica":         "Thalia democratica (Democratic Salp)",
  "salpa fusiformis":           "Salpa fusiformis (Fusiform Salp)",
  "salpa maxima":               "Salpa maxima (Giant Salp)",
  "salpa aspera":               "Salpa aspera (Rough Salp)",
  "sergestes similis":          "Sergestes similis (Similar Sergestid Shrimp)",
  "pasiphaea pacifica":         "Pasiphaea pacifica (Pacific Glass Shrimp)",
  "pasiphaea spp.":             "Pasiphaea spp. (Glass Shrimp)",
  "dolioletta gegenbauri":      "Dolioletta gegenbauri (Gegenbauer's Doliolid)",
  "pegea confoederata":         "Pegea confoederata (Colonial Salp)",
  "weelia cylindrica":          "Weelia cylindrica (Cylindrical Salp)",
  "thetys vagina":              "Thetys vagina (Giant Salp)",
  "tomopteris spp.":            "Tomopteris spp. (Polychaete Worm)",
  "atlanta spp.":               "Atlanta spp. (Sea Butterfly Heteropod)",

  // Euphausiid common names
  "Bentheuphausia amblyops":    "Bentheuphausia amblyops (Deep-sea Krill)",
  "Euphausia brevis":           "Euphausia brevis (Short Krill)",
  "Euphausia diomedeae":        "Euphausia diomedeae (Diomedea Krill)",
  "Euphausia distinguenda":     "Euphausia distinguenda (Distinctive Krill)",
  "Euphausia eximia":           "Euphausia eximia (Exquisite Krill)",
  "Euphausia gibboides":        "Euphausia gibboides (Humpback Krill)",
  "Euphausia hemigibba":        "Euphausia hemigibba (Half-hump Krill)",
  "Euphausia lamelligera":      "Euphausia lamelligera (Lamellar Krill)",
  "Euphausia mutica":           "Euphausia mutica (Mute Krill)",
  "Euphausia pacifica":         "Euphausia pacifica (Pacific Krill)",
  "Euphausia recurva":          "Euphausia recurva (Curved Krill)",
  "Euphausia tenera":           "Euphausia tenera (Tender Krill)",
  "Hansarsia atlantica":        "Hansarsia atlantica (Atlantic Krill)",
  "Hansarsia difficilis":       "Hansarsia difficilis (Difficult Krill)",
  "Hansarsia gracilis":         "Hansarsia gracilis (Slender Krill)",
  "Hansarsia microps":          "Hansarsia microps (Small-eye Krill)",
  "Hansarsia tenella":          "Hansarsia tenella (Delicate Krill)",
  "Nematobrachion boopis":      "Nematobrachion boopis (Boops Krill)",
  "Nematobrachion flexipes":    "Nematobrachion flexipes (Flexible Krill)",
  "Nyctiphanes simplex":        "Nyctiphanes simplex (Simple Krill)",
  "Stylocheiron abbreviatum":   "Stylocheiron abbreviatum (Abbreviated Krill)",
  "Stylocheiron affine":        "Stylocheiron affine (Affine Krill)",
  "Stylocheiron carinatum":     "Stylocheiron carinatum (Keeled Krill)",
  "Stylocheiron elongatum":     "Stylocheiron elongatum (Elongated Krill)",
  "Stylocheiron longicorne":    "Stylocheiron longicorne (Long-horned Krill)",
  "Stylocheiron maximum":       "Stylocheiron maximum (Large Krill)",
  "Stylocheiron suhmi":         "Stylocheiron suhmi (Suhm's Krill)",
  "Tessarabrachion oculatum":   "Tessarabrachion oculatum (Four-arm Krill)",
  "Thysanoessa gregaria":       "Thysanoessa gregaria (Gregarious Krill)",
  "Thysanoessa longipes":       "Thysanoessa longipes (Long-legged Krill)",
  "Thysanoessa spinifera":      "Thysanoessa spinifera (Spiny Krill)",
  "Thysanopoda astylata":       "Thysanopoda astylata (Styleless Krill)",
  "Thysanopoda cornuta":        "Thysanopoda cornuta (Horned Krill)",
  "Thysanopoda cristata":       "Thysanopoda cristata (Crested Krill)",
  "Thysanopoda egregia":        "Thysanopoda egregia (Distinguished Krill)",
  "Thysanopoda monacantha":     "Thysanopoda monacantha (Single-spine Krill)",
  "Thysanopoda obtusifrons":    "Thysanopoda obtusifrons (Blunt-fronted Krill)",
  "Thysanopoda orientalis":     "Thysanopoda orientalis (Oriental Krill)",
  "Thysanopoda pectinata":      "Thysanopoda pectinata (Combed Krill)",

  // Specific ERDDAP name fixes
  "C14 Assimilation of the Experimental Control (dark Bottle)":
    "C14 Assimilation of the Experimental Control (Dark Bottle)",
  "C14 Assimilation of the experimental control (dark bottle)":
    "C14 Assimilation of the Experimental Control (Dark Bottle)",
  "ForelU":          "Forel-Ule Color Code",
  "Forel_Ule":       "Forel-Ule Color Code",
  "forelU":          "Forel-Ule Color Code",
  "O2Sat":           "Oxygen Saturation",
  "O2sat":           "Oxygen Saturation",
  "O2":              "Oxygen (mL/L)",
  "Secchi":          "Secchi Depth",
  "secchi":          "Secchi Depth",
  "Mesh Size ()":    "Mesh Size",
  "mesh size ()":    "Mesh Size",
};

function fixDisplayName(name) {
  if (!name) return name;
  // Fix underscores first
  let cleaned = cleanFieldName(name);
  // Strip a trailing "Replicate N" / ", Replicate N" so both replicates
  // of the same measurement (e.g. "Total Alkalinity, Replicate 1" and
  // "...Replicate 2") render to the same label and merge into one row,
  // instead of showing as two separate near-duplicate parameters.
  cleaned = cleaned.replace(/,?\s*replicate\s*\d+\s*$/i, "").trim();
  // Clean up a dangling trailing "of" left behind (e.g. "...Assimilation
  // Of Replicate 1" -> "...Assimilation Of" -> "...Assimilation")
  cleaned = cleaned.replace(/\s+of\s*$/i, "").trim();
  // Check exact match fixes
  if (DISPLAY_NAME_FIXES[cleaned]) return DISPLAY_NAME_FIXES[cleaned];
  if (DISPLAY_NAME_FIXES[cleaned.toLowerCase()]) return DISPLAY_NAME_FIXES[cleaned.toLowerCase()];
  // Apply title case
  return toTitleCase(cleaned);
}

// Same cleanup as fixDisplayName, but keeps a "Replicate N" suffix
// intact. Used when listing every parameter within a single dataset
// (Browse by Dataset): there's no cross-dataset ambiguity to resolve
// there, so if stripping "Replicate N" would collapse two genuinely
// different columns onto the same label, the fuller label is used
// instead so they still read as two distinct rows.
function fullVariableLabel(name) {
  if (!name) return name;
  const cleaned = cleanFieldName(name);
  if (DISPLAY_NAME_FIXES[cleaned]) return DISPLAY_NAME_FIXES[cleaned];
  if (DISPLAY_NAME_FIXES[cleaned.toLowerCase()]) return DISPLAY_NAME_FIXES[cleaned.toLowerCase()];
  return toTitleCase(cleaned);
}

// Renders a taxon-grouped (Birds / Mammals / Other), count-sorted species
// breakdown for the generic "Species" fields. Returns "" if no data.
function renderSpeciesBreakdown(speciesList) {
  if (!speciesList || !speciesList.length) return "";

  const confirmed = speciesList.filter(s => s.confirmed !== false);
  const unconfirmed = speciesList.filter(s => s.confirmed === false);

  const taxonOrder = ["bird", "mammal", "fish", "reptile"];
  const taxonLabel = { bird: "Birds", mammal: "Mammals", fish: "Fish", reptile: "Reptiles" };

  const groups = {};
  confirmed.forEach(s => {
    const t = s.taxon_type || "other";
    if (!groups[t]) groups[t] = [];
    groups[t].push(s);
  });

  const sections = taxonOrder
    .filter(t => groups[t]?.length)
    .map(t => {
      const rows = groups[t]
        .map(s => `
          <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-subtle,rgba(255,255,255,0.06));">
            <span>${s.common_name}</span>
            <span style="color:var(--muted);white-space:nowrap;margin-left:8px;">${s.count.toLocaleString()} sighted</span>
          </div>`)
        .join("");
      return `
        <div style="margin-top:10px;">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:var(--muted);margin-bottom:2px;">
            ${taxonLabel[t] || t} (${groups[t].length})
          </div>
          ${rows}
        </div>`;
    }).join("");

  const unconfirmedSection = unconfirmed.length
    ? `<div style="margin-top:10px;font-size:10px;color:var(--muted);">
         <em>Unconfirmed codes (not yet matched to a species dictionary):</em>
         ${unconfirmed.map(s => `${s.common_name} (${s.count.toLocaleString()})`).join(", ")}
       </div>`
    : "";

  return `
    <div style="margin-top:10px;max-height:260px;overflow-y:auto;font-size:12px;">
      ${sections}
      ${unconfirmedSection}
    </div>`;
}

// Lazy-loaded, cached per-dataset -- only fetched the first time it's
// actually needed, not on initial app load, since these files can be
// several hundred KB (one row per station per decade per species).
window._stationTimeSeriesCache = window._stationTimeSeriesCache || {};
async function loadStationTimeSeries(key, path) {
  if (window._stationTimeSeriesCache[key]) return window._stationTimeSeriesCache[key];
  try {
    const res = await fetch(path);
    const data = await res.json();
    window._stationTimeSeriesCache[key] = data;
    return data;
  } catch (err) {
    console.warn(`${path} not available:`, err);
    window._stationTimeSeriesCache[key] = {};
    return {};
  }
}

function renderDecadeBreakdownHtml(stationData) {
  if (!stationData) return "";
  const bins = Object.keys(stationData).sort();
  if (!bins.length) return "";
  const rows = bins.map(b => {
    const d = stationData[b];
    return `<div style="display:flex;justify-content:space-between;font-size:10px;padding:2px 0;">
      <span>${b}</span>
      <span style="color:var(--muted);">${d.mean_density.toLocaleString()} per m² (${d.n_tows} tows)</span>
    </div>`;
  }).join("");
  return `
    <div style="margin-top:10px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:var(--muted);margin-bottom:2px;">
        Mean density by decade at this station
      </div>
      ${rows}
    </div>`;
}

async function openVariableModal(v) {
  const backdrop = document.getElementById("modal-backdrop");
  const modal = document.getElementById("modal");
  const title = document.getElementById("modal-title");
  const body = document.getElementById("modal-body");
  const footer = document.getElementById("modal-footer");
  const warning = document.getElementById("external-warning");

  if (!backdrop || !modal || !title || !body || !footer) {
    console.error("Modal elements missing");
    return;
  }

  modal.onclick = (e) => e.stopPropagation();
  // The ZooDB "All genera and species" aggregate entry's taxonomy field is
  // parser junk, not a real species -- use a generic label instead.
  const rawTitle = (v.display_name === "All genera and species")
    ? "Zooplankton (All Genera & Species)"
    : (v.display_name || v.variable_name || "Dataset");
  title.textContent = toTitleCase(rawTitle);

  // format platform name
  const platformLabel = (v.platform || "")
    .replace("erddap", "ERDDAP")
    .replace("oceaninformatics", "Ocean Informatics");

  // Single-species sample count (e.g. individual marine mammal species
  // variables like marine_mammal_sightings_underway::blue_whale)

  // Same independence fix as the other countLine above: each stat is
  // its own optional line rather than mean_abundance (ZooDB) being
  // trapped inside the tow_occurrence_count (euphausiid-only) branch.
  const countLineParts2 = [
    typeof v.sighting_count === "number"
      ? `<strong>${v.sighting_count.toLocaleString()}</strong> sightings recorded`
      : "",
    typeof v.sighting_count === "number" && v.sighting_count_confidence
      ? `<div style="color:var(--muted);font-size:10px;margin-top:2px;">Confidence: ${v.sighting_count_confidence}</div>`
      : "",
    typeof v.tow_occurrence_count === "number"
      ? `Present in <strong>${v.tow_occurrence_count.toLocaleString()}</strong> of ${v.total_tows_surveyed.toLocaleString()} tows`
      : "",
    typeof v.cumulative_abundance === "number"
      ? `<div style="color:var(--muted);font-size:10px;margin-top:2px;">Cumulative abundance: ${v.cumulative_abundance.toLocaleString()} per m² &mdash; Brinton &amp; Townsend Euphausiid Database</div>`
      : "",
    typeof v.mean_abundance_when_present === "number"
      ? `<div style="color:var(--muted);font-size:10px;margin-top:2px;">Mean density when present: ${v.mean_abundance_when_present.toLocaleString()} per m² (max recorded: ${v.max_abundance_recorded.toLocaleString()}) &mdash; Brinton &amp; Townsend Euphausiid Database</div>`
      : "",
    typeof v.mean_abundance === "number"
      ? `<div style="color:var(--muted);font-size:10px;margin-top:2px;">Mean community abundance: ${v.mean_abundance.toLocaleString()} per m² (max recorded: ${v.max_abundance_recorded.toLocaleString()}) &mdash; CalCOFI ZooDB</div>`
      : "",
    v.data_note ? `<div style="color:var(--muted);font-size:10px;margin-top:2px;">${v.data_note}</div>` : "",
    yearRangeHtml(v),
    v.taxonomy_note ? `<div style="color:var(--muted);font-size:10px;margin-top:2px;">${v.taxonomy_note}</div>` : "",
  ].filter(Boolean);

  const countLine = countLineParts2.length
    ? `<div style="margin-top:8px;">${countLineParts2.join("\n         ")}</div>`
    : "";


  // Full species breakdown, grouped by taxon, for generic "Species" fields
  // (CAC_FI_SBAS_obs::species, CAC_FI_SBAS_sp::species) -- lives directly
  // on the variable object as v.species_breakdown.
  const speciesBreakdown = renderSpeciesBreakdown(v.species_breakdown);

  body.innerHTML = `
    <div class="variable-meta">
      <div><strong>Dataset:</strong> ${v.dataset_name || ""}</div>
      ${v.provider ? `<div><strong>Provider:</strong> ${v.provider}</div>` : ""}
      <div><strong>Platform:</strong> ${platformLabel}</div>
      ${v.units ? `<div><strong>Units:</strong> ${v.units}</div>` : ""}
      ${v.description && v.description !== v.display_name
        ? `<div style="margin-top:8px;color:var(--muted);font-size:11px;">${v.description}</div>`
        : ""}
      ${countLine}
      ${speciesBreakdown}
      <div id="decade-breakdown-slot"></div>
    </div>
  `;

  // Per-station decade breakdown: lazy-fetched, for euphausiid species
  // and the ZooDB community-wide "All genera and species" entry, when a
  // specific station is currently selected.
  if (v.dataset_id === "euphausiid" && window.currentStation) {
    const stationId = window.currentStation.station_id;
    loadStationTimeSeries("euphausiid", "./data/euphausiid_station_decade_means.json")
      .then(data => {
        const slot = document.getElementById("decade-breakdown-slot");
        if (!slot) return; // modal closed before fetch resolved
        const stationData = data?.[v.variable_name]?.[stationId];
        slot.innerHTML = renderDecadeBreakdownHtml(stationData);
      });
  } else if (v.dataset_id === "zoodb" && v.display_name === "All genera and species" && window.currentStation) {
    const stationId = window.currentStation.station_id;
    loadStationTimeSeries("zoodb", "./data/zoodb_station_decade_means.json")
      .then(data => {
        const slot = document.getElementById("decade-breakdown-slot");
        if (!slot) return; // modal closed before fetch resolved
        const stationData = data?.["All genera and species"]?.[stationId];
        slot.innerHTML = renderDecadeBreakdownHtml(stationData);
      });
  }

  footer.innerHTML = "";

  const url = getDatasetUrl(v);

  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = "btn-docs";
  link.textContent = "Open Dataset ↗";
  footer.appendChild(link);

  if (warning) {
    warning.style.display = v.station_based ? "none" : "block";
  }

  backdrop.style.display = "flex";
}

// Shown when an umbrella variable (see buildUmbrellaVariable) is selected
// and the clicked station has more than one real underlying variable that
// applies -- e.g. a station reporting "Oxygen" from both Hydrographic
// Bottle and NOAA CTD. Reuses the same modal shell as openVariableModal,
// but lists the real options instead of showing any single one's info, so
// nothing gets silently picked for the person and nothing gets blended.
function openSourceChooser(matches, station, umbrellaLabel) {
  const backdrop = document.getElementById("modal-backdrop");
  const modal = document.getElementById("modal");
  const title = document.getElementById("modal-title");
  const body = document.getElementById("modal-body");
  const footer = document.getElementById("modal-footer");
  const warning = document.getElementById("external-warning");

  if (!backdrop || !modal || !title || !body || !footer) return;

  modal.onclick = (e) => e.stopPropagation();
  title.textContent = `${toTitleCase(umbrellaLabel)} — choose a source`;

  body.innerHTML = `
    <div style="color:var(--muted);font-size:12px;margin-bottom:12px;">
      Station ${station.station_id} reports ${toTitleCase(umbrellaLabel)} from more than one source.
      Pick one to see its data -- these aren't combined, since they may use
      different units or methods.
    </div>
    ${matches.map(v => `
      <div class="dropdown-item" style="border:1px solid var(--border);border-radius:4px;margin-bottom:6px;"
           onclick='selectSourceFromChooser("${v.variable_id}")'>
        <div class="dropdown-name">
          ${v.dataset_name || v.dataset_id}
          ${v.units ? `<span style="color:var(--muted);margin-left:6px;font-size:10px;">(${v.units})</span>` : ""}
        </div>
      </div>
    `).join("")}
  `;

  footer.innerHTML = "";
  if (warning) warning.style.display = "none";
  backdrop.style.display = "flex";
}

// Called from the chooser's onclick -- closes the chooser and opens the
// real variable's normal modal, exactly as if it had been selected directly.
function selectSourceFromChooser(variableId) {
  const v = window.variableMap?.[variableId];
  if (v) openVariableModal(v);
}

function closeModal(event) {
  if (event && event.target && event.target.id !== "modal-backdrop") return;
  const backdrop = document.getElementById("modal-backdrop");
  if (backdrop) backdrop.style.display = "none";
}

async function initializeApp() {
  try {
    await Promise.all([
      loadStations(),
      loadStationGroups(),
      loadVariables()
    ]);
  } catch (err) {
    console.error("Initialization failed:", err);
  } finally {
    const overlay = document.getElementById("loading-overlay");
    if (overlay) overlay.style.display = "none";

    if (!localStorage.getItem("aboutSeen")) {
      showAboutModal();
      localStorage.setItem("aboutSeen", "true");
    }
  }
}

function showAboutModal() {
  document.getElementById("about-backdrop").style.display = "flex";
  localStorage.setItem("aboutSeen", "true");
}

function hideAboutModal() {
  document.getElementById("about-backdrop").style.display = "none";
}

function togglePanel() {
  const panel = document.getElementById('side-panel');
  const toggle = document.getElementById('panel-toggle');
  if (!panel) return;
  panel.classList.toggle('collapsed');
  if (toggle) toggle.textContent = panel.classList.contains('collapsed') ? '❮' : '❯';
}

// start
initializeApp();
