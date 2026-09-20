"""Download raw ArcGIS layers to data/raw/ with object-ID batching.

For each layer: fetch metadata, fetch the API record count, fetch every object
ID, then pull features in OID-range batches sized to the layer's
maxRecordCount. Any ArcGIS error payload, exceededTransferLimit flag, or batch
whose feature count differs from the IDs requested is treated as a failure.
"""

import gzip
import json
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import httpx

from .sources import LAYERS, PARCELS_URL, RAW_DIR, Layer

BATCH_CAP = 1000  # permits carry long descriptions; keep responses modest
WORKERS = 4
RETRIES = 5


class ArcGISError(RuntimeError):
    pass


def _request(client: httpx.Client, url: str, params: dict) -> dict:
    """POST a query and return parsed JSON, retrying transient failures."""
    last: Exception | None = None
    for attempt in range(RETRIES):
        try:
            resp = client.post(url, data={**params, "f": "json"})
            resp.raise_for_status()
            payload = resp.json()
            # ArcGIS reports failures as HTTP 200 with an "error" object.
            if "error" in payload:
                raise ArcGISError(f"{url}: {payload['error']}")
            return payload
        except (httpx.HTTPError, json.JSONDecodeError, ArcGISError) as exc:
            last = exc
            time.sleep(1.5 * 2**attempt)
    raise ArcGISError(f"giving up on {url} after {RETRIES} attempts: {last}")


def _fetch_batch(client: httpx.Client, layer: Layer, oid_field: str, ids: list[int], expected: dict[int, int]) -> list[dict]:
    """Fetch one OID range; split in half if the server truncates it.

    `ids` are unique and sorted; `expected` maps OID -> record count, because
    some layers reuse an OBJECTID for more than one record.
    """
    params = {
        "where": f"{oid_field} >= {ids[0]} AND {oid_field} <= {ids[-1]}",
        "outFields": "*",
        "outSR": 4326,
        "returnGeometry": "true" if layer.geometry else "false",
        "orderByFields": oid_field,
    }
    payload = _request(client, f"{layer.url}/query", params)
    features = payload.get("features", [])
    want = sum(expected[i] for i in ids)
    if payload.get("exceededTransferLimit") or len(features) != want:
        if len(ids) == 1:
            raise ArcGISError(f"{layer.key}: OID {ids[0]} returned {len(features)} features, expected {want}")
        mid = len(ids) // 2
        return _fetch_batch(client, layer, oid_field, ids[:mid], expected) + _fetch_batch(client, layer, oid_field, ids[mid:], expected)
    return features


def download_layer(client: httpx.Client, layer: Layer) -> dict:
    out = RAW_DIR / layer.key
    out.mkdir(parents=True, exist_ok=True)

    meta = _request(client, layer.url, {})
    (out / "metadata.json").write_text(json.dumps(meta, indent=2))
    oid_field = meta.get("objectIdField") or next(
        f["name"] for f in meta["fields"] if f["type"] == "esriFieldTypeOID"
    )
    batch_size = min(int(meta.get("maxRecordCount") or 1000), BATCH_CAP)

    api_count = _request(client, f"{layer.url}/query", {"where": "1=1", "returnCountOnly": "true"})["count"]
    # returnIdsOnly is not subject to maxRecordCount, so this is the full ID set.
    all_ids = _request(client, f"{layer.url}/query", {"where": "1=1", "returnIdsOnly": "true"})["objectIds"] or []
    if len(all_ids) != api_count:
        raise ArcGISError(f"{layer.key}: count={api_count} but {len(all_ids)} object IDs returned")
    expected = Counter(all_ids)
    ids = sorted(expected)

    chunks = [ids[i : i + batch_size] for i in range(0, len(ids), batch_size)]
    print(f"[{layer.key}] {layer.title}: {api_count:,} records in {len(chunks)} batches", flush=True)

    for stale in out.glob("batch_*.json.gz"):
        stale.unlink()

    def work(job: tuple[int, list[int]]) -> int:
        index, chunk = job
        features = _fetch_batch(client, layer, oid_field, chunk, expected)
        with gzip.open(out / f"batch_{index:05d}.json.gz", "wt", encoding="utf-8") as fh:
            json.dump(features, fh)
        return len(features)

    downloaded = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for done, n in enumerate(pool.map(work, enumerate(chunks)), start=1):
            downloaded += n
            if done % 25 == 0 or done == len(chunks):
                print(f"[{layer.key}]   {done}/{len(chunks)} batches, {downloaded:,} records", flush=True)

    if downloaded != api_count:
        raise ArcGISError(f"{layer.key}: downloaded {downloaded:,} but API count is {api_count:,}")

    return {
        "key": layer.key,
        "title": layer.title,
        "url": layer.url,
        "api_count": api_count,
        "downloaded": downloaded,
        "oid_field": oid_field,
        "reused_object_ids": len(all_ids) - len(ids),
        "max_record_count": meta.get("maxRecordCount"),
        "source_spatial_reference": (meta.get("extent") or {}).get("spatialReference"),
        "requested_out_sr": 4326,
        "downloaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def download_parcel_counts(client: httpx.Client) -> dict:
    """Real-property parcel counts per neighborhood via server-side GROUP BY."""
    out = RAW_DIR / "parcels"
    out.mkdir(parents=True, exist_ok=True)
    total = _request(client, f"{PARCELS_URL}/query", {"where": "1=1", "returnCountOnly": "true"})["count"]
    payload = _request(
        client,
        f"{PARCELS_URL}/query",
        {
            "where": "1=1",
            "groupByFieldsForStatistics": "NEIGHBOR",
            "outStatistics": json.dumps(
                [{"statisticType": "count", "onStatisticField": "OBJECTID", "outStatisticFieldName": "n"}]
            ),
        },
    )
    rows = [f["attributes"] for f in payload["features"]]
    grouped = sum(r["n"] for r in rows)
    if payload.get("exceededTransferLimit") or grouped != total:
        raise ArcGISError(f"parcels: grouped total {grouped:,} != API count {total:,}")
    (out / "parcel_counts.json").write_text(json.dumps(rows, indent=2))
    print(f"[parcels] {total:,} parcels across {len(rows)} NEIGHBOR groups", flush=True)
    return {
        "key": "parcels",
        "title": "Property Information (parcel counts by NEIGHBOR)",
        "url": PARCELS_URL,
        "api_count": total,
        "downloaded": grouped,
        "downloaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def run(only: list[str] | None = None) -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    manifest_path = RAW_DIR / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}

    with httpx.Client(timeout=httpx.Timeout(120, connect=30), headers={"User-Agent": "baltimore-reborn/0.1"}) as client:
        for key, layer in LAYERS.items():
            if only and key not in only:
                continue
            manifest[key] = download_layer(client, layer)
            manifest_path.write_text(json.dumps(manifest, indent=2))
        if not only or "parcels" in only:
            manifest["parcels"] = download_parcel_counts(client)
            manifest_path.write_text(json.dumps(manifest, indent=2))

    print("\nDownload complete:")
    for key, entry in manifest.items():
        print(f"  {key:14s} api={entry['api_count']:>8,}  downloaded={entry['downloaded']:>8,}")
