"""Independent checks that the processed data and frontend assets are faithful to the raw downloads.

Each check recomputes a figure by a different route than process.py used
(raw JSON, DuckDB SQL, or the shipped frontend JSON) and compares the two.
"""

import gzip
import json
from datetime import datetime
from zoneinfo import ZoneInfo

import duckdb
import polars as pl

from .sources import PROCESSED_DIR, PUBLIC_DIR, RAW_DIR

RAW_TO_TABLE = {"vacant_open": "vacant_open", "vacant_all": "vacant_all_snapshot", "rehabs": "rehabs", "demolitions": "demolitions", "permits": "permits"}
PRIMARY_DATE = {"vacant_open": ("DateNotice", "notice_date"), "rehabs": ("DateIssue", "issue_date"), "demolitions": ("DateDemoFinished", "finished_date"), "permits": ("IssuedDate", "issued_date")}


def _raw(key: str) -> list[dict]:
    out: list[dict] = []
    for path in sorted((RAW_DIR / key).glob("batch_*.json.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            out.extend(json.load(fh))
    return out


def run() -> bool:
    results: list[tuple[bool, str]] = []

    def check(ok: bool, message: str) -> None:
        results.append((ok, message))
        print(f"  {'PASS' if ok else 'FAIL'}  {message}")

    manifest = json.loads((RAW_DIR / "manifest.json").read_text())
    quality = json.loads((PROCESSED_DIR / "quality_report.json").read_text())
    summary = json.loads((PUBLIC_DIR / "summary.json").read_text())
    aggregates = json.loads((PUBLIC_DIR / "aggregates.json").read_text())
    geo = json.loads((PUBLIC_DIR / "neighborhoods.geojson").read_text())
    names = [f["properties"]["name"] for f in geo["features"]]
    con = duckdb.connect(str(PROCESSED_DIR / "baltimore.duckdb"), read_only=True)

    print("\n1. Downloaded counts match the ArcGIS API counts")
    for key, entry in manifest.items():
        check(entry["downloaded"] == entry["api_count"], f"{key}: downloaded {entry['downloaded']:,} == API {entry['api_count']:,}")

    print("\n2. Raw files on disk match the manifest; exclusions are fully accounted for")
    raw_cache: dict[str, list[dict]] = {}
    for key, table in RAW_TO_TABLE.items():
        raw_cache[key] = _raw(key)
        on_disk = len(raw_cache[key])
        processed = con.sql(f"SELECT count(*) FROM {table}").fetchone()[0]
        removed = quality[key]["exact_duplicates_removed"]
        check(on_disk == manifest[key]["downloaded"], f"{key}: {on_disk:,} raw records on disk == manifest")
        check(processed == on_disk - removed, f"{key}: {processed:,} processed == {on_disk:,} raw - {removed} documented exact duplicates")

    print("\n3. Dates: epoch-ms -> Baltimore local calendar date (spot-check every 997th raw record)")
    tz = ZoneInfo("America/New_York")
    for key, (raw_field, column) in PRIMARY_DATE.items():
        id_raw, id_col = {"vacant_open": ("NoticeNum", "notice_num"), "rehabs": ("PermitNum", "permit_num"), "permits": ("CaseNumber", "case_number"), "demolitions": (None, None)}[key]
        if id_raw is None:
            continue
        table = pl.read_parquet(PROCESSED_DIR / f"{RAW_TO_TABLE[key]}.parquet").select(id_col, column)
        lookup = dict(table.rows())
        sample = raw_cache[key][::997]
        bad = sum(1 for f in sample if lookup[f["attributes"][id_raw]] != datetime.fromtimestamp(f["attributes"][raw_field] / 1000, tz).date())
        check(bad == 0, f"{key}: {len(sample)} sampled dates independently recomputed, {bad} mismatches")

    print("\n4. Coordinates are WGS84 and inside the city's bounding box")
    lon_min, lat_min, lon_max, lat_max = (min(f["properties"]["bbox"][0] for f in geo["features"]), min(f["properties"]["bbox"][1] for f in geo["features"]),
                                          max(f["properties"]["bbox"][2] for f in geo["features"]), max(f["properties"]["bbox"][3] for f in geo["features"]))
    outside, total = con.sql(f"SELECT count(*) FILTER (lon NOT BETWEEN {lon_min - 0.01} AND {lon_max + 0.01} OR lat NOT BETWEEN {lat_min - 0.01} AND {lat_max + 0.01}), count(*) FROM events WHERE lon IS NOT NULL").fetchone()
    check(outside == 0, f"{total:,} located events, {outside} outside lon [{lon_min:.3f}, {lon_max:.3f}] lat [{lat_min:.3f}, {lat_max:.3f}]")
    known = con.sql("SELECT lon, lat FROM vacant_open WHERE address = '2113 WILKENS AVE'").fetchone()
    check(known is not None and abs(known[0] + 76.6494) < 0.001 and abs(known[1] - 39.2808) < 0.001, f"known address 2113 WILKENS AVE lands at {known}")

    print("\n5. Frontend aggregates equal an independent DuckDB recount (neighborhood comparisons use these)")
    for hood in ["Broadway East", "McElderry Park", "Carrollton Ridge", "Oliver"]:
        sql = dict(con.sql(f"SELECT CASE WHEN activity_type LIKE 'permit_%' THEN 'permit' ELSE activity_type END AS layer, count(*) FROM events WHERE neighborhood = '{hood}' GROUP BY 1").fetchall())
        shipped = {layer: v[0] for layer, v in aggregates["totals"][str(names.index(hood))].items()}
        check(sql == shipped, f"{hood}: {shipped}")
    yearly_ok = True
    for idx, table in aggregates["neighborhoods"].items():
        for activity, years in table.items():
            for year, (records, _) in years.items():
                yearly_ok &= records > 0 and 2000 < int(year) <= summary["yearRange"][1]
    shipped_total = sum(v[0] for t in aggregates["neighborhoods"].values() for years in t.values() for v in years.values())
    sql_total = con.sql("SELECT count(*) FROM events WHERE neighborhood IS NOT NULL AND year IS NOT NULL").fetchone()[0]
    check(yearly_ok and shipped_total == sql_total, f"sum of all neighborhood-year cells {shipped_total:,} == DuckDB {sql_total:,}")

    print("\n6. Hex grid (3D columns) conserves every located, dated event")
    hexes = json.loads((PUBLIC_DIR / "hex.json").read_text())
    hex_total = sum(row[3] for row in hexes["rows"])
    located = con.sql("SELECT count(*) FROM events WHERE lon IS NOT NULL AND year IS NOT NULL").fetchone()[0]
    check(hex_total == located, f"hex cells sum to {hex_total:,} == {located:,} events")

    print("\n7. Timeline semantics guard: the vacancy sources hold no closed notices")
    closed = sum(1 for key in ("vacant_open", "vacant_all") for f in raw_cache[key] if f["attributes"].get("DateCancel") or f["attributes"].get("DateAbate"))
    check(closed == 0, f"{closed} notices carry a cancel/abate date -> the app must not (and does not) claim historical vacancy")

    print("\n8. Per-neighborhood permit files cover every assigned permit")
    shipped_permits = sum(len(json.loads(p.read_text())["id"]) for p in (PUBLIC_DIR / "permits").glob("*.json"))
    expected = con.sql("SELECT count(*) FROM permits WHERE neighborhood IS NOT NULL AND lon IS NOT NULL").fetchone()[0]
    check(shipped_permits == expected, f"{shipped_permits:,} permits across neighborhood files == {expected:,}")

    failed = [m for ok, m in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed" + ("" if not failed else " - FAILURES:\n  " + "\n  ".join(failed)))
    return not failed
