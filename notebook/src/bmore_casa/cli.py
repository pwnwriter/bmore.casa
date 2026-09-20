"""bmore-casa CLI: refresh = download + process."""

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(prog="bmore-casa", description="bmore.casa data pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    dl = sub.add_parser("download", help="download raw ArcGIS layers to data/raw/")
    dl.add_argument("--only", nargs="*", help="layer keys to download (default: all)")
    sub.add_parser("process", help="normalize raw data into Parquet, DuckDB and frontend assets")
    sub.add_parser("verify", help="independently re-check counts, dates, coordinates and frontend aggregates")
    rf = sub.add_parser("refresh", help="download then process")
    rf.add_argument("--only", nargs="*", help="layer keys to download (default: all)")

    args = parser.parse_args()
    if args.command in ("download", "refresh"):
        from . import download

        download.run(args.only)
    if args.command in ("process", "refresh"):
        from . import process

        process.run()
    if args.command == "verify":
        from . import verify

        raise SystemExit(0 if verify.run() else 1)
