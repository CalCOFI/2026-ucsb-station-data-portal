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
-- Data source: gs://calcofi-db/ingest/{provider_dataset}/{table}.parquet (public).
-- Regenerate on every DB release (see .github/workflows).

INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;

-- ingest parquet base (single-file tables read over HTTPS; partitioned tables
-- like ctd_thin are NOT HTTPS-globbable, so CTD depth is deferred below).
CREATE TEMP MACRO u(p) AS 'https://storage.googleapis.com/calcofi-db/ingest/' || p;

-- stations = grid cells; lat/lon from the geom_ctr centroid POINT
CREATE TEMP TABLE grid AS
SELECT grid_key, line, station, pattern, shore, zone, area_km2,
       ST_X(geom_ctr) AS lon, ST_Y(geom_ctr) AS lat
FROM read_parquet(u('swfsc_ichthyo/grid.parquet'));

-- unified observation stream: one row per measurement (or per sample where no
-- measurement table), carrying dataset_id + grid_key + cruise_key + datetime +
-- depth range. This is a build-time preview of the Part B v_obs_env/v_obs_bio views.
CREATE TEMP TABLE obs AS
-- calcofi_bottle (env): measurement -> bottle(depth) -> casts(grid_key,time)
SELECT 'calcofi_bottle' AS dataset_id, 'env' AS realm, c.grid_key,
       CAST(c.cruise_key AS VARCHAR) AS cruise_key,
       CAST(c.datetime_start_utc AS TIMESTAMP) AS datetime,
       CAST(b.depth_m AS DOUBLE) AS depth_min, CAST(b.depth_m AS DOUBLE) AS depth_max,
       CAST(c.cast_id AS VARCHAR) AS sample_key
FROM read_parquet(u('calcofi_bottle/bottle_measurement.parquet')) m
JOIN read_parquet(u('calcofi_bottle/bottle.parquet')) b USING (bottle_id)
JOIN read_parquet(u('calcofi_bottle/casts.parquet')) c USING (cast_id)
WHERE c.grid_key IS NOT NULL
UNION ALL
-- calcofi_ctd-cast (env): collapse per-scan ctd_cast to one row per cast
-- (depth deferred: ctd_thin is hive-partitioned, not readable via HTTPS glob)
SELECT 'calcofi_ctd-cast', 'env', grid_key, CAST(cruise_key AS VARCHAR),
       CAST(min(datetime_start_utc) AS TIMESTAMP), NULL::DOUBLE, NULL::DOUBLE, CAST(cast_key AS VARCHAR)
FROM read_parquet(u('calcofi_ctd-cast/ctd_cast.parquet')) WHERE grid_key IS NOT NULL
GROUP BY grid_key, cruise_key, cast_key
UNION ALL
-- calcofi_dic (env): measurement -> casts(grid_key) via cast_id
SELECT 'calcofi_dic', 'env', c.grid_key, CAST(c.cruise_key AS VARCHAR),
       CAST(dm.datetime_start_utc AS TIMESTAMP), CAST(dm.depth_m AS DOUBLE), CAST(dm.depth_m AS DOUBLE),
       CAST(dm.cast_id AS VARCHAR)
FROM read_parquet(u('calcofi_dic/dic_measurement.parquet')) dm
JOIN read_parquet(u('calcofi_bottle/casts.parquet')) c USING (cast_id)
WHERE c.grid_key IS NOT NULL
UNION ALL
-- swfsc_ichthyo (bio): ichthyo -> net -> tow(time) -> site(grid_key)
SELECT 'swfsc_ichthyo', 'bio', s.grid_key, CAST(s.cruise_key AS VARCHAR),
       CAST(t.datetime_start_utc AS TIMESTAMP), NULL::DOUBLE, NULL::DOUBLE, CAST(s.site_uuid AS VARCHAR)
FROM read_parquet(u('swfsc_ichthyo/ichthyo.parquet')) i
JOIN read_parquet(u('swfsc_ichthyo/net.parquet')) n USING (net_uuid)
JOIN read_parquet(u('swfsc_ichthyo/tow.parquet')) t USING (tow_uuid)
JOIN read_parquet(u('swfsc_ichthyo/site.parquet')) s USING (site_uuid)
WHERE s.grid_key IS NOT NULL
UNION ALL
-- swfsc_cufes (bio, surface): measurement -> sample
SELECT 'swfsc_cufes', 'bio', c.grid_key, CAST(c.cruise_key AS VARCHAR),
       CAST(c.datetime_start_utc AS TIMESTAMP), 0::DOUBLE, 0::DOUBLE, CAST(c.sample_id AS VARCHAR)
FROM read_parquet(u('swfsc_cufes/cufes_measurement.parquet')) m
JOIN read_parquet(u('swfsc_cufes/cufes_sample.parquet')) c USING (sample_id)
WHERE c.grid_key IS NOT NULL
UNION ALL
-- cce-lter_euphausiids (bio, depth-integrated): measurement -> tow
SELECT 'cce-lter_euphausiids', 'bio', tw.grid_key, CAST(tw.cruise_key AS VARCHAR),
       CAST(tw.datetime_start_utc AS TIMESTAMP), NULL::DOUBLE, NULL::DOUBLE, CAST(tw.tow_id AS VARCHAR)
FROM read_parquet(u('cce-lter_euphausiids/euphausiids_measurement.parquet')) m
JOIN read_parquet(u('cce-lter_euphausiids/euphausiids_tow.parquet')) tw USING (tow_id)
WHERE tw.grid_key IS NOT NULL
UNION ALL
-- pic_zooplankton (bio, tow range): tow only (no measurement table)
SELECT 'pic_zooplankton', 'bio', grid_key, CAST(cruise_key AS VARCHAR),
       CAST(datetime_start_utc AS TIMESTAMP), CAST(depth_min_m AS DOUBLE), CAST(depth_max_m AS DOUBLE),
       CAST(tow_id AS VARCHAR)
FROM read_parquet(u('pic_zooplankton/zooplankton_tow.parquet')) WHERE grid_key IS NOT NULL
UNION ALL
-- calcofi_phyllosoma (bio, 0..max_tow_depth): measurement -> tow
SELECT 'calcofi_phyllosoma', 'bio', tw.grid_key, CAST(tw.cruise_key AS VARCHAR),
       CAST(tw.datetime_start_utc AS TIMESTAMP), 0::DOUBLE, CAST(tw.max_tow_depth_m AS DOUBLE),
       CAST(tw.tow_id AS VARCHAR)
FROM read_parquet(u('calcofi_phyllosoma/phyllosoma_measurement.parquet')) m
JOIN read_parquet(u('calcofi_phyllosoma/phyllosoma_tow.parquet')) tw USING (tow_id)
WHERE tw.grid_key IS NOT NULL
UNION ALL
-- cce-lter_zoodb (bio, tow range): measurement -> sample
SELECT 'cce-lter_zoodb', 'bio', sp.grid_key, CAST(sp.cruise_key AS VARCHAR),
       CAST(sp.datetime_start_utc AS TIMESTAMP), CAST(sp.min_depth_m AS DOUBLE), CAST(sp.max_depth_m AS DOUBLE),
       CAST(sp.sample_id AS VARCHAR)
FROM read_parquet(u('cce-lter_zoodb/zoodb_measurement.parquet')) m
JOIN read_parquet(u('cce-lter_zoodb/zoodb_sample.parquet')) sp USING (sample_id)
WHERE sp.grid_key IS NOT NULL
UNION ALL
-- cce-lter_zooscan (bio, tow range): measurement -> sample (time = station_date)
SELECT 'cce-lter_zooscan', 'bio', sp.grid_key, CAST(sp.cruise_key AS VARCHAR),
       CAST(sp.station_date AS TIMESTAMP), CAST(sp.min_depth_m AS DOUBLE), CAST(sp.max_depth_m AS DOUBLE),
       CAST(sp.sample_id AS VARCHAR)
FROM read_parquet(u('cce-lter_zooscan/zooscan_measurement.parquet')) m
JOIN read_parquet(u('cce-lter_zooscan/zooscan_sample.parquet')) sp USING (sample_id)
WHERE sp.grid_key IS NOT NULL
UNION ALL
-- calcofi_bird_mammal_census (bio, surface): observation -> transect
SELECT 'calcofi_bird_mammal_census', 'bio', tr.grid_key,
       CAST(coalesce(tr.cruise_key, tr.cruise_label) AS VARCHAR),
       CAST(tr.datetime_start_utc AS TIMESTAMP), 0::DOUBLE, 0::DOUBLE, CAST(tr.gis_key AS VARCHAR)
FROM read_parquet(u('calcofi_bird_mammal_census/bird_mammal_observation.parquet')) o
JOIN read_parquet(u('calcofi_bird_mammal_census/bird_mammal_transect.parquet')) tr USING (gis_key)
WHERE tr.grid_key IS NOT NULL;

-- per (grid_key, dataset_id) coverage; clamp sentinel/absurd depths (e.g. -888)
CREATE TEMP TABLE cov AS
SELECT grid_key, dataset_id, any_value(realm) AS realm,
       min(datetime)::DATE AS time_min, max(datetime)::DATE AS time_max,
       min(CASE WHEN depth_min BETWEEN 0 AND 6000 THEN depth_min END) AS depth_min,
       max(CASE WHEN depth_max BETWEEN 0 AND 6000 THEN depth_max END) AS depth_max,
       count(*) AS n_obs,
       count(DISTINCT sample_key) AS n_samples,
       count(DISTINCT cruise_key) AS n_surveys
FROM obs GROUP BY grid_key, dataset_id;

CREATE TEMP TABLE ybin AS
SELECT grid_key, dataset_id, list(struct_pack(y := yr, n := n) ORDER BY yr) AS years
FROM (SELECT grid_key, dataset_id, year(datetime) AS yr, count(*) AS n
      FROM obs WHERE datetime IS NOT NULL GROUP BY 1,2,3)
GROUP BY 1,2;

CREATE TEMP TABLE mbin AS
SELECT grid_key, dataset_id, list(struct_pack(m := mo, n := n) ORDER BY mo) AS months
FROM (SELECT grid_key, dataset_id, month(datetime) AS mo, count(*) AS n
      FROM obs WHERE datetime IS NOT NULL GROUP BY 1,2,3)
GROUP BY 1,2;

-- per grid_key: list of per-dataset coverage structs + station rollups
CREATE TEMP TABLE ds AS
SELECT c.grid_key,
       list(struct_pack(
         dataset_id := c.dataset_id, realm := c.realm,
         time_min := c.time_min, time_max := c.time_max,
         depth_min := c.depth_min, depth_max := c.depth_max,
         n_obs := c.n_obs, n_samples := c.n_samples, n_surveys := c.n_surveys,
         years := y.years, months := m.months) ORDER BY c.dataset_id) AS datasets,
       count(*) AS n_datasets,
       min(c.time_min) AS time_min, max(c.time_max) AS time_max,
       sum(c.n_obs) AS n_obs, sum(c.n_samples) AS n_samples
FROM cov c
LEFT JOIN ybin y USING (grid_key, dataset_id)
LEFT JOIN mbin m USING (grid_key, dataset_id)
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
