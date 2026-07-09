import json
import pandas as pd
import requests
from pathlib import Path

INPUT_CSV = "metadata/data_sources.csv"

BASE_DIR = Path(__file__).resolve().parent.parent

OUTPUT_DIR = BASE_DIR / "public" / "data"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

OUTPUT_FILE = OUTPUT_DIR / "variables.json"

stations_path = OUTPUT_DIR / "stations.json"

with open(stations_path) as f:
    stations = json.load(f)


def normalize_station_id(value):
    if value is None:
        return None
    return str(value).replace('"', '').strip()


ALL_STATION_IDS = [
    s["station_id"] for s in stations if s.get("station_id")
]

CANONICAL_STATIONS = set(
    normalize_station_id(s) for s in ALL_STATION_IDS
)


def clean(value):
    if value is None:
        return ""
    return str(value).strip()


def make_variable_id(dataset_id, variable_name):
    safe = variable_name.replace(" ", "_")
    return f"{dataset_id}::{safe}"


# -------------------------------------------------------
# CalCOFI-specific category mapping
# Based on dataset_id + variable name — much more accurate
# than trusting ERDDAP ioos_category labels.
# -------------------------------------------------------

# Dataset-level assignments (dataset_id → group)
DATASET_GROUP = {
    # Hydrographic — split by variable name inside infer_group()
    "siocalcofiHydroBottle":    None,  # resolved by variable name
    "siocalcofiHydroCast":      None,  # resolved by variable name
    "erdCalCOFINOAAhydros":     None,  # resolved by variable name

    # Fish eggs & larvae (net tow datasets)
    "erdCalCOFIeggcnt":  "Fish Eggs & Larvae",
    "erdCalCOFIeggstg":  "Fish Eggs & Larvae",
    "erdCalCOFIlrvcnt":  "Fish Eggs & Larvae",
    "erdCalCOFIlrvsiz":  "Fish Eggs & Larvae",
    "erdCalCOFIlrvstg":  "Fish Eggs & Larvae",
    "erdCalCOFIinvcnt":  "Fish Eggs & Larvae",
    "erdCalCOFIinvsiz":  "Fish Eggs & Larvae",
    "erdCalCOFItows":    "Fish Eggs & Larvae",
    "erdCalCOFIzoovol":  "Zooplankton",
    "erdCalCOFIcufes":   "Fish Eggs & Larvae",

    # Zooplankton
    "zoodb":                                 "Zooplankton",
    "euphausiid":                            "Euphausiids (krill)",
    "nt620vn7810":                           "Zooplankton",
    "knb-lter-cce.188.4":                   "Zooplankton",
    "datazoo/catalogs/ccelter/datasets/254": "Zooplankton",
    "datazoo/catalogs/ccelter/datasets/159": "Genomics / eDNA",

    # DIC / Carbonate
    "gov.noaa.nodc:0301029": "Dissolved Inorganic Carbon (DIC)",

    # Genomics / eDNA
    "555783":                   "Genomics / eDNA",
    "ruizt/marine-mammal-edna": "Genomics / eDNA",

    # Seabirds & marine mammals
    "CAC_FI_SBAS_obs":    "Seabirds & Marine Mammals",
    "CAC_FI_SBAS_sp":     "Seabirds & Marine Mammals",
    "knb-lter-cce.262.2": "Seabirds & Marine Mammals",

    # Fish larvae (external)
    "bb9217084g": "Fish Eggs & Larvae",

    # Raw / external
    "ctd-cast-files/": "Raw Data & External Links",
    "underway/":       "Raw Data & External Links",
}

# Variable-name keyword mapping for hydrographic datasets
VARNAME_GROUP = [
    # Physical / Hydrography
    (["temperature", "salinity", "density", "oxygen", "o2", "pressure",
      "depth", "secchi", "forel", "dynamic height"],
     "Hydrography"),

    # Water Chemistry (nutrients)
    (["phosphate", "silicate", "nitrate", "nitrite", "ammonium", "nh4",
      "nutrient"],
     "Water Chemistry"),

    # Primary Production — BEFORE DIC to avoid "chlor" substring match
    (["chlorophyll", "phaeopigment", "c14 assimilation", "primary productivity",
      "productivity", "pigment", "integrated c14", "integrated chlor"],
     "Primary Production"),

    # Dissolved Inorganic Carbon (DIC)
    (["alkalinity", "dic", "dissolved inorganic carbon", "carbonate",
      "pco2", "ph replicate"],
     "Dissolved Inorganic Carbon (DIC)"),

    # Meteorology & Sea State
    (["wind", "wave", "atmospheric", "pressure", "weather", "cloud",
      "visibility", "bulb", "humidity", "rain"],
     "Meteorology & Sea State"),
]

# QC / metadata fields to hide from browse panel entirely
QC_KEYWORDS = [
    "quality", "precision", "identifier", "cruise", "ship", "cast id",
    "event", "order occupied", "data type", "leg", "organizational",
    "julian", "quarter", "time zone", "twilight", "incubation",
    "latitude_degree", "longitude_degree", "latitude_minute",
    "longitude_minute", "hemisphere", "gis_key", "idnum",
]

def infer_group(ioos_category, dataset_id="", variable_name="", display_name=""):
    """
    Assign a CalCOFI-specific browse group.
    Priority: dataset_id lookup → variable name keywords → QC filter → fallback.
    """
    # 1. Direct dataset assignment
    group = DATASET_GROUP.get(dataset_id)
    if group:
        return group

    # 2. For hydro datasets, classify by variable/display name
    name = (display_name or variable_name or "").lower().strip()

    # Special cases before general keyword matching
    if name in ("ph", "ph1", "ph2") or name.startswith("ph "):
        return "Carbonate system"

    # Check if it's a QC/metadata field — exclude from browse
    if any(k in name for k in QC_KEYWORDS):
        return "QC / metadata"

    # Check keyword groups
    for keywords, grp in VARNAME_GROUP:
        if any(k in name for k in keywords):
            return grp

    # 3. Fallback
    return "QC / metadata"  # unknown hydro fields are likely metadata/QC


def infer_entity_type(name):
    n = name.lower()
    if any(x in n for x in ["temp", "temperature", "salinity", "density"]):
        return "physical_variable"
    if any(x in n for x in ["oxygen", "nitrate", "phosphate", "silicate", "ph"]):
        return "chemical_variable"
    return "scientific_variable"


def build_info_url(base_url, dataset_id):
    base = base_url.rstrip("/")
    return f"{base}/erddap/info/{dataset_id}/index.json"


def fetch_erddap_stations(dataset_id):
    print(f"Fetching stations for {dataset_id}")

    if dataset_id in {"zoodb", "euphausiid"}:
        # Spatial approximation: applies to all CalCOFI stations
        return ALL_STATION_IDS

    base = "https://oceanview.pfeg.noaa.gov/erddap/tabledap"
    hydro_datasets = {"siocalcofiHydroBottle", "siocalcofiHydroCast"}

    try:
        if dataset_id in hydro_datasets:
            url = f"{base}/{dataset_id}.json?sta_id&distinct()"
            r = requests.get(url, timeout=60)
            r.raise_for_status()
            rows = r.json()["table"]["rows"]
            found = []
            for row in rows:
                if not row:
                    continue
                sid = normalize_station_id(row[0])
                if sid and sid in CANONICAL_STATIONS:
                    found.append(sid)
            return sorted(list(set(found)))

        else:
            url = f"{base}/{dataset_id}.json?line%2Cstation&distinct()"
            r = requests.get(url, timeout=60)
            r.raise_for_status()
            rows = r.json()["table"]["rows"]
            found = []
            for row in rows:
                if len(row) < 2:
                    continue
                line, station = row[0], row[1]
                if line is None or station is None:
                    continue
                sid = normalize_station_id(f"{line} {station}")
                if sid in CANONICAL_STATIONS:
                    found.append(sid)
            return sorted(list(set(found)))

    except Exception as e:
        print(f"Station fetch failed for {dataset_id}:", e)
        return []


def parse_erddap_info(metadata_json):
    rows = metadata_json["table"]["rows"]
    variables = {}
    current_variable = None

    for row in rows:
        row_type = row[0]
        variable_name = clean(row[1])
        attribute_name = clean(row[2])
        value = clean(row[4])

        if row_type == "variable":
            current_variable = variable_name
            variables[current_variable] = {
                "variable_name": current_variable,
                "display_name": current_variable,
                "description": "",
                "units": "",
                "ioos_category": "",
                "long_name": "",
            }
        elif row_type == "attribute":
            if variable_name not in variables:
                continue
            if attribute_name == "description":
                variables[variable_name]["description"] = value
            elif attribute_name == "units":
                variables[variable_name]["units"] = value
            elif attribute_name == "long_name":
                variables[variable_name]["long_name"] = value
            elif attribute_name == "ioos_category":
                variables[variable_name]["ioos_category"] = value

    return list(variables.values())


# -------------------------------------------------------
# MAIN BUILD LOOP
# -------------------------------------------------------

df = pd.read_csv(INPUT_CSV)

all_variables = []
station_groups = {}

for _, row in df.iterrows():
    dataset_id   = clean(row["dataset_id"])
    dataset_name = clean(row["name"])
    platform     = clean(row["platform"]).lower()
    access_url   = clean(row["url"])
    base_url     = clean(row["base_url"])
    station_based = bool(row["station_based"])

    print(f"\nProcessing: {dataset_id}")

    if platform == "erddap":
        metadata_url = build_info_url(base_url, dataset_id)
        print("Metadata URL:", metadata_url)

        try:
            response = requests.get(metadata_url)
            metadata_json = response.json()

            if dataset_id not in station_groups:
                station_groups[dataset_id] = fetch_erddap_stations(dataset_id)

            dataset_station_ids = station_groups[dataset_id]

        except Exception as e:
            print("FAILED:", dataset_id, e)
            continue

        parsed_variables = parse_erddap_info(metadata_json)
        print(f"Found {len(parsed_variables)} variables")

        for pv in parsed_variables:
            variable_name = pv["variable_name"]
            display_name  = pv["long_name"] or variable_name
            description   = pv["description"]
            units         = pv["units"]
            ioos_category = pv["ioos_category"]

            variable = {
                "variable_id":   make_variable_id(dataset_id, variable_name),
                "dataset_id":    dataset_id,
                "dataset_name":  dataset_name,
                "entity_type":   infer_entity_type(variable_name),

                # ---- FIX 1: write the actual station list ----
                "station_ids":   dataset_station_ids,
                # ---- FIX 2: add browse group from ioos_category ----
                "browse_group":  infer_group(ioos_category, dataset_id, variable_name, display_name),

                "variable_name": variable_name,
                "display_name":  display_name,
                "description":   description,
                "units":         units,
                "platform":      platform,
                "station_based": len(dataset_station_ids) > 0,
                "station_group": dataset_id,
                "station_count": len(dataset_station_ids),

                "science_concepts": [ioos_category] if ioos_category else [],
                "keywords": list(set([
                    variable_name,
                    display_name,
                    description,
                    ioos_category,
                ])),
                "taxonomy": {},
                "source": {
                    "access_url":  access_url,
                    "metadata_url": metadata_url,
                },
            }

            all_variables.append(variable)

    else:
        all_variables.append({
            "variable_id":  f"{dataset_id}::dataset",
            "dataset_id":   dataset_id,
            "dataset_name": dataset_name,
            "entity_type":  "scientific_dataset",
            "variable_name": dataset_name,
            "display_name":  dataset_name,
            "description":   dataset_name,
            "units":         "",
            "platform":      platform,
            "station_based": station_based,
            "station_ids":   [],
            "browse_group":  infer_group("", dataset_id, dataset_name, dataset_name),
            "science_concepts": [],
            "keywords":      [dataset_name],
            "taxonomy":      {},
            "source": {
                "access_url":  access_url,
                "metadata_url": "",
            },
        })


# -------------------------------------------------------
# EUPHAUSIID SPECIES
# -------------------------------------------------------

EUPHAUSIA_FILE = "metadata/euphausia.txt"

try:
    with open(EUPHAUSIA_FILE) as f:
        species_list = [x.strip() for x in f.readlines() if x.strip()]

    print(f"\nAdding {len(species_list)} euphausiid species")

    for species in species_list:
        parts = species.split()
        genus        = parts[0].capitalize() if len(parts) > 0 else ""
        species_name = parts[1] if len(parts) > 1 else ""
        canonical    = f"{genus} {species_name}".strip()

        variable = {
            "variable_id":   f"euphausiid::{canonical.replace(' ', '_')}",
            "dataset_id":    "euphausiid",
            "dataset_name":  "CalCOFI Euphausiid Database",
            "entity_type":   "taxon",
            "variable_name": canonical,
            "display_name":  canonical,
            "description":   "Euphausiid species observation",
            "units":         "count",
            "platform":      "oceaninformatics",
            "provider":      "SIO",
            "station_based": True,

            # ---- FIX 1: populate station_ids (all CalCOFI stations) ----
            "station_ids":   ALL_STATION_IDS,
            # ---- FIX 2: browse group ----
            "browse_group":  "Euphausiids (krill)",  # kept distinct from Zooplankton

            "science_concepts": ["zooplankton", "krill", "euphausiids"],
            "keywords": list(set([canonical, genus, "krill", "euphausiid", "zooplankton"])),
            "taxonomy": {
                "kingdom": "Animalia",
                "phylum":  "Arthropoda",
                "class":   "Malacostraca",
                "order":   "Euphausiacea",
                "genus":   genus,
                "species": species_name,
            },
            "source": {
                "access_url":  "https://oceaninformatics.ucsd.edu/euphausiid/",
                "metadata_url": "",
            },
        }

        all_variables.append(variable)

except Exception as e:
    print("\nFailed euphausiid ingestion:", e)


# -------------------------------------------------------
# ZOODB TAXA
# -------------------------------------------------------

ZOODB_FILE = "metadata/zoodb.csv"

try:
    zoodb_df = pd.read_csv(ZOODB_FILE)
    print(f"\nAdding {len(zoodb_df)} ZooDB taxa")

    for _, row in zoodb_df.iterrows():
        higher_taxonomy = str(row["higher_taxa"]).strip()
        genus_species   = str(row["genus_species"]).strip()

        if not genus_species:
            continue

        parts = genus_species.split()
        genus        = parts[0] if len(parts) > 0 else ""
        species_name = parts[1] if len(parts) > 1 else ""

        variable = {
            "variable_id":   f"zoodb::{genus_species.replace(' ', '_')}",
            "dataset_id":    "zoodb",
            "dataset_name":  "CalCOFI ZooDB",
            "entity_type":   "taxon",
            "variable_name": genus_species,
            "display_name":  genus_species,
            "description":   "Zooplankton taxonomic observation",
            "units":         "count",
            "platform":      "oceaninformatics",
            "provider":      "SIO",
            "station_based": True,

            # ---- FIX 1: populate station_ids ----
            "station_ids":   ALL_STATION_IDS,
            # ---- FIX 2: browse group ----
            "browse_group":  "Zooplankton",

            "science_concepts": ["zooplankton"],
            "keywords": list(set([genus_species, genus, higher_taxonomy, "zooplankton"])),
            "taxonomy": {
                "higher_taxonomy": higher_taxonomy,
                "genus":           genus,
                "species":         species_name,
            },
            "source": {
                "access_url":  "https://oceaninformatics.ucsd.edu/zoodb/",
                "metadata_url": "",
            },
        }

        all_variables.append(variable)

except Exception as e:
    print("\nFailed ZooDB ingestion:", e)


# -------------------------------------------------------
# WRITE OUTPUTS
# -------------------------------------------------------

station_groups_path = OUTPUT_DIR / "station_groups.json"

with open(station_groups_path, "w") as f:
    json.dump(station_groups, f, separators=(",", ":"))

print(f"Wrote {station_groups_path}")

with open(OUTPUT_FILE, "w") as f:
    json.dump(all_variables, f, separators=(",", ":"))

print(f"\n================================")
print(f"Wrote {len(all_variables)} variables to {OUTPUT_FILE}")
print("================================")
