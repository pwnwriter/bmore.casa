"""Verified ArcGIS sources. Every layer ID, name and field below was confirmed
against the live service metadata (see data/raw/<key>/metadata.json)."""

from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "data" / "raw"
PROCESSED_DIR = ROOT / "data" / "processed"
PUBLIC_DIR = ROOT.parent / "web" / "public" / "data"

DHCD = "https://baltegis.baltimorecity.gov/mapping/rest/services/Housing/DHCD_Open_Baltimore_Datasets/FeatureServer"
GEODATA = "https://geodata.baltimorecity.gov/egis/rest/services"


@dataclass(frozen=True)
class Layer:
    key: str
    url: str
    title: str
    geometry: bool = True


LAYERS: dict[str, Layer] = {
    layer.key: layer
    for layer in [
        Layer("demolitions", f"{DHCD}/0", "Completed City Demo"),
        Layer("vacant_open", f"{DHCD}/1", "Vacant Building Notice - Open"),
        Layer("rehabs", f"{DHCD}/2", "Rehabs of Vacant Buildings"),
        Layer("permits", f"{DHCD}/3", "Building Permits"),
        # Named "All Vacant Building Notices", but verified to contain only open
        # notices (DateCancel / DateAbate are null on every record). Kept as a
        # fresher snapshot to cross-check layer 1, not as a history.
        Layer("vacant_all", f"{GEODATA}/Housing/dmxLandPlanning/MapServer/37", "All Vacant Building Notices"),
        Layer("neighborhoods", f"{GEODATA}/CityView/Neighborhoods/FeatureServer/0", "Neighborhood_NSA"),
    ]
}

# Parcel counts per neighborhood come from one server-side GROUP BY rather than
# downloading 238k parcel polygons.
PARCELS_URL = f"{GEODATA}/CityView/Realproperty_OB/FeatureServer/0"
