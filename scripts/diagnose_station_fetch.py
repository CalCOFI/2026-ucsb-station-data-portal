"""
diagnose_station_fetch.py

Several ERDDAP datasets ended up with zero station_ids in variables.json
(erdCalCOFIeggcnt, erdCalCOFIeggstg, erdCalCOFINOAAhydros, and others --
everything except siocalcofiHydroBottle/Cast). This finds out WHY, for a
couple of representative datasets, before deciding on a fix:

  - If the request itself fails (network/URL/timeout), that's a different
    problem than lat/lon would solve.
  - If the request succeeds but every line/station value fails to match
    CANONICAL_STATIONS (format mismatch), a lat/lon-based spatial match
    (same technique already used in build_integrated_db_station_years.py)
    would very likely fix it.

Run from the same folder as build_vars.py (needs metadata/stations.csv):
    python diagnose_station_fetch.py
"""

import json
import pandas as pd
import requests

STATIONS_CSV = "metadata/stations.csv"
BASE = "https://oceanview.pfeg.noaa.gov/erddap/tabledap"

# A representative sample: one that should behave like the working hydro
# datasets (uses line/station), plus the datasets currently returning zero.
TEST_DATASETS = [
    "erdCalCOFIeggcnt",
    "erdCalCOFINOAAhydros",
]


def normalize_station_id(value):
    if value is None:
        return None
    return str(value).replace('"', '').strip()


def main():
    stations_df = pd.read_csv(STATIONS_CSV)
    canonical = set(
        normalize_station_id(s) for s in stations_df["station_id"]
    )
    print(f"Loaded {len(canonical)} canonical stations")
    print("Sample canonical station_ids:", sorted(canonical)[:5])
    print()

    for dataset_id in TEST_DATASETS:
        print("=" * 70)
        print(dataset_id)
        print("=" * 70)

        # --- Test 1: does the dataset even respond, at all? ---
        info_url = f"{BASE}/{dataset_id}.json?line%2Cstation&distinct()"
        print(f"Requesting: {info_url}")
        try:
            r = requests.get(info_url, timeout=30)
            print(f"HTTP status: {r.status_code}")
            r.raise_for_status()
            data = r.json()
            rows = data["table"]["rows"]
            print(f"Request succeeded. Got {len(rows)} distinct line/station rows.")

            if rows:
                print("First 5 raw rows:", rows[:5])
                # Check how many would actually match CANONICAL_STATIONS
                matched, unmatched_samples = 0, []
                for row in rows:
                    if len(row) < 2 or row[0] is None or row[1] is None:
                        continue
                    sid = normalize_station_id(f"{row[0]} {row[1]}")
                    if sid in canonical:
                        matched += 1
                    elif len(unmatched_samples) < 5:
                        unmatched_samples.append(sid)
                print(f"Of those, {matched} matched a canonical station_id.")
                if unmatched_samples:
                    print("Sample of NON-matching formatted values:", unmatched_samples)
                    print("  -> compare these against the canonical sample above --")
                    print("     if they look like the same stations but formatted")
                    print("     differently, that confirms Cause B (format mismatch).")
            else:
                print("Request succeeded but returned ZERO rows -- the dataset genuinely")
                print("has no line/station data via this query, not a format issue.")

        except Exception as e:
            print(f"REQUEST FAILED: {type(e).__name__}: {e}")
            print("This is Cause A -- the fetch itself is failing, not a matching issue.")

        # --- Test 2: does a lat/lon query work instead? ---
        latlon_url = f"{BASE}/{dataset_id}.json?latitude%2Clongitude&distinct()"
        print(f"\nRequesting: {latlon_url}")
        try:
            r = requests.get(latlon_url, timeout=30)
            print(f"HTTP status: {r.status_code}")
            r.raise_for_status()
            data = r.json()
            rows = data["table"]["rows"]
            print(f"Request succeeded. Got {len(rows)} distinct lat/lon rows.")
            if rows:
                print("First 5 raw rows:", rows[:5])
        except Exception as e:
            print(f"REQUEST FAILED: {type(e).__name__}: {e}")

        # --- Test 3: what does the dataset's own metadata say the valid
        # range of these columns actually is? If actual_range for line/
        # station doesn't look like the CalCOFI grid at all, the columns
        # requested may not mean what we assumed. ---
        info_url2 = f"{BASE}/{dataset_id}/index.json"
        print(f"\nRequesting metadata: {info_url2}")
        try:
            r = requests.get(info_url2, timeout=30)
            r.raise_for_status()
            info_rows = r.json()["table"]["rows"]
            for row in info_rows:
                row_type, var_name, attr_name, _, value = row[0], row[1], row[2], row[3], row[4]
                if var_name in ("line", "station", "latitude", "longitude") and attr_name in (
                    "actual_range", "units", "long_name"
                ):
                    print(f"  {var_name}.{attr_name} = {value}")
        except Exception as e:
            print(f"Metadata request failed: {type(e).__name__}: {e}")

        # --- Test 4: a handful of REAL (non-distinct) rows with everything
        # together, to sanity check line/station against lat/lon for the
        # same actual records. ---
        sample_url = f"{BASE}/{dataset_id}.json?line,station,latitude,longitude,time&orderBy(%22time%22)&distinct()"
        print(f"\nRequesting ordered sample: {sample_url}")
        try:
            r = requests.get(sample_url, timeout=30)
            r.raise_for_status()
            rows = r.json()["table"]["rows"][:5]
            print("First 5 rows ordered by time (line, station, lat, lon, time):")
            for row in rows:
                print(" ", row)
        except Exception as e:
            print(f"Ordered sample request failed: {type(e).__name__}: {e}")

        print()


if __name__ == "__main__":
    main()
