"""Package the notebook and its saved public-data snapshot for molab or local use."""

import time
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile, ZipInfo


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    files = [
        "data/processed/events.parquet",
        "data/processed/neighborhoods.parquet",
        "data/processed/vacant_open.parquet",
        "data/processed/permits.parquet",
        "data/processed/quality_report.json",
        "public/data/summary.json",
        "public/data/neighborhoods.geojson",
    ]
    # public/data belongs to the web app; the archive keeps the flat layout the notebook unpacks.
    sources = {name: (root.parent / "web" if name.startswith("public/") else root) / name for name in files}
    for source in sources.values():
        if not source.is_file():
            raise FileNotFoundError(source)
    output = root / "dist"
    output.mkdir(exist_ok=True)
    data_archive = output / "baltimore-data.zip"
    with ZipFile(data_archive, "w", compression=ZIP_DEFLATED) as archive:
        for name, source in sources.items():
            archive.write(source, name)
    submission = output / "bmore-casa-submission.zip"
    with ZipFile(submission, "w", compression=ZIP_STORED) as archive:
        archive.write(data_archive, data_archive.name)
        archive.write(root / "baltimore.py", "baltimore.py")
        # Explicit timestamp: the Nix shell sets SOURCE_DATE_EPOCH to 1980-01-01 UTC, which
        # is 1979 in local time and cannot be encoded in a ZIP header.
        archive.writestr(ZipInfo("README.txt", date_time=time.localtime()[:6]), """bmore.casa — portable notebook

Extract this submission ZIP first. Keep baltimore.py and baltimore-data.zip together.

molab: import baltimore.py, then upload baltimore-data.zip through the Files sidebar
beside notebook.py. Run all cells. The notebook unpacks its seven data files automatically.
Upload the ZIP through Files so molab retains the original archive between sessions.
Before judging, test a fork from a different account and confirm the ZIP is included.

Local: install uv, then run:
  uvx marimo run --sandbox baltimore.py

No API keys or access to the author's account are needed. Internet is needed for
package installation and the optional street basemap; the data comes from this archive.
The notebook documents the six Open Baltimore sources and saved snapshot limitations.
""")
    print(f"Data archive: {data_archive} ({data_archive.stat().st_size / 1_000_000:.1f} MB)")
    print(f"Submission: {submission} ({submission.stat().st_size / 1_000_000:.1f} MB)")


if __name__ == "__main__":
    main()
