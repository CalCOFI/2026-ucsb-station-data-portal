import json
import pandas as pd
import requests
from collections import defaultdict

# =====================================================
# CONFIG
# =====================================================

DATASETS_CSV = "metadata/data_sources.csv"

STATIONS_CSV = "metadata/stations.csv"

OUTPUT_JSON = "data/stations.json"

# =====================================================
# LOAD STATIONS
# =====================================================

stations_df = pd.read_csv(STATIONS_CSV)

stations = {}

for _, row in stations_df.iterrows():

    sta_id = str(row["station_id"]).strip()

    stations[sta_id] = {

        "station_id":
            sta_id,

        "lat":
            float(row["lat"]),

        "lon":
            float(row["lon"]),

        "datasets":
            [],

        "variables":
            []
    }

print(f"Loaded {len(stations)} stations")

# =====================================================
# LOAD DATASETS
# =====================================================

datasets_df = pd.read_csv(DATASETS_CSV)

# =====================================================
# ERDDAP STATION DISCOVERY
# =====================================================

def get_erddap_stations(base_url, dataset_id):

    url = (
        f"{base_url}/erddap/tabledap/"
        f"{dataset_id}.csv?"
        f"distinct(sta_id)"
    )

    print("\nQuerying:")
    print(url)

    try:

        df = pd.read_csv(url)

        column = df.columns[0]

        values = [

            str(x).strip()

            for x in df[column].dropna().unique()
        ]

        print(
            f"Found {len(values)} stations"
        )

        return values

    except Exception as e:

        print("FAILED:", dataset_id)
        print(e)

        return []

# =====================================================
# PROCESS DATASETS
# =====================================================

for _, row in datasets_df.iterrows():

    dataset_id = str(
        row["dataset_id"]
    ).strip()

    dataset_name = str(
        row["name"]
    ).strip()

    platform = str(
        row["platform"]
    ).strip().lower()

    base_url = str(
        row["base_url"]
    ).strip()

    station_based = bool(
        row["station_based"]
    )

    print("\n================================")
    print(dataset_id)
    print("================================")

    if not station_based:

        print("Skipping non-station dataset")
        continue

    # =================================================
    # OPTION 1 — ERDDAP DISTINCT STATIONS
    # =================================================

    if platform == "erddap":

        sta_ids = get_erddap_stations(
            base_url,
            dataset_id
        )

        for sta_id in sta_ids:

            if sta_id not in stations:
                continue

            stations[sta_id]["datasets"].append(
                dataset_id
            )

    # =================================================
    # OPTION 4 — SPATIAL APPROXIMATION
    # =================================================

    else:

        print(
            "Applying spatial approximation"
        )

        # assume dataset broadly applies
        # to all CalCOFI stations

        for sta_id in stations:

            stations[sta_id]["datasets"].append(
                dataset_id
            )

# =====================================================
# CLEAN + SORT
# =====================================================

final = []

for sta_id, station in stations.items():

    station["datasets"] = sorted(
        list(set(station["datasets"]))
    )

    final.append(station)

# =====================================================
# WRITE OUTPUT
# =====================================================

with open(OUTPUT_JSON, "w") as f:

    json.dump(final, f, indent=2)

print("\n================================")
print(f"Wrote {len(final)} stations")
print("================================")