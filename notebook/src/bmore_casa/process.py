"""Normalize raw ArcGIS batches into Parquet, DuckDB and frontend assets.

Outputs
  data/processed/*.parquet        normalized analytical tables
  data/processed/baltimore.duckdb same tables + aggregate views
  data/processed/quality_report.json
  ../web/public/data/*         lightweight frontend assets
"""

import gzip
import json
import math
import re
import shutil
from datetime import date, datetime, timezone

import duckdb
import numpy as np
import polars as pl
import shapely
from shapely.geometry import mapping, shape

from .sources import LAYERS, PROCESSED_DIR, PUBLIC_DIR, RAW_DIR

LOCAL_TZ = "America/New_York"

# Permit categories are derived from the CaseNumber prefix. The service publishes
# no code list; groupings were checked against sampled permit descriptions.
# Legacy-system prefixes (COM/USE/DEM/TMP/BMZ) stop in early 2025, when the
# B-prefixed system (BRCM/BCCM/BUSE/BDEM/BTEMP) takes over.
PERMIT_CATEGORIES = {
    "COM": "construction",
    "BRCM": "construction",
    "BCCM": "construction",
    "USE": "use",
    "BUSE": "use",
    "DEM": "demolition",
    "BDEM": "demolition",
    "TMP": "temporary",
    "BTEMP": "temporary",
    "BMZ": "zoning",
}

# Order is the type index used in compact frontend assets.
ACTIVITY_TYPES = [
    "vacant",
    "rehab",
    "demolition",
    "permit_construction",
    "permit_use",
    "permit_demolition",
    "permit_temporary",
    "permit_zoning",
    "permit_other",
]

HEX_RADIUS_M = 160.0
LON0, LAT0 = -76.62, 39.29
M_PER_DEG_LAT = 110_574.0
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(LAT0))


# ---------------------------------------------------------------- loading


def load_features(key: str) -> list[dict]:
    files = sorted((RAW_DIR / key).glob("batch_*.json.gz"))
    if not files:
        raise SystemExit(f"no raw data for '{key}' - run `bmore-casa download` first")
    features: list[dict] = []
    for path in files:
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            features.extend(json.load(fh))
    return features


def load_points(key: str) -> pl.DataFrame:
    rows = []
    for feature in load_features(key):
        row = dict(feature["attributes"])
        geometry = feature.get("geometry") or {}
        row["lon"], row["lat"] = geometry.get("x"), geometry.get("y")
        rows.append(row)
    return pl.DataFrame(rows, infer_schema_length=None)


# ---------------------------------------------------------------- normalizers


def local_date(column: str, wall_clock_utc: bool = False) -> pl.Expr:
    """Epoch-ms -> Baltimore calendar date.

    The DHCD FeatureServer stores true UTC instants (local midnight appears as
    04:00/05:00Z). dmxLandPlanning/37 stores local wall-clock time labelled as
    UTC (verified: it trails layer 1 by exactly 4h in EDT and 5h in EST), so its
    UTC date already is the local date.
    """
    instant = pl.from_epoch(pl.col(column), time_unit="ms").dt.replace_time_zone("UTC")
    if not wall_clock_utc:
        instant = instant.dt.convert_time_zone(LOCAL_TZ)
    return instant.dt.date()


def clean_text(column: str) -> pl.Expr:
    cleaned = pl.col(column).cast(pl.String).str.replace_all(r"\s+", " ").str.strip_chars()
    return pl.when(cleaned == "").then(None).otherwise(cleaned)


def clean_address(column: str = "Address") -> pl.Expr:
    return clean_text(column).str.to_uppercase()


class NeighborhoodIndex:
    def __init__(self, features: list[dict]):
        self.names: list[str] = []
        geoms = []
        self.attributes: list[dict] = []
        for feature in sorted(features, key=lambda f: f["attributes"]["Name"]):
            rings = feature["geometry"]["rings"]
            geom = shapely.make_valid(_esri_rings_to_geometry(rings))
            self.names.append(feature["attributes"]["Name"].strip())
            self.attributes.append(feature["attributes"])
            geoms.append(geom)
        self.geoms = geoms
        self.tree = shapely.STRtree(geoms)
        self.bounds = shapely.union_all(geoms).bounds

    def locate(self, lon: np.ndarray, lat: np.ndarray) -> list[str | None]:
        points = shapely.points(lon, lat)
        point_idx, geom_idx = self.tree.query(points, predicate="intersects")
        found: list[str | None] = [None] * len(points)
        # a point on a shared edge can hit two polygons; first hit wins
        for p, g in zip(point_idx[::-1], geom_idx[::-1]):
            found[p] = self.names[g]
        return found


def _esri_rings_to_geometry(rings: list[list[list[float]]]):
    """Esri polygons: clockwise rings are exteriors, counter-clockwise are holes."""
    exteriors, holes = [], []
    for ring in rings:
        linear = shapely.LinearRing(ring)
        (holes if linear.is_ccw else exteriors).append(linear)
    polygons = []
    for ext in exteriors:
        shell = shapely.Polygon(ext)
        inner = [h for h in holes if shell.contains(shapely.Polygon(h).representative_point())]
        polygons.append(shapely.Polygon(ext, inner))
    return polygons[0] if len(polygons) == 1 else shapely.MultiPolygon(polygons)


def normalize(
    df: pl.DataFrame,
    *,
    key: str,
    nbhd: NeighborhoodIndex,
    report: dict,
    date_columns: dict[str, str],
    primary_date: str,
    wall_clock_utc: bool = False,
) -> pl.DataFrame:
    """Shared cleaning: duplicates, coordinates, dates, address, neighborhood."""
    stats: dict = {"raw_records": df.height}

    deduped = df.unique(subset=[c for c in df.columns if c != "OBJECTID"], keep="first", maintain_order=True)
    stats["exact_duplicates_removed"] = df.height - deduped.height
    df = deduped

    minx, miny, maxx, maxy = nbhd.bounds
    has_xy = pl.col("lon").is_not_null() & pl.col("lat").is_not_null() & pl.col("lon").is_finite() & pl.col("lat").is_finite()
    in_city_bbox = has_xy & pl.col("lon").is_between(minx - 0.01, maxx + 0.01) & pl.col("lat").is_between(miny - 0.01, maxy + 0.01)
    stats["missing_coordinates"] = df.filter(~has_xy).height
    stats["outside_city_bbox"] = df.filter(has_xy & ~in_city_bbox).height
    df = df.with_columns(
        pl.when(in_city_bbox).then(pl.col("lon")).otherwise(None).alias("lon"),
        pl.when(in_city_bbox).then(pl.col("lat")).otherwise(None).alias("lat"),
    )

    df = df.with_columns(
        [local_date(src, wall_clock_utc).alias(dst) for dst, src in date_columns.items()]
        + [clean_address().alias("address"), clean_text("BLOCKLOT").alias("blocklot"), clean_text("Neighborhood").alias("neighborhood_source")]
    )
    today = date.today()
    bad_date = pl.col(primary_date).is_null() | (pl.col(primary_date) > today) | (pl.col(primary_date) < date(1990, 1, 1))
    stats["missing_or_implausible_primary_date"] = df.filter(bad_date).height
    df = df.with_columns(pl.when(bad_date).then(None).otherwise(pl.col(primary_date)).alias(primary_date))
    df = df.with_columns(pl.col(primary_date).dt.year().alias("year"))

    # Row index, not OBJECTID: the demolition layer reuses OBJECTIDs across
    # distinct demolition events, so OBJECTID is not a safe join key.
    df = df.with_row_index("_row")
    stats["reused_object_ids"] = df.height - df["OBJECTID"].n_unique()
    located = df.filter(pl.col("lon").is_not_null())
    spatial = pl.DataFrame(
        {"_row": located["_row"], "neighborhood_spatial": nbhd.locate(located["lon"].to_numpy(), located["lat"].to_numpy())},
        schema={"_row": df.schema["_row"], "neighborhood_spatial": pl.String},
    )
    df = df.join(spatial, on="_row", how="left").drop("_row")
    valid_label = pl.col("neighborhood_source").is_in(nbhd.names)
    both = df.filter(valid_label & pl.col("neighborhood_spatial").is_not_null())
    stats["source_label_missing_or_unknown"] = df.filter(~valid_label | pl.col("neighborhood_source").is_null()).height
    stats["label_vs_spatial_join_agreement"] = round(
        both.filter(pl.col("neighborhood_source") == pl.col("neighborhood_spatial")).height / max(both.height, 1), 4
    )
    # Source label wins (it is the city's own assignment); the spatial join only
    # fills records the source left blank.
    df = df.with_columns(
        pl.when(valid_label).then(pl.col("neighborhood_source")).otherwise(pl.col("neighborhood_spatial")).alias("neighborhood")
    )
    stats["neighborhood_filled_by_spatial_join"] = df.filter(~valid_label.fill_null(False) & pl.col("neighborhood").is_not_null()).height
    stats["neighborhood_unassigned"] = df.filter(pl.col("neighborhood").is_null()).height
    stats["distinct_parcels_blocklot"] = df["blocklot"].n_unique()
    stats["records_after_cleaning"] = df.height
    if df.height:
        stats["date_range"] = [str(df[primary_date].min()), str(df[primary_date].max())]
    report[key] = stats
    return df


# ---------------------------------------------------------------- hex grid


def hex_cells(lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Flat-top axial hex coordinates on a local equirectangular plane."""
    x = (lon - LON0) * M_PER_DEG_LON
    y = (lat - LAT0) * M_PER_DEG_LAT
    q = (2.0 / 3.0 * x) / HEX_RADIUS_M
    r = (-1.0 / 3.0 * x + math.sqrt(3) / 3.0 * y) / HEX_RADIUS_M
    s = -q - r
    rq, rr, rs = np.round(q), np.round(r), np.round(s)
    dq, dr, ds = np.abs(rq - q), np.abs(rr - r), np.abs(rs - s)
    fix_q = (dq > dr) & (dq > ds)
    fix_r = ~fix_q & (dr > ds)
    rq = np.where(fix_q, -rr - rs, rq)
    rr = np.where(fix_r, -rq - rs, rr)
    return rq.astype(np.int32), rr.astype(np.int32)


def hex_center(q: np.ndarray, r: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    x = HEX_RADIUS_M * 1.5 * q
    y = HEX_RADIUS_M * math.sqrt(3) * (r + q / 2.0)
    return LON0 + x / M_PER_DEG_LON, LAT0 + y / M_PER_DEG_LAT


# ---------------------------------------------------------------- main


def run() -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((RAW_DIR / "manifest.json").read_text())
    report: dict = {}

    nbhd = NeighborhoodIndex(load_features("neighborhoods"))
    print(f"neighborhoods: {len(nbhd.names)} polygons")

    # ---- dataset-specific normalization
    vacant = normalize(
        load_points("vacant_open"), key="vacant_open", nbhd=nbhd, report=report,
        date_columns={"notice_date": "DateNotice"}, primary_date="notice_date",
    ).select(
        pl.col("OBJECTID").alias("object_id"), pl.col("NoticeNum").alias("notice_num"), "notice_date", "year",
        "address", "blocklot", "neighborhood", "neighborhood_source", clean_text("OWNER_ABBR").alias("owner_abbr"),
        pl.col("Council_District").cast(pl.Int32, strict=False).alias("council_district"),
        clean_text("HousingMarketTypology2023").alias("market_typology_2023"), "lon", "lat",
    )

    vacant_all = normalize(
        load_points("vacant_all"), key="vacant_all", nbhd=nbhd, report=report,
        date_columns={"notice_date": "DateNotice"}, primary_date="notice_date", wall_clock_utc=True,
    ).select(
        pl.col("OBJECTID").alias("object_id"), pl.col("NoticeNum").alias("notice_num"), "notice_date", "year",
        "address", "blocklot", "neighborhood", "lon", "lat",
    )

    rehabs = normalize(
        load_points("rehabs"), key="rehabs", nbhd=nbhd, report=report,
        date_columns={"issue_date": "DateIssue"}, primary_date="issue_date",
    ).select(
        pl.col("OBJECTID").alias("object_id"), pl.col("PermitNum").alias("permit_num"), "issue_date", "year",
        "address", "blocklot", "neighborhood", "neighborhood_source",
        clean_text("ExistingUse").alias("existing_use"), clean_text("ProposedUse").alias("proposed_use"),
        clean_text("VBN").alias("vbn_flag"), "lon", "lat",
    )

    demolitions = normalize(
        load_points("demolitions"), key="demolitions", nbhd=nbhd, report=report,
        date_columns={"finished_date": "DateDemoFinished", "started_date": "DateStarted"}, primary_date="finished_date",
    ).select(
        pl.col("OBJECTID").alias("object_id"), "finished_date", "started_date", "year",
        "address", "blocklot", "neighborhood", "neighborhood_source",
        clean_text("SimplifiedStatus").alias("status"), clean_text("Deconstruction").alias("deconstruction"), "lon", "lat",
    )

    permits = normalize(
        load_points("permits"), key="permits", nbhd=nbhd, report=report,
        date_columns={"issued_date": "IssuedDate", "expiration_date": "ExpirationDate"}, primary_date="issued_date",
    )
    prefix = pl.col("CaseNumber").str.extract(r"^([A-Za-z]+)", 1).str.to_uppercase()
    permits = permits.select(
        pl.col("OBJECTID").alias("object_id"), pl.col("CaseNumber").alias("case_number"), prefix.alias("case_prefix"),
        prefix.replace_strict(PERMIT_CATEGORIES, default="other").alias("category"),
        "issued_date", "expiration_date", "year", "address", "blocklot", "neighborhood", "neighborhood_source",
        clean_text("ExistingUse").alias("existing_use"), clean_text("ProposedUse").alias("proposed_use"),
        pl.col("Cost").cast(pl.Float64, strict=False).alias("cost"),
        (pl.col("IsPermitModification") == 1).alias("is_modification"),
        clean_text("Description").alias("description"), "lon", "lat",
    )
    report["permits"]["permit_modifications"] = permits.filter(pl.col("is_modification")).height
    report["permits"]["cost_null"] = permits.filter(pl.col("cost").is_null()).height
    report["permits"]["cost_nonpositive"] = permits.filter(pl.col("cost") <= 0).height
    report["permits"]["cost_over_100m"] = permits.filter(pl.col("cost") > 1e8).height
    report["permits"]["category_counts"] = dict(permits["category"].value_counts(sort=True).rows())
    report["permits"]["prefix_counts"] = dict(permits["case_prefix"].value_counts(sort=True).rows())

    # ---- validated cross-dataset links on the shared parcel key (BLOCKLOT)
    rehab_by_lot = rehabs.group_by("blocklot").agg(pl.col("issue_date").max().alias("rehab_issue_date"))
    demo_by_lot = demolitions.group_by("blocklot").agg(pl.col("finished_date").max().alias("demo_finished_date"))
    vacant = vacant.join(rehab_by_lot, on="blocklot", how="left").join(demo_by_lot, on="blocklot", how="left")

    # ---- neighborhoods table with denominators
    parcel_rows = json.loads((RAW_DIR / "parcels" / "parcel_counts.json").read_text())
    by_upper = {name.upper(): name for name in nbhd.names}
    parcels: dict[str, int] = {}
    unmatched_parcels = 0
    for row in parcel_rows:
        label = re.sub(r"\s+", " ", (row["NEIGHBOR"] or "")).strip().upper()
        if label in by_upper:
            parcels[by_upper[label]] = parcels.get(by_upper[label], 0) + row["n"]
        else:
            unmatched_parcels += row["n"]
    report["parcels"] = {
        "total_parcels": sum(r["n"] for r in parcel_rows),
        "parcels_without_matching_neighborhood": unmatched_parcels,
        "neighborhoods_with_parcel_count": len(parcels),
    }
    neighborhoods = pl.DataFrame(
        {
            "neighborhood": nbhd.names,
            "parcels": [parcels.get(n) for n in nbhd.names],
            "housing_units_census": [a.get("Total_Units") for a in nbhd.attributes],
            "vacant_units_census": [a.get("Occ_Vacant") for a in nbhd.attributes],
            "population_census": [a.get("Population") for a in nbhd.attributes],
        }
    )

    # ---- unified event table
    def events_of(df: pl.DataFrame, dataset: str, type_expr: pl.Expr, date_col: str, id_col: str) -> pl.DataFrame:
        return df.select(
            pl.lit(dataset).alias("dataset"), type_expr.alias("activity_type"), pl.col(id_col).cast(pl.String).alias("record_id"),
            pl.col(date_col).alias("event_date"), "year", "address", "blocklot", "neighborhood", "lon", "lat",
        )

    events = pl.concat(
        [
            events_of(vacant, "vacant_open", pl.lit("vacant"), "notice_date", "notice_num"),
            events_of(rehabs, "rehabs", pl.lit("rehab"), "issue_date", "permit_num"),
            events_of(demolitions, "demolitions", pl.lit("demolition"), "finished_date", "object_id"),
            events_of(permits, "permits", pl.lit("permit_") + pl.col("category"), "issued_date", "case_number"),
        ]
    )

    agg_nyt = (
        events.filter(pl.col("neighborhood").is_not_null() & pl.col("year").is_not_null())
        .group_by("neighborhood", "year", "activity_type")
        .agg(pl.len().alias("records"), pl.col("blocklot").n_unique().alias("distinct_parcels"))
        .sort("neighborhood", "year", "activity_type")
    )
    agg_city = (
        events.filter(pl.col("year").is_not_null())
        .group_by("year", "activity_type")
        .agg(pl.len().alias("records"), pl.col("blocklot").n_unique().alias("distinct_parcels"))
        .sort("year", "activity_type")
    )

    # ---- write Parquet + DuckDB
    tables = {
        "vacant_open": vacant, "vacant_all_snapshot": vacant_all, "rehabs": rehabs, "demolitions": demolitions,
        "permits": permits, "neighborhoods": neighborhoods, "events": events,
        "agg_neighborhood_year_type": agg_nyt, "agg_city_year_type": agg_city,
    }
    for name, df in tables.items():
        df.write_parquet(PROCESSED_DIR / f"{name}.parquet", compression="zstd")
    db_path = PROCESSED_DIR / "baltimore.duckdb"
    db_path.unlink(missing_ok=True)
    con = duckdb.connect(str(db_path))
    for name in tables:
        con.execute(f"CREATE TABLE {name} AS SELECT * FROM read_parquet('{(PROCESSED_DIR / f'{name}.parquet').as_posix()}')")
    con.execute(
        """
        CREATE VIEW neighborhood_summary AS
        SELECT n.neighborhood, n.parcels, n.housing_units_census,
               count(*) FILTER (e.activity_type = 'vacant') AS open_vacant_notices,
               count(*) FILTER (e.activity_type = 'rehab') AS rehab_records,
               count(*) FILTER (e.activity_type = 'demolition') AS demolition_records,
               count(*) FILTER (e.activity_type LIKE 'permit_%') AS permit_records,
               round(1000.0 * count(*) FILTER (e.activity_type = 'vacant') / nullif(n.parcels, 0), 1) AS open_notices_per_1k_parcels
        FROM neighborhoods n LEFT JOIN events e USING (neighborhood)
        GROUP BY n.neighborhood, n.parcels, n.housing_units_census
        """
    )
    con.close()

    findings = compute_findings(vacant, vacant_all, rehabs, demolitions, permits, neighborhoods)
    report["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    (PROCESSED_DIR / "quality_report.json").write_text(json.dumps(report, indent=2, default=str))
    (PROCESSED_DIR / "findings.json").write_text(json.dumps(findings, indent=2, default=str))

    write_frontend_assets(nbhd, vacant, rehabs, demolitions, permits, events, neighborhoods, agg_nyt, agg_city, manifest, report, findings)

    print("\nQuality report")
    for key, stats in report.items():
        if isinstance(stats, dict):
            print(f"  {key}: " + ", ".join(f"{k}={v}" for k, v in stats.items() if not isinstance(v, (dict, list))))
    print("\nFindings")
    for finding in findings["findings"]:
        print(f"  - {finding['title']}: {finding['text']}")


# ---------------------------------------------------------------- findings


def compute_findings(vacant, vacant_all, rehabs, demolitions, permits, neighborhoods) -> dict:
    """Every number here is computed from the processed tables - nothing is hand-entered."""
    out: list[dict] = []
    n_open = vacant.height

    # 1. age of the open notices
    before_2016 = vacant.filter(pl.col("year") < 2016).height
    last_5y = vacant.filter(pl.col("year") >= 2022).height
    oldest = vacant["notice_date"].min()
    out.append({
        "id": "notice_age", "title": "Many open notices are old",
        "text": f"Of {n_open:,} vacant building notices still open in the snapshot, {before_2016:,} ({before_2016 / n_open:.0%}) were issued before 2016; "
                f"the oldest dates to {oldest}. {last_5y:,} ({last_5y / n_open:.0%}) were issued in 2022 or later.",
        "metric": "open vacant building notices by year of DateNotice",
        "values": {"open_notices": n_open, "issued_before_2016": before_2016, "issued_2022_or_later": last_5y, "oldest_notice_date": str(oldest)},
    })

    # 2. geographic concentration
    by_n = vacant.filter(pl.col("neighborhood").is_not_null()).group_by("neighborhood").agg(pl.len().alias("n")).sort("n", descending=True)
    top10 = by_n.head(10)
    share = top10["n"].sum() / n_open
    zero = len(neighborhoods) - by_n.height
    out.append({
        "id": "concentration", "title": "Open notices are geographically concentrated",
        "text": f"10 of {len(neighborhoods)} neighborhoods hold {share:.0%} of all open notices (led by {top10['neighborhood'][0]} with {top10['n'][0]:,}), "
                f"while {zero} neighborhoods have none.",
        "metric": "open vacant building notices per neighborhood (raw counts)",
        "values": {"top10": top10.rows(), "top10_share": round(share, 4), "neighborhoods_with_zero": zero},
    })

    # 3. rehab trend
    rehab_years = rehabs.group_by("year").agg(pl.len().alias("n")).sort("year")
    full_years = rehab_years.filter(pl.col("year") < date.today().year)
    peak = full_years.sort("n", descending=True).row(0)
    first = full_years.row(0)
    out.append({
        "id": "rehab_trend", "title": "Recorded rehab permits on vacant buildings over time",
        "text": f"The rehab layer records {rehabs.height:,} parcels (one record per parcel). By permit issue year, records go from {first[1]:,} in {first[0]} "
                f"to a peak of {peak[1]:,} in {peak[0]}. {date.today().year} is a partial year.",
        "metric": "rehab records by year of DateIssue",
        "values": {"by_year": rehab_years.rows()},
    })

    # 4. demolition trend
    demo_years = demolitions.group_by("year").agg(pl.len().alias("n")).sort("year")
    dpeak = demo_years.sort("n", descending=True).row(0)
    dfull = demo_years.filter(pl.col("year") < date.today().year)
    dlast = dfull.row(-1)
    out.append({
        "id": "demolition_trend", "title": "City demolitions peaked, then fell",
        "text": f"Completed city demolitions peak at {dpeak[1]:,} in {dpeak[0]}; the latest full year ({dlast[0]}) records {dlast[1]:,}.",
        "metric": "completed city demolition records by year of DateDemoFinished",
        "values": {"by_year": demo_years.rows()},
    })

    # 5. validated parcel links
    with_rehab = vacant.filter(pl.col("rehab_issue_date").is_not_null())
    rehab_after = with_rehab.filter(pl.col("rehab_issue_date") >= pl.col("notice_date")).height
    with_demo = vacant.filter(pl.col("demo_finished_date").is_not_null()).height
    out.append({
        "id": "parcel_links", "title": "A rehab permit is not the end of the story",
        "text": f"Linking on the shared BLOCKLOT parcel ID, {with_rehab.height:,} of {n_open:,} open-notice parcels ({with_rehab.height / n_open:.1%}) also appear in the rehab layer. "
                f"In {with_rehab.height - rehab_after:,} of those cases the rehab permit was issued before the currently open notice ({rehab_after:,} on or after it) - "
                f"the records cannot say whether that rehab was completed. {with_demo:,} open-notice parcels also have a completed city demolition record.",
        "metric": "parcel-level join on BLOCKLOT between open notices, rehab records and demolition records",
        "values": {"open_with_rehab_record": with_rehab.height, "rehab_on_or_after_notice": rehab_after, "open_with_demolition_record": with_demo},
    })

    # 6. permits are not buildings
    out.append({
        "id": "permits_vs_parcels", "title": "Permits are not buildings",
        "text": f"{permits.height:,} permit records cover only {permits['blocklot'].n_unique():,} distinct parcels; "
                f"{permits.filter(pl.col('is_modification')).height:,} records are flagged as modifications of an earlier permit.",
        "metric": "building permit records vs distinct BLOCKLOT values",
        "values": {"permit_records": permits.height, "distinct_parcels": permits["blocklot"].n_unique()},
    })

    # 7. snapshot churn between the two open-notice layers
    a, b = set(vacant["notice_num"]), set(vacant_all["notice_num"])
    out.append({
        "id": "snapshot_churn", "title": "Two snapshots of the open list",
        "text": f"The DHCD open-notice layer (latest notice {vacant['notice_date'].max()}) and the dmxLandPlanning layer (latest notice {vacant_all['notice_date'].max()}) "
                f"share {len(a & b):,} notices. {len(a - b):,} notices appear only in the earlier snapshot and {len(b - a):,} only in the later one. "
                "Neither layer carries cancel or abate dates, so closed notices are not observable.",
        "metric": "NoticeNum set comparison between FeatureServer/1 and MapServer/37",
        "values": {"shared": len(a & b), "only_dhcd_layer": len(a - b), "only_landplanning_layer": len(b - a)},
    })
    return {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "findings": out}


# ---------------------------------------------------------------- frontend assets


def _round(values: pl.Series, digits: int = 6) -> list:
    return [None if v is None else round(v, digits) for v in values.to_list()]


def _iso(values: pl.Series) -> list:
    return [None if v is None else v.isoformat() for v in values.to_list()]


def write_json(path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(",", ":"), default=str))


def write_frontend_assets(nbhd, vacant, rehabs, demolitions, permits, events, neighborhoods, agg_nyt, agg_city, manifest, report, findings) -> None:
    name_index = {name: i for i, name in enumerate(nbhd.names)}

    def nidx(series: pl.Series) -> list[int]:
        return [name_index.get(v, -1) if v is not None else -1 for v in series.to_list()]

    def located(df: pl.DataFrame) -> pl.DataFrame:
        return df.filter(pl.col("lon").is_not_null())

    v = located(vacant)
    write_json(PUBLIC_DIR / "vacant.json", {
        "lon": _round(v["lon"]), "lat": _round(v["lat"]), "date": _iso(v["notice_date"]), "address": v["address"].to_list(),
        "blocklot": v["blocklot"].to_list(), "n": nidx(v["neighborhood"]), "id": v["notice_num"].to_list(),
        "owner": v["owner_abbr"].to_list(), "rehabDate": _iso(v["rehab_issue_date"]), "demoDate": _iso(v["demo_finished_date"]),
    })
    r = located(rehabs)
    write_json(PUBLIC_DIR / "rehabs.json", {
        "lon": _round(r["lon"]), "lat": _round(r["lat"]), "date": _iso(r["issue_date"]), "address": r["address"].to_list(),
        "blocklot": r["blocklot"].to_list(), "n": nidx(r["neighborhood"]), "id": r["permit_num"].to_list(),
        "existingUse": r["existing_use"].to_list(), "proposedUse": r["proposed_use"].to_list(),
    })
    d = located(demolitions)
    write_json(PUBLIC_DIR / "demolitions.json", {
        "lon": _round(d["lon"]), "lat": _round(d["lat"]), "date": _iso(d["finished_date"]), "address": d["address"].to_list(),
        "blocklot": d["blocklot"].to_list(), "n": nidx(d["neighborhood"]), "id": [str(x) for x in d["object_id"].to_list()],
        "started": _iso(d["started_date"]), "status": d["status"].to_list(), "deconstruction": d["deconstruction"].to_list(),
    })

    # permits: one lazily-loaded file per neighborhood (too many records to ship at once)
    permit_dir = PUBLIC_DIR / "permits"
    shutil.rmtree(permit_dir, ignore_errors=True)
    permit_dir.mkdir(parents=True)
    cats = [t.removeprefix("permit_") for t in ACTIVITY_TYPES if t.startswith("permit_")]
    p_all = located(permits).filter(pl.col("neighborhood").is_not_null()).sort("issued_date")
    for (name,), p in p_all.group_by("neighborhood", maintain_order=True):
        write_json(permit_dir / f"{name_index[name]}.json", {
            "lon": _round(p["lon"]), "lat": _round(p["lat"]), "date": _iso(p["issued_date"]), "address": p["address"].to_list(),
            "blocklot": p["blocklot"].to_list(), "id": p["case_number"].to_list(), "cat": [cats.index(c) for c in p["category"].to_list()],
            "existingUse": p["existing_use"].to_list(), "proposedUse": p["proposed_use"].to_list(),
            "cost": [None if c is None or c <= 0 or c > 1e8 else round(c) for c in p["cost"].to_list()],
            "mod": [1 if m else 0 for m in p["is_modification"].to_list()],
            "desc": [None if t is None else (t[:157] + "..." if len(t) > 160 else t) for t in p["description"].to_list()],
        })

    # hex-binned counts for the citywide 3D columns: [cell, type, year, count]
    e = located(events).filter(pl.col("year").is_not_null())
    q, rr = hex_cells(e["lon"].to_numpy(), e["lat"].to_numpy())
    e = e.with_columns(pl.Series("q", q), pl.Series("r", rr))
    cells = e.select("q", "r").unique().sort("q", "r").with_row_index("cell")
    clon, clat = hex_center(cells["q"].to_numpy().astype(float), cells["r"].to_numpy().astype(float))
    binned = (
        e.join(cells, on=["q", "r"]).group_by("cell", "activity_type", "year").agg(pl.len().alias("n")).sort("cell", "activity_type", "year")
    )
    write_json(PUBLIC_DIR / "hex.json", {
        "radiusMeters": HEX_RADIUS_M,
        "cells": [[round(a, 6), round(b, 6)] for a, b in zip(clon.tolist(), clat.tolist())],
        "rows": [[c, ACTIVITY_TYPES.index(t), y, n] for c, t, y, n in binned.rows()],
    })

    # neighborhood polygons (simplified ~5 m) + denominators
    features = []
    for i, name in enumerate(nbhd.names):
        geom = nbhd.geoms[i].simplify(0.00005, preserve_topology=True)
        centroid = nbhd.geoms[i].representative_point()
        row = neighborhoods.row(i, named=True)
        features.append({
            "type": "Feature", "id": i,
            "properties": {"i": i, "name": name, "parcels": row["parcels"], "housingUnits": row["housing_units_census"],
                           "population": row["population_census"], "center": [round(centroid.x, 5), round(centroid.y, 5)],
                           "bbox": [round(b, 5) for b in nbhd.geoms[i].bounds]},
            "geometry": json.loads(json.dumps(mapping(shape(mapping(geom))), default=list)),
        })
    for feature in features:
        feature["geometry"]["coordinates"] = _round_coords(feature["geometry"]["coordinates"])
    write_json(PUBLIC_DIR / "neighborhoods.geojson", {"type": "FeatureCollection", "features": features})

    # aggregates: per neighborhood -> type -> {year: [records, distinct parcels]}
    by_neighborhood: dict[int, dict[str, dict[int, list[int]]]] = {}
    for name, year, activity, records, parcels_n in agg_nyt.rows():
        by_neighborhood.setdefault(name_index[name], {}).setdefault(activity, {})[year] = [records, parcels_n]
    city: dict[str, dict[int, list[int]]] = {}
    for year, activity, records, parcels_n in agg_city.rows():
        city.setdefault(activity, {})[year] = [records, parcels_n]
    # All-time [records, distinct parcels] per layer. Distinct parcels cannot be
    # summed across years (one parcel can recur), so they are computed here.
    layered = events.with_columns(
        pl.when(pl.col("activity_type").str.starts_with("permit_")).then(pl.lit("permit")).otherwise(pl.col("activity_type")).alias("layer")
    )
    totals: dict[int, dict[str, list[int]]] = {}
    for name, layer, records, parcels_n in (
        layered.filter(pl.col("neighborhood").is_not_null()).group_by("neighborhood", "layer")
        .agg(pl.len(), pl.col("blocklot").n_unique()).rows()
    ):
        totals.setdefault(name_index[name], {})[layer] = [records, parcels_n]
    city_totals = {layer: [records, parcels_n] for layer, records, parcels_n in layered.group_by("layer").agg(pl.len(), pl.col("blocklot").n_unique()).rows()}
    write_json(PUBLIC_DIR / "aggregates.json", {
        "types": ACTIVITY_TYPES, "city": city, "neighborhoods": by_neighborhood, "totals": totals, "cityTotals": city_totals,
    })

    datasets = {}
    for key, table_key, date_field in [
        ("vacant", "vacant_open", "DateNotice"), ("rehab", "rehabs", "DateIssue"),
        ("demolition", "demolitions", "DateDemoFinished"), ("permit", "permits", "IssuedDate"),
    ]:
        datasets[key] = {
            "layerTitle": LAYERS[table_key].title, "url": LAYERS[table_key].url, "dateField": date_field,
            "apiCount": manifest[table_key]["api_count"], "downloaded": manifest[table_key]["downloaded"],
            "downloadedAt": manifest[table_key]["downloaded_at"], "records": report[table_key]["records_after_cleaning"],
            "exactDuplicatesRemoved": report[table_key]["exact_duplicates_removed"],
            "distinctParcels": report[table_key]["distinct_parcels_blocklot"], "dateRange": report[table_key]["date_range"],
        }
    years = [y for y in events["year"].drop_nulls().unique().sort().to_list()]
    write_json(PUBLIC_DIR / "summary.json", {
        "generatedAt": report["generated_at"], "datasets": datasets, "yearRange": [years[0], years[-1]],
        "neighborhoods": {"url": LAYERS["neighborhoods"].url, "count": len(nbhd.names)},
        "parcels": {"url": manifest["parcels"]["url"], **report["parcels"]},
        "permitCategories": {"prefixes": PERMIT_CATEGORIES, "counts": report["permits"]["category_counts"]},
        "findings": findings["findings"],
    })
    sizes = {p.name: p.stat().st_size for p in sorted(PUBLIC_DIR.glob("*.*"))}
    permit_bytes = sum(p.stat().st_size for p in permit_dir.glob("*.json"))
    print("\nFrontend assets:", ", ".join(f"{k} {v / 1e6:.2f}MB" for k, v in sizes.items()), f"| permits/ {permit_bytes / 1e6:.1f}MB in {len(list(permit_dir.glob('*.json')))} files")


def _round_coords(coords):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], 5), round(coords[1], 5)]
    return [_round_coords(c) for c in coords]
