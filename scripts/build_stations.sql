-- build_stations.sql — per-station (grid) coverage summaries from the CalCOFI
-- integrated database, written to public/data/stations.json.
--
-- Stations ARE the integrated-DB `grid` table (regularized CalCOFI station grid,
-- derived from calcofi4r::cc_grid). For each grid cell x dataset it summarizes:
-- time min/max, depth min/max, #observations, #samples, #surveys (distinct
-- cruises), plus per-year (overall) and per-month (seasonal) histograms.
--
-- Run from the repo root (needs the `duckdb` CLI + network to public GCS):
--   duckdb -c ".read scripts/build_stations.sql"
--
-- Data source: the frozen release parquet at
--   https://storage.googleapis.com/calcofi-db/ducklake/releases/{VERSION}/parquet/
-- (public); the literal __RELEASE__ below is substituted with the resolved
-- version at build time (see .github/workflows/refresh.yml).
-- Regenerate on every DB release (see .github/workflows).

INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;

-- frozen-release parquet base; __RELEASE__ is substituted with the resolved
-- version (e.g. v2026.07.15) at build time. Uses the gs:// scheme (not https://)
-- because reading the Hive-partitioned obs/ requires GCS object listing, which
-- plain-HTTPS read_parquet cannot do; gs:// reads this public bucket anonymously.
CREATE TEMP MACRO r(p) AS 'gs://calcofi-db/ducklake/releases/__RELEASE__/parquet/' || p;

-- stations = grid cells; lat/lon from the geom_ctr centroid POINT
CREATE TEMP TABLE grid AS
SELECT grid_key, line, station, pattern, shore, zone, area_km2,
       ST_X(geom_ctr) AS lon, ST_Y(geom_ctr) AS lat
FROM read_parquet(r('grid.parquet'));

-- unified observation stream: the consolidated core `obs` table from the frozen
-- release (Hive-partitioned by dataset_key), one row per measurement carrying
-- dataset_key + realm + grid_key + cruise_key + datetime + depth range + sample_key.
-- Replaces the former hand-rolled per-dataset UNION ALL preview.
CREATE TEMP TABLE obs AS
SELECT dataset_key, realm, grid_key,
       CAST(cruise_key AS VARCHAR) AS cruise_key,
       datetime, depth_min_m AS depth_min, depth_max_m AS depth_max, sample_key
FROM read_parquet(r('obs/**/*.parquet'), hive_partitioning=true)
WHERE grid_key IS NOT NULL;

-- per (grid_key, dataset_key) coverage; clamp sentinel/absurd depths (e.g. -888)
CREATE TEMP TABLE cov AS
SELECT grid_key, dataset_key, any_value(realm) AS realm,
       min(datetime)::DATE AS time_min, max(datetime)::DATE AS time_max,
       min(CASE WHEN depth_min BETWEEN 0 AND 6000 THEN depth_min END) AS depth_min,
       max(CASE WHEN depth_max BETWEEN 0 AND 6000 THEN depth_max END) AS depth_max,
       count(*) AS n_obs,
       count(DISTINCT sample_key) AS n_samples,
       count(DISTINCT cruise_key) AS n_surveys
FROM obs GROUP BY grid_key, dataset_key;

CREATE TEMP TABLE ybin AS
SELECT grid_key, dataset_key, list(struct_pack(y := yr, n := n) ORDER BY yr) AS years
FROM (SELECT grid_key, dataset_key, year(datetime) AS yr, count(*) AS n
      FROM obs WHERE datetime IS NOT NULL GROUP BY 1,2,3)
GROUP BY 1,2;

CREATE TEMP TABLE mbin AS
SELECT grid_key, dataset_key, list(struct_pack(m := mo, n := n) ORDER BY mo) AS months
FROM (SELECT grid_key, dataset_key, month(datetime) AS mo, count(*) AS n
      FROM obs WHERE datetime IS NOT NULL GROUP BY 1,2,3)
GROUP BY 1,2;

-- per grid_key: list of per-dataset coverage structs + station rollups
CREATE TEMP TABLE ds AS
SELECT c.grid_key,
       list(struct_pack(
         dataset_key := c.dataset_key, realm := c.realm,
         time_min := c.time_min, time_max := c.time_max,
         depth_min := c.depth_min, depth_max := c.depth_max,
         n_obs := c.n_obs, n_samples := c.n_samples, n_surveys := c.n_surveys,
         years := y.years, months := m.months) ORDER BY c.dataset_key) AS datasets,
       count(*) AS n_datasets,
       min(c.time_min) AS time_min, max(c.time_max) AS time_max,
       sum(c.n_obs) AS n_obs, sum(c.n_samples) AS n_samples
FROM cov c
LEFT JOIN ybin y USING (grid_key, dataset_key)
LEFT JOIN mbin m USING (grid_key, dataset_key)
GROUP BY c.grid_key;

-- distinct cruises per station across all datasets
CREATE TEMP TABLE srv AS
SELECT grid_key, count(DISTINCT cruise_key) AS n_surveys FROM obs GROUP BY 1;

COPY (
  SELECT g.grid_key,
         printf('%05.1f %05.1f', g.line, g.station) AS station_id,
         g.line, g.station, round(g.lat, 5) AS lat, round(g.lon, 5) AS lon,
         g.pattern, g.shore, g.zone, round(g.area_km2, 2) AS area_km2,
         coalesce(d.n_datasets, 0) AS n_datasets,
         d.time_min, d.time_max,
         coalesce(d.n_obs, 0) AS n_obs, coalesce(d.n_samples, 0) AS n_samples,
         coalesce(s.n_surveys, 0) AS n_surveys,
         d.datasets
  FROM grid g
  LEFT JOIN ds d USING (grid_key)
  LEFT JOIN srv s USING (grid_key)
  ORDER BY g.grid_key
) TO 'public/data/stations.json' (FORMAT JSON, ARRAY true);
