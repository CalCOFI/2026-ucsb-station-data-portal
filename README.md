# CalCOFI Station Data Portal

An interactive map-based portal for exploring oceanographic and marine ecosystem data collected at CalCOFI stations along the California coast.

Built as part of the UCSB PSTAT 197 Capstone project in collaboration with CalCOFI, CA SeaGrant, and Scripps Institution of Oceanography.

Team: Nicole Xu, Aashish Krishnan, Qiongwen (Lucy) Cao

Project Mentor: Dr. Erin Satterthwaite

Project Advisor: Dr. Tony Coburn

---

## What It Does

- **Interactive map** of 115 real CalCOFI stations with clickable markers
- **Station panel** — click any station to see all data collected there
- **Search & filter** — live dropdown search by variable name
- **Accurate highlighting** — searching a variable highlights only the stations where that data is actually collected

The application is fully static and deployable on Vercel, GitHub Pages, Netlify, or any static web host.

---

## Project Structure

The application consists entirely of client-side JavaScript and static JSON files.
```
public/
│
├── index.html
├── styles.css
├── app.js
│
└── data/
    ├── stations.json
    ├── variables.json
    ├── data_sources.csv
    └── search_index.json
metadata/
│
├── data_sources.csv
├── euphausia.txt
├── stations.csv
└── zoodb.csv
scripts/
│
├── build_data.py
├── build_search.py
├── build_stations.py
└── build_vars.py

```
No backend server or database is required.

---


## Core Data Files

### variables.json

Master variable catalog.

Each variable follows the schema:

```json
{
  "variable_id": "",
  "dataset_id": "",
  "dataset_name": "",

  "entity_type": "",

  "variable_name": "",
  "display_name": "",

  "description": "",
  "units": "",

  "platform": "",
  "provider": "",

  "station_based": true,
  "station_ids": [],

  "science_concepts": [],
  "keywords": [],

  "taxonomy": {},

  "source": {
    "access_url": "",
    "metadata_url": ""
  }
}
```

### stations.json

Station metadata used by the map.

Example:

```json
{
  "station_id": "080.0 080.0",
  "lat": 33.5,
  "lon": -120.5
}
```

### data_sources.csv

Dataset registry used to generate metadata.

| Column | Description |
|----------|-------------|
| dataset_id | Unique dataset identifier |
| dataset_name | Human-readable dataset name |
| platform | erddap, euphausiid, zoodb, external |
| access_url | Dataset access URL |
| metadata_url_pattern | Metadata URL template |
| provider | Data provider |

### search_index.json

Optimized search index generated from `variables.json`.

Used for:

- Search
- Autocomplete
- Keyword matching
- Synonym lookup

---

## Supported Platforms

### ERDDAP

Interactive query URLs are generated automatically from selected variables and stations.

Examples:

```text
https://oceanview.pfeg.noaa.gov/erddap/tabledap/siocalcofiHydroCast.html
```

Supported station formats:

- `sta_id`
- `line + station`

### Euphausiid Database

Query URLs are generated dynamically using selected species, life stages, stations, and years.

Example:

```text
https://oceaninformatics.ucsd.edu/euphausiid/save.php
```

### ZooDB

Query URLs are generated dynamically using selected taxa and stations.

Example:

```text
https://oceaninformatics.ucsd.edu/zoodb/save.php
```

### External Datasets

Datasets that do not support parameterized query URLs are linked directly.

Examples include:

- EDI Repository
- NCBI
- Stanford Digital Repository
- NOAA NCEI

---

## Local Development

Serve the `public` directory using any static web server.

### Option 1: VS Code Live Server

Right-click `index.html` and select:

```text
Open with Live Server
```

### Option 2: Python

```bash
cd public
python -m http.server 8000
```

### Option 3: Node

```bash
npx serve public
```

Then open:

```text
http://localhost:8000
```

or

```text
http://localhost:3000
```

Do not open the HTML file directly from disk, as JSON fetch requests will fail.

---

## Deployment

### Vercel

1. Push repository to GitHub.
2. Import repository into Vercel.
3. Configure:

| Setting | Value |
|----------|--------|
| Framework Preset | Other |
| Build Command | None |
| Output Directory | public |

Deployments are automatically updated when changes are pushed to the main branch.

---

## Adding New Datasets

### Step 1

Add dataset metadata to:

```text
data_sources.csv
```

### Step 2

Harvest metadata from the source portal.

### Step 3

Generate variable records.

### Step 4

Attach:

- Keywords
- Science concepts
- Taxonomy

### Step 5

Associate variables with stations.

### Step 6

Rebuild:

```text
variables.json
search_index.json
stations.json
```

### Step 7

Deploy.

---

## Dataset Discovery Workflow

```text
data_sources.csv
        ↓
Metadata Harvesting
        ↓
variables.json
        ↓
Station Matching
        ↓
stations.json
        ↓
Search Index Generation
        ↓
search_index.json
        ↓
Frontend Application
```

---

## Query Generation

### ERDDAP

Generates interactive ERDDAP URLs containing:

- Selected variables
- Station constraints
- User filters

Example:

```text
https://oceanview.pfeg.noaa.gov/erddap/tabledap/siocalcofiHydroCast.html?time,latitude,longitude,dry_t
```

### Euphausiid

Generates URLs containing:

- Species
- Life stage
- Station
- Year range

### ZooDB

Generates URLs containing:

- Higher taxonomy
- Species
- Station
- Year range

---

## Future Improvements

- Temporal filtering
- Multi-variable query builder
- Dataset comparison tools
- Download cart
- Taxonomic search hierarchy
- Automated metadata harvesting
- Station-variable coverage analysis
- Interactive dataset coverage visualization

---

## Data Sources

Data are provided by:

- CalCOFI
- NOAA Southwest Fisheries Science Center
- Scripps Institution of Oceanography
- CCE-LTER
- Ocean Informatics
- EDI Data Repository
- NOAA NCEI

---

## Acknowledgements

This project was developed as part of the UCSB Data Science Capstone Program to improve discoverability and accessibility of CalCOFI and California Current Ecosystem datasets.
