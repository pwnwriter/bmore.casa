# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "marimo>=0.24.2,<0.25",
#     "duckdb==1.5.5",
#     "plotly==7.1.0",
#     "anywidget==0.9.21",
#     "wigglystuff==0.5.26",
#     "pandas>=2.3,<4",
#     "traitlets==5.16.1",
#     "polars==1.44.2",
#     "pyarrow>=17",
# ]
# ///
"""bmore.casa - a reactive civic-data story about vacancy and reinvestment.

Run from a fresh clone (the cleaned Parquet files ship with the repo):

    uvx marimo run --sandbox notebook/baltimore.py     # read it as an app
    uvx marimo edit --sandbox notebook/baltimore.py    # read it with the code

For a standalone copy or molab fork, upload baltimore-data.zip beside this file.
The notebook unpacks the bundled snapshot automatically. No API keys are needed;
internet is only needed to install packages or enable the optional street basemap.
"""

import marimo

__generated_with = "0.24.0"
app = marimo.App(
    width="medium",
    app_title="bmore.casa - civic data notebook",
    auto_download=["html"],
)


@app.cell
def _():
    import json
    from datetime import date

    import anywidget
    import traitlets

    import duckdb
    import marimo as mo
    import plotly.graph_objects as go
    import polars as pl
    from plotly.subplots import make_subplots
    from wigglystuff import CellTour, RidgelineChart

    return (
        CellTour,
        RidgelineChart,
        anywidget,
        date,
        duckdb,
        go,
        json,
        make_subplots,
        mo,
        pl,
        traitlets,
    )


@app.cell
def _(json, mo, pl):
    from zipfile import BadZipFile as _BadZipFile, ZipFile as _ZipFile

    _notebook_dir = mo.notebook_dir()
    _required = [
        "data/processed/events.parquet",
        "data/processed/neighborhoods.parquet",
        "data/processed/vacant_open.parquet",
        "data/processed/permits.parquet",
        "data/processed/quality_report.json",
        "public/data/summary.json",
        "public/data/neighborhoods.geojson",
    ]
    # In the repo, data/processed sits beside this file and public/data lives in ../web;
    # a standalone copy unpacks both from the archive into this folder.
    _roots = (_notebook_dir, _notebook_dir.parent / "web")

    def _locate(_name):
        return next((_root / _name for _root in _roots if (_root / _name).is_file()), _notebook_dir / _name)

    _missing = [_name for _name in _required if not _locate(_name).is_file()]
    _archive = _notebook_dir / "baltimore-data.zip"
    _archive_error = ""
    if _missing and _archive.is_file():
        try:
            with _ZipFile(_archive) as _bundle:
                # Read the complete snapshot first; extract only the seven known data paths.
                _contents = {_name: _bundle.read(_name) for _name in _required}
            for _name, _content in _contents.items():
                _destination = _notebook_dir / _name
                _destination.parent.mkdir(parents=True, exist_ok=True)
                _destination.write_bytes(_content)
        except (_BadZipFile, KeyError, OSError) as _error:
            _archive_error = f"\n\nThe data archive could not be unpacked: `{_error}`. Re-upload the original archive and rerun."
        _missing = [_name for _name in _required if not _locate(_name).is_file()]
    mo.stop(
        bool(_missing) or bool(_archive_error),
        mo.callout(mo.md(
            "**Notebook data is missing.** Upload **`baltimore-data.zip`** through molab's Files sidebar "
            "into the same folder as this notebook, then rerun. The notebook will unpack it automatically. "
            "For a local run, keep the archive beside the notebook or use the full repository. "
            "No account secrets or API keys are required."
            + _archive_error
        ), kind="danger"),
    )

    PROCESSED = _locate("data/processed/events.parquet").parent
    PUBLIC = _locate("public/data/summary.json").parent
    events = pl.read_parquet(PROCESSED / "events.parquet")
    hoods = pl.read_parquet(PROCESSED / "neighborhoods.parquet")
    vacant = pl.read_parquet(PROCESSED / "vacant_open.parquet")
    permits = pl.read_parquet(PROCESSED / "permits.parquet")
    quality = json.loads((PROCESSED / "quality_report.json").read_text())
    summary = json.loads((PUBLIC / "summary.json").read_text())
    geojson = json.loads((PUBLIC / "neighborhoods.geojson").read_text())
    return PROCESSED, events, geojson, hoods, permits, quality, summary, vacant


@app.cell
def _():
    # One label and color per activity type - shared by every chart, so a color always means the same thing.
    ACTIVITY = {
        "vacant": ("Open vacant building notices", "#ff7061"),
        "rehab": ("Rehab permits on vacant buildings", "#3ddc97"),
        "demolition": ("Completed city demolitions", "#a684e0"),
        "permit_construction": ("Permits - construction & alteration", "#f5b041"),
        "permit_use": ("Permits - use & occupancy", "#e08e2b"),
        "permit_demolition": ("Permits - demolition", "#c9744f"),
        "permit_temporary": ("Permits - temporary use", "#d9c27a"),
        "permit_zoning": ("Permits - zoning-related", "#b89a5a"),
    }
    LABEL_TO_TYPE = {label: key for key, (label, _) in ACTIVITY.items()}
    DEFAULT_TYPES = ["vacant", "rehab", "demolition"]
    DARK = dict(
        paper_bgcolor="#060a14", plot_bgcolor="#0a1020",
        font=dict(color="#c9d6e4", family="Inter, system-ui, sans-serif", size=12),
        hoverlabel=dict(bgcolor="#102036", bordercolor="#35506b", font=dict(color="#f0f5fa", size=13)),
    )
    GRID = "#16223a"

    # Where each source layer is published on Open Baltimore (data.baltimorecity.gov).
    _hub = "https://data.baltimorecity.gov/datasets/"
    OPEN_BALTIMORE = {
        "vacant": ("Vacant Building Notices", _hub + "691d65a5f85640e6aaa46930bd9dc102"),
        "rehab": ("Vacant Building Rehabs", _hub + "4db6d1e54e714a3e8125990a09d4623d"),
        "demolition": ("Completed City Demo", _hub + "37f242ca93b244a998c31b6c0a3696a7"),
        "permit": ("Housing and Building Permits 2019-Present", _hub + "189e6d1c65df4e13b38c0027cee574f6"),
        "neighborhoods": ("Neighborhood Statistical Area (NSA) Boundaries", _hub + "8112521d3e284518b9fa497a188bfb45"),
        "parcels": ("Real Property Information", _hub + "64110b108565433d8da40dd0e422064e"),
    }
    return ACTIVITY, DARK, DEFAULT_TYPES, GRID, LABEL_TO_TYPE, OPEN_BALTIMORE


@app.cell(hide_code=True)
def notebook_style(mo):
    mo.Html("""
    <style>
      .output .markdown h1, .output .markdown h2, .output .markdown h3 {
        font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-weight: 650;
      }
      .output .markdown h1 { letter-spacing: -.055em; font-weight: 750; }
      .output .markdown h2 { letter-spacing: -.035em; margin-top: 2rem; }
      .output .markdown h3 { letter-spacing: -.02em; }
      .output .markdown p { line-height: 1.65; }
      .js-plotly-plot .plot-container { border-radius: 14px; overflow: hidden; }
      .driver-tour-wrapper .driver-tour-start-button {
        background: #14405a; color: #e1faff; border: 1px solid #3d8298;
        border-radius: 999px; padding: 11px 24px; font-weight: 650;
      }
      .driver-tour-wrapper .driver-tour-start-button:focus-visible {
        outline: 3px solid #3d8298; outline-offset: 3px;
      }
      @media (prefers-reduced-motion: reduce) {
        .driver-tour-wrapper .driver-tour-start-button { transition: none; transform: none; }
      }
    </style>
    """)
    return


@app.cell(hide_code=True)
def guided_tour(CellTour, mo):
    notebook_tour = mo.ui.anywidget(CellTour(steps=[
        {"cell_name": "executive_summary", "title": "01 · Read the city-wide story",
         "description": "Start with the four headline numbers. The coral bars count notices that are open in this saved snapshot, grouped by issue year. They are not past vacancy totals."},
        {"cell_name": "notice_age_explorer", "title": "02 · Choose an older notice cohort",
         "description": "Try 15, then 20 in the custom coral-bar control. The neighborhood bars and downloadable records below follow the cutoff."},
        {"cell_name": "neighborhood_profiles", "title": "03 · Follow a neighborhood",
         "description": "Click a ridge or its neighborhood name. The map, timeline, records and comparison A follow your choice. All ten curves use the same count scale; click again to return to the whole city."},
        {"cell_name": "neighborhood_map", "title": "04 · Inspect the places behind the counts",
         "description": "Hover over a dot for its source record. Shading shows records per 1,000 parcels across the city. Use the map toolbar to box-select or lasso dots and narrow the record table."},
        {"cell_name": "insight_synthesis", "title": "05 · Turn the pattern into a question",
         "description": "The findings suggest where to investigate, not what caused vacancy. Compare neighborhoods, then export records for follow-up. Close the tour whenever you want to explore freely."},
    ], auto_start=False, show_progress=True))
    mo.hstack([
        mo.md("**Take a 90-second tour**  \nFive stops through the story. Explore at your own pace."),
        notebook_tour,
    ], align="center", justify="space-between", gap=2)
    return


@app.cell
def _(date, events, permits, pl, summary, vacant):
    def yearly(activity_type: str) -> pl.DataFrame:
        """Records per year for one activity type, oldest year first."""
        return events.filter(pl.col("activity_type") == activity_type).group_by("year").agg(pl.len().alias("n")).sort("year")

    def headline_metrics() -> dict:
        """City-wide figures quoted in the prose. Computed once, so no number is typed by hand."""
        last_full = date.fromisoformat(summary["generatedAt"][:10]).year - 1
        by_hood = vacant.group_by("neighborhood").agg(pl.len().alias("n")).sort("n", descending=True)
        demo, rehab = yearly("demolition"), yearly("rehab")
        demo_peak_year, demo_peak = demo.sort("n", descending=True).row(0)
        rehab_peak_year, rehab_peak = rehab.filter(pl.col("year") <= last_full).sort("n", descending=True).row(0)
        relapsed = vacant.filter(pl.col("rehab_issue_date").is_not_null() & (pl.col("rehab_issue_date") < pl.col("notice_date")))
        return {
            "open": vacant.height,
            "old": vacant.filter(pl.col("year") < 2016).height,
            "recent": vacant.filter(pl.col("year") >= 2022).height,
            "oldest": vacant["notice_date"].min(),
            "n_hoods": summary["neighborhoods"]["count"],
            "hoods_without": summary["neighborhoods"]["count"] - by_hood.height,
            "top_hood": by_hood.row(0)[0],
            "top10_share": by_hood.head(10)["n"].sum() / vacant.height,
            "last_full": last_full,
            "demo_peak": demo_peak,
            "demo_peak_year": demo_peak_year,
            "demo_last": demo.filter(pl.col("year") == last_full)["n"].sum(),
            "rehab_first_year": rehab.row(0)[0],
            "rehab_first": rehab.row(0)[1],
            "rehab_peak": rehab_peak,
            "rehab_peak_year": rehab_peak_year,
            "relapsed": relapsed.height,
            "permit_records": permits.height,
            "permit_parcels": permits["blocklot"].n_unique(),
            "permit_mods": permits.filter(pl.col("is_modification")).height,
        }

    headline = headline_metrics()
    return headline, yearly


@app.cell(hide_code=True)
def executive_summary(
    ACTIVITY,
    DARK,
    GRID,
    go,
    headline,
    make_subplots,
    mo,
    pl,
    vacant,
    yearly,
):
    _h = headline
    _coral, _green, _purple = ACTIVITY["vacant"][1], ACTIVITY["rehab"][1], ACTIVITY["demolition"][1]

    _fig = make_subplots(
        rows=1, cols=2, horizontal_spacing=0.1,
        subplot_titles=["Older notices remain on the open list", "The recorded response changed shape"],
    )
    _age = vacant.group_by("year").len().sort("year")
    _fig.add_trace(
        go.Bar(
            x=_age["year"].to_list(), y=_age["len"].to_list(), showlegend=False,
            marker_color=[_coral if y < 2016 else "rgba(255,112,97,0.4)" for y in _age["year"]],
            hovertemplate="%{y:,} notices issued in %{x} are still open<extra></extra>",
        ),
        row=1, col=1,
    )
    for _type, _color in (("demolition", _purple), ("rehab", _green)):
        _s = yearly(_type).filter(pl.col("year") <= _h["last_full"])  # drop the partial year
        _fig.add_trace(
            go.Scatter(x=_s["year"].to_list(), y=_s["n"].to_list(), mode="lines+markers", name=ACTIVITY[_type][0], line=dict(color=_color, width=2.5), marker=dict(size=5), hovertemplate="%{x}: %{y:,}<extra>" + ACTIVITY[_type][0] + "</extra>"),
            row=1, col=2,
        )
    _fig.update_layout(height=340, margin=dict(l=45, r=20, t=50, b=35), legend=dict(orientation="h", x=0.56, y=-0.12, font=dict(size=11)), **DARK)
    _fig.update_xaxes(gridcolor=GRID)
    _fig.update_yaxes(gridcolor=GRID, rangemode="tozero")
    _fig.update_annotations(font_size=12)
    # Frames reveal recorded years; axes remain fixed to avoid misleading rescaling.
    _play_years = list(range(int(_age["year"].min()), int(_age["year"].max()) + 1))
    _traces = list(_fig.data)
    _fig.frames = [go.Frame(name=str(_year), data=[
        type(_trace)(x=[x for x in _trace.x if x <= _year],
                     y=[y for x, y in zip(_trace.x, _trace.y) if x <= _year])
        for _trace in _traces], traces=[0, 1, 2]) for _year in _play_years]
    _fig.update_xaxes(range=[_play_years[0] - 0.5, _play_years[-1] + 0.5])
    _fig.update_yaxes(range=[0, max(_age["len"]) * 1.12], row=1, col=1)
    _fig.update_yaxes(range=[0, max(max(t.y) for t in _traces[1:]) * 1.12], row=1, col=2)
    _fig.add_vline(x=2015.5, line_width=1, line_dash="dot", line_color="#ff7061", row=1, col=1)
    _fig.update_layout(
        height=440, margin=dict(l=45, r=20, t=50, b=125),
        legend=dict(orientation="h", x=0, y=1.22, font=dict(size=11)),
        updatemenus=[dict(type="buttons", direction="left", x=0, y=-0.12,
            bgcolor="#14405a", font=dict(color="#ffffff"), showactive=False,
            buttons=[dict(label="▶ Play / Replay", method="animate", args=[None,
                dict(mode="immediate", frame=dict(duration=500, redraw=True), transition=dict(duration=0), fromcurrent=False)]),
                dict(label="Pause", method="animate", args=[[None],
                dict(mode="immediate", frame=dict(duration=0, redraw=False), transition=dict(duration=0))])])],
        sliders=[dict(active=len(_play_years)-1, x=0.36, len=0.64, y=-0.10,
            currentvalue=dict(prefix="Through "), pad=dict(t=0),
            steps=[dict(label=str(y), method="animate", args=[[str(y)],
                dict(mode="immediate", frame=dict(duration=0, redraw=True), transition=dict(duration=0))]) for y in _play_years])],
    )

    mo.vstack(
        [
            mo.md(
                """
                # bmore.casa
                ### A decade of open notices. Where should Baltimore look next?

                ## Executive summary
                """
            ),
            mo.hstack(
                [
                    mo.stat(value=f"{_h['open']:,}", label="open vacant building notices", caption="city-wide, saved snapshot", bordered=True),
                    mo.stat(value=f"{_h['old'] / _h['open']:.0%}", label="issued before 2016", caption=f"oldest: {_h['oldest']}", bordered=True),
                    mo.stat(value=f"{_h['top10_share']:.0%}", label="sit in just 10 neighborhoods", caption=f"of {_h['n_hoods']}; {_h['hoods_without']} have none", bordered=True),
                    mo.stat(value=f"{_h['relapsed']:,}", label="notices after a rehab permit", caption="open notice issued after a rehab permit", bordered=True),
                ],
                widths="equal", gap=1,
            ),
            mo.md(
                f"""
                We combined **six Open Baltimore datasets**, linking housing records by parcel ID and locating them within neighborhood boundaries, to ask one question: *is reinvestment reaching the places where vacancy has lasted longest?*

                - **Vacancy is old and concentrated.** {_h['old']:,} open notices were issued before 2016 (solid bars), and 10 of {_h['n_hoods']} neighborhoods hold {_h['top10_share']:.0%} of them.
                - **The response changed shape.** City demolitions peaked at {_h['demo_peak']:,} in {_h['demo_peak_year']} and fell to {_h['demo_last']:,} in {_h['last_full']}, while rehab permits on vacant buildings rose to {_h['rehab_peak']:,} in {_h['rehab_peak_year']}.
                - **A permit is not an ending.** {_h['relapsed']:,} parcels carry an open notice issued *after* their rehab permit.

                **Try it in five minutes:** change the notice-age cutoff → explore a neighborhood → compare two places → read the synthesis. All findings are computed from the bundled snapshot; no website or API key is needed.
                """
            ),
            _fig,
            mo.md("**Play the data story:** reveal records by year, pause, or scrub the slider. Axes stay fixed. This animates a saved snapshot—not live conditions or historical vacancy totals."),
        ]
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## Problem statement

    The city's public housing records sit in separate layers: notices in one, rehab permits in another,
    demolitions and building permits in two more. Neighborhood summaries such as
    [BNIA-JFI's Vital Signs](https://bniajfi.org/) provide useful context; this notebook makes the underlying parcel records explorable.
    A resident cannot easily ask the obvious question of their own block:

    > **Where has vacancy lasted a decade or more, where is reinvestment being recorded, and do those two maps overlap?**

    This notebook links the layers on the city's parcel ID and lets anyone answer that for any neighborhood and
    any period - while being explicit about what public records *cannot* show.
    """)
    return


@app.cell(hide_code=True)
def _(OPEN_BALTIMORE, mo, pl, quality, summary):
    _rows = []
    for _key, _d in summary["datasets"].items():
        _title, _page = OPEN_BALTIMORE[_key]
        _rows.append(
            {
                "Open Baltimore dataset": _title,
                "Date field": _d["dateField"],
                "API count": _d["apiCount"],
                "Downloaded": _d["downloaded"],
                "After cleaning": _d["records"],
                "Distinct parcels": _d["distinctParcels"],
                "First date": _d["dateRange"][0],
                "Last date": _d["dateRange"][1],
            }
        )
    _links = " · ".join(f"[{title}]({page})" for title, page in OPEN_BALTIMORE.values())
    _ds = summary["datasets"]

    _checks = [
        ("raw_records", "Raw records"), ("exact_duplicates_removed", "Exact duplicates removed"), ("reused_object_ids", "Reused OBJECTIDs (kept)"),
        ("missing_coordinates", "Missing coordinates"), ("outside_city_bbox", "Outside city bbox"), ("missing_or_implausible_primary_date", "Missing / implausible date"),
        ("source_label_missing_or_unknown", "No neighborhood label in source"), ("neighborhood_filled_by_spatial_join", "Neighborhood filled by spatial join"),
        ("neighborhood_unassigned", "Still unassigned"), ("label_vs_spatial_join_agreement", "Source label = spatial join"), ("records_after_cleaning", "Records after cleaning"),
    ]
    _layers = ["vacant_open", "vacant_all", "rehabs", "demolitions", "permits"]
    _quality = pl.DataFrame([{"Check": label, **{k: quality[k].get(field) for k in _layers}} for field, label in _checks], strict=False)
    _p = quality["permits"]
    _definitions = mo.md(
        f"""
        - **Open vacant building notices** - notices still open when downloaded, placed by `DateNotice`. One record per parcel. *Not* a count of vacant buildings in any past year.
        - **Rehab permits on vacant buildings** - use & occupancy permits on buildings that had a notice, one per parcel, placed by `DateIssue`. A permit is not proof of completed work.
        - **Completed city demolitions** - city-led demolitions marked complete, placed by `DateDemoFinished`. Private demolitions are absent.
        - **Building permits** - issued permits placed by `IssuedDate`; {_p['permit_modifications']:,} are modifications of earlier permits. Categories come from case-number prefixes, not an official code list.
        - **Rates** are records per 1,000 parcels (parcel counts from the Real Property layer), not shares of buildings.
        """
    )

    mo.vstack(
        [
            mo.md(
                f"""
                ## Data overview

                Six layers, all published on [Open Baltimore](https://data.baltimorecity.gov/): {_links}.

                **Snapshot processed {summary['generatedAt'][:10]} (UTC).** These are saved extracts, not a live city feed.
                **Five-minute route:** read the summary, try the notice-age explorer, inspect one neighborhood on the map, then read the synthesis.
                Methods and data-quality details are expandable.

                Four are event records (below); the neighborhood boundaries ({summary['neighborhoods']['count']} polygons) place each record, and the
                {summary['parcels']['total_parcels']:,} real-property parcels are the denominator for every rate. The pipeline refuses to continue
                unless the rows downloaded equal the count the city's API reports.
                """
            ),
            mo.accordion({"Source inventory: dates, counts and parcel coverage": mo.ui.table(pl.DataFrame(_rows), selection=None, pagination=False, show_column_summaries=False, show_data_types=False, show_download=False)}),
            mo.callout(
                mo.md(
                    f"**The sources observe different periods.** Notices reach back to {_ds['vacant']['dateRange'][0][:4]} - but only notices that are *still open* exist in the data. "
                    f"Demolitions start in {_ds['demolition']['dateRange'][0][:4]}, rehab records in {_ds['rehab']['dateRange'][0][:4]}, permits in {_ds['permit']['dateRange'][0][:4]}; "
                    f"{summary['yearRange'][1]} is a partial year. An empty year before a source begins means *not observed*, not *zero activity*."
                ),
                kind="warn",
            ),
            mo.accordion(
                {
                    "What each metric counts": _definitions,
                    "Saved pipeline quality report": mo.vstack([mo.md("These checks were saved by the extraction pipeline. They are not a fresh audit of the city API; the raw-download manifest is not included in this notebook bundle."), mo.ui.table(_quality, selection=None, pagination=False, show_column_summaries=False, show_data_types=False, show_download=False)]),
                }
            ),
        ]
    )
    return


@app.cell
def _(anywidget, traitlets):
    class NoticeCohort(anywidget.AnyWidget):
        """A keyboard-accessible distribution whose bars select an issue-year cutoff."""

        cutoff = traitlets.Int(2015).tag(sync=True)
        cohorts = traitlets.List().tag(sync=True)
        _esm = """
        export function render({model, el}) {
          const root = document.createElement('div');
          root.className = 'notice-cohort';
          const label = document.createElement('p');
          const bars = document.createElement('div');
          bars.className = 'cohort-bars';
          const draw = () => {
            const cutoff = model.get('cutoff');
            const rows = model.get('cohorts');
            const max = Math.max(1, ...rows.map(r => r.count));
            label.textContent = `Notices issued through ${cutoff} · click a year to change the cohort`;
            bars.replaceChildren();
            for (const row of rows) {
              const button = document.createElement('button');
              button.type = 'button';
              button.setAttribute('aria-label', `Through ${row.year}: select notice cohort`);
              button.setAttribute('aria-pressed', String(row.year <= cutoff));
              button.title = `${row.year}: ${row.count.toLocaleString()} open notices`;
              const bar = document.createElement('span');
              bar.className = 'cohort-bar';
              bar.style.height = `${Math.max(3, row.count / max * 90)}px`;
              const year = document.createElement('span');
              year.textContent = String(row.year).slice(2);
              button.append(bar, year);
              button.onclick = () => { model.set('cutoff', row.year); model.save_changes(); };
              bars.append(button);
            }
          };
          root.append(label, bars);
          el.append(root);
          model.on('change:cutoff', draw);
          model.on('change:cohorts', draw);
          draw();
          return () => { model.off('change:cutoff', draw); model.off('change:cohorts', draw); root.remove(); };
        }
        """
        _css = """
        .notice-cohort { background:#0a1020; color:#dce8ef; border:1px solid #294058;
          border-radius:12px; padding:16px; font:14px system-ui; }
        .notice-cohort p { margin:0 0 12px; }
        .cohort-bars { display:flex; align-items:end; gap:3px; overflow-x:auto; }
        .cohort-bars button { flex:1; min-width:24px; display:flex; flex-direction:column;
          justify-content:end; gap:8px; align-items:center; height:125px;
          background:transparent; color:#dce8ef; border:0; padding:3px; cursor:pointer; }
        .cohort-bars button:focus-visible { outline:2px solid #7be7f5; border-radius:4px; }
        .cohort-bar { display:block; width:100%; background:#334155; border-radius:3px 3px 0 0; }
        .cohort-bars button[aria-pressed=true] .cohort-bar { background:#ff7061; }
        """

    return (NoticeCohort,)


@app.cell(hide_code=True)
def notice_age_explorer(NoticeCohort, mo, pl, vacant):
    _cohorts = vacant.group_by("year").agg(pl.len().alias("count")).sort("year")
    notice_cohort = mo.ui.anywidget(NoticeCohort(cohorts=_cohorts.to_dicts()))
    mo.vstack([
        mo.md("""
        ### How much of the open-notice list is older?

        **Start here:** the coral bars select notices issued through a cutoff year. Click **15** for notices issued through 2015,
        then **20** to broaden the cohort. The neighborhood chart and downloadable records below react together.
        Bar height is the number of currently open notices issued in that year; this is not a historical vacancy count.
        This city-wide explorer has its own cutoff, independent of the map filters below.
        """),
        notice_cohort,
    ])
    return (notice_cohort,)


@app.cell(hide_code=True)
def _(DARK, GRID, go, mo, notice_cohort, pl, vacant):
    _cutoff = int(notice_cohort.cutoff)
    _cohort = vacant.filter(pl.col("year") <= _cutoff)
    _counts = _cohort.group_by("neighborhood").agg(pl.len().alias("notices")).sort("notices", descending=True)
    _top = _counts.head(10).sort("notices")
    _fig = go.Figure(go.Bar(
        x=_top["notices"].to_list(), y=_top["neighborhood"].to_list(), orientation="h",
        marker_color="#ff7061", hovertemplate="%{y}: %{x:,} open notices<extra></extra>",
    ))
    _fig.update_layout(height=360, margin=dict(l=15, r=20, t=15, b=40),
        xaxis=dict(title="Open notices issued through the cutoff year", gridcolor=GRID), **DARK)
    mo.vstack([
        mo.md(f"**{_cohort.height:,} notices ({_cohort.height / vacant.height:.1%} of the snapshot)** were issued through {_cutoff}, across {_counts.height} neighborhoods. The chart shows the ten largest counts, not rates or a funding priority score."),
        _fig,
        mo.accordion({"Inspect or download this notice cohort": mo.ui.table(
            _cohort.select("notice_date", "address", "neighborhood", "blocklot", "rehab_issue_date")
            .sort("notice_date"), selection=None, page_size=8, show_column_summaries=False,
        )}),
        mo.md("**Use this to frame a question:** what has kept these notices open? Inspection records and resident knowledge are needed to explain the administrative record."),
    ])
    return


@app.cell
def _(RidgelineChart):
    from base64 import b64encode as _b64encode

    class NeighborhoodRidges(RidgelineChart):
        """Style WigglyStuff's ridges, label calendar years, and add keyboard selection.

        The upstream widget plots column positions, not their numeric labels.
        Our input has consecutive years, so relabeling those ticks preserves scale.
        Bundle its installed module inline so no external JavaScript CDN is needed.
        """

        _module = _b64encode(str(RidgelineChart._esm).encode("utf-8")).decode("ascii")
        _esm = 'import ridges from "data:text/javascript;base64,' + _module + '";\n' + r"""
        export default {
          async render(ctx) {
            const cleanup = await ridges.render(ctx);
            const {el, model} = ctx;
            const svg = el.querySelector('svg');
            // Make room for full neighborhood names and scale with the notebook width.
            const height = Number(svg.getAttribute('height'));
            svg.setAttribute('viewBox', `-165 -8 ${model.get('width') + 175} ${height + 20}`);
            svg.setAttribute('width', model.get('width') + 175);
            svg.setAttribute('height', height + 20);
            svg.style.width = '100%';
            svg.style.height = 'auto';
            svg.setAttribute('aria-label', 'Open notices by issue year in ten neighborhoods');
            const firstYear = Number(model.get('x_values')[0]);
            el.querySelectorAll('.ridgeline-x-axis .tick text').forEach(tick => {
              tick.textContent = String(firstYear + Number(tick.textContent));
            });
            const rows = [...el.querySelectorAll('.ridgeline-row')];
            const data = [...model.get('data')].reverse();
            rows.forEach((row, i) => {
              const name = String(data[i].index);
              row.setAttribute('role', 'button');
              row.setAttribute('tabindex', '0');
              row.setAttribute('aria-label', `Explore ${name}`);
              const choose = () => row.querySelector('.ridgeline-line-hitbox')
                .dispatchEvent(new MouseEvent('click', {bubbles: true}));
              row.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault(); choose();
                }
              });
              el.querySelectorAll('.ridgeline-y-axis .tick text').forEach(label => {
                if (label.textContent === name) {
                  label.style.cursor = 'pointer';
                  label.addEventListener('click', choose);
                }
              });
            });
            const selection = () => rows.forEach((row, i) => {
              row.setAttribute('aria-pressed', String(data[i].index === model.get('selected_index')));
            });
            selection();
            model.on('change:selected_index', selection);
            return () => { model.off('change:selected_index', selection); cleanup?.(); };
          }
        };
        """
        _css = str(RidgelineChart._css) + """
        .ridgeline-chart-container {
          --ridgeline-bg: #060a14 !important;
          --ridgeline-stroke: #b67572 !important;
          --ridgeline-fill: #142235 !important;
          --ridgeline-axis-color: #b9c9dc !important;
          --ridgeline-label-color: #b9c9dc !important;
          background: #060a14; border: 1px solid #203049;
          border-radius: 14px; padding: 12px; overflow: hidden;
        }
        .ridgeline-chart-container .ridgeline-y-axis text { font-size: 12px; }
        .ridgeline-chart-container .ridgeline-row-selected .ridgeline-line,
        .ridgeline-chart-container .ridgeline-row-hover .ridgeline-line,
        .ridgeline-chart-container .ridgeline-row:focus-visible .ridgeline-line {
          stroke: #ff7061; stroke-width: 3px !important;
        }
        .ridgeline-chart-container .ridgeline-y-label-selected { fill: #ffb3a9; }
        .ridgeline-chart-container .ridgeline-row:focus-visible { outline: none; }
        """

    return (NeighborhoodRidges,)


@app.cell(hide_code=True)
def neighborhood_profiles(NeighborhoodRidges, mo, pl, vacant):
    _largest = vacant.group_by("neighborhood").len().sort(
        ["len", "neighborhood"], descending=[True, False],
    ).head(10)
    _years = list(range(int(vacant["year"].min()), int(vacant["year"].max()) + 1))
    _counts = vacant.filter(pl.col("neighborhood").is_in(_largest["neighborhood"].to_list()))
    _lookup = {(_n, _y): _v for _n, _y, _v in _counts.group_by("neighborhood", "year").len().iter_rows()}
    # WigglyStuff draws the first row at the bottom. Reverse to show the largest at the top.
    _matrix = pl.DataFrame({str(_y): [_lookup.get((_n, _y), 0) for _n in reversed(_largest["neighborhood"].to_list())] for _y in _years}).to_pandas()
    _matrix.index = list(reversed(_largest["neighborhood"].to_list()))
    _matrix.columns = _years
    neighborhood_ridges = mo.ui.anywidget(NeighborhoodRidges(
        _matrix, width=570, height=430, overlap=0.12,
        stroke_width=1.8, fill_opacity=0.5, peak_scale=1.1,
        x_label="Year the currently open notice was issued",
    ))
    mo.vstack([
        mo.md("""
        ### Ten neighborhoods. Different notice-age profiles.

        The ten neighborhoods with the most open notices, ordered by total count.
        **Click a curve or its name** to send that neighborhood to the map, timeline, records and comparison A below.
        Click it again to return to the whole city. You can also Tab to a curve and press Enter.
        """),
        neighborhood_ridges,
        mo.md(f"**Read the ridges:** each curve counts currently open notices by issue year. All share one count scale; the tallest annual peak is {max(_lookup.values()):,} notices. These are annual counts joined by straight lines, with no smoothing. This view always uses the complete snapshot."),
        mo.accordion({"See the exact counts behind the curves": mo.ui.table(
            _counts.group_by("neighborhood", "year").len().rename({"len": "open_notices"}).sort("neighborhood", "year"),
            selection=None, page_size=8, show_column_summaries=False,
        )}),
    ])
    return (neighborhood_ridges,)


@app.cell
def _(ACTIVITY, DEFAULT_TYPES, hoods, mo, summary):
    hood_names = hoods["neighborhood"].to_list()
    pick_types = mo.ui.multiselect(options=[label for label, _ in ACTIVITY.values()], value=[ACTIVITY[t][0] for t in DEFAULT_TYPES], label="Activity categories")
    pick_years = mo.ui.range_slider(start=summary["yearRange"][0], stop=summary["yearRange"][1], step=1, value=summary["yearRange"], label="Record date (years)", show_value=True, full_width=True)
    street_basemap = mo.ui.checkbox(value=False, label="Street basemap (needs internet; off = fully offline map)")
    return hood_names, pick_types, pick_years, street_basemap


@app.cell
def _(hood_names, mo, neighborhood_ridges):
    _ridge = neighborhood_ridges.selected_index
    pick_hoods = mo.ui.multiselect(
        options=hood_names, value=[_ridge] if _ridge in hood_names else [],
        label="Neighborhoods", max_selections=12,
    )
    return (pick_hoods,)


@app.cell(hide_code=True)
def _(mo, pick_hoods, pick_types, pick_years, street_basemap):
    mo.vstack(
        [
            mo.md(
                """
                ## Core visualization

                Pick a ridge above or choose neighborhoods here (none = the whole city), then select activity categories and a date window. The selection counts, map dots, timeline and record table recompute. A new ridge choice replaces this neighborhood filter; your categories and date window stay in place.
                Map shading stays city-wide for context; the ranking and synthesis use the date window across all neighborhoods and categories. Try **Broadway East** or **Carrollton Ridge**, then drag the years to 2004-2015 to inspect older records; select only open notices to isolate the vacancy cohort.
                """
            ),
            mo.hstack([pick_hoods, pick_types], widths=[1, 1], gap=2),
            pick_years,
            street_basemap,
        ]
    )
    return


@app.cell
def _(LABEL_TO_TYPE, events, pick_hoods, pick_types, pick_years, pl):
    chosen_types = [LABEL_TO_TYPE[label] for label in pick_types.value]
    year_from, year_to = pick_years.value
    in_window = events.filter(pl.col("activity_type").is_in(chosen_types) & pl.col("year").is_between(year_from, year_to))
    # city-wide selection for the choropleth, neighborhood-filtered selection for everything else
    selection = in_window.filter(pl.col("neighborhood").is_in(pick_hoods.value)) if pick_hoods.value else in_window
    scope_label = ", ".join(pick_hoods.value) if pick_hoods.value else "Baltimore City"
    return chosen_types, in_window, scope_label, selection, year_from, year_to


@app.cell(hide_code=True)
def _(
    ACTIVITY,
    chosen_types,
    mo,
    pl,
    scope_label,
    selection,
    year_from,
    year_to,
):
    _stats = []
    for _t in chosen_types:
        _sub = selection.filter(pl.col("activity_type") == _t)
        _stats.append(mo.stat(value=f"{_sub.height:,}", label=ACTIVITY[_t][0], caption=f"{_sub['blocklot'].n_unique():,} distinct parcels", bordered=True))
    mo.vstack(
        [
            mo.md(f"### {scope_label} · records dated {year_from}-{year_to}"),
            mo.hstack(_stats, widths="equal", gap=1) if _stats else mo.callout("Select at least one activity category.", kind="warn"),
            mo.md(
                "_Counts are **source records**, not buildings: one parcel can carry many permits, and every rehab record since 2019 is also a "
                "use & occupancy permit in the permit layer - so never add rehab and permit counts together._"
            ),
        ]
    )
    return


@app.cell
def neighborhood_map(
    ACTIVITY,
    DARK,
    chosen_types,
    geojson,
    go,
    hoods,
    in_window,
    mo,
    pick_hoods,
    pl,
    selection,
    street_basemap,
    year_from,
    year_to,
):
    MAX_POINTS = 40_000

    # choropleth: selected records per 1,000 parcels, for every neighborhood
    _per_hood = in_window.filter(pl.col("neighborhood").is_not_null()).group_by("neighborhood").agg(pl.len().alias("records"))
    _choro = hoods.join(_per_hood, on="neighborhood", how="left").with_columns(pl.col("records").fill_null(0)).with_columns(
        pl.when(pl.col("parcels") >= 100).then(1000 * pl.col("records") / pl.col("parcels")).otherwise(None).alias("rate")
    )
    _index = {f["properties"]["name"]: f["id"] for f in geojson["features"]}

    _fig = go.Figure()
    _fig.add_trace(
        go.Choroplethmap(
            geojson=geojson,
            locations=[_index[n] for n in _choro["neighborhood"]],
            z=_choro["rate"].to_list(),
            customdata=list(zip(_choro["neighborhood"], _choro["records"], _choro["parcels"])),
            hovertemplate="<b>%{customdata[0]}</b><br>%{customdata[1]:,} selected records<br>%{customdata[2]:,} parcels<br>%{z:.1f} per 1,000 parcels<extra></extra>",
            # sequential single-hue ramp for a rate; the categorical hues are reserved for the record dots
            colorscale=[[0, "#0f1a2e"], [0.25, "#14405a"], [0.6, "#1f8aa0"], [1, "#7be7f5"]],
            marker=dict(line=dict(color="rgba(77,214,232,0.35)", width=0.6), opacity=0.75),
            colorbar=dict(title=dict(text="records<br>per 1k parcels", font=dict(size=11)), thickness=10, len=0.55, x=0.99, xanchor="right", bgcolor="rgba(6,10,20,0.6)"),
            name="Rate",
        )
    )

    _points = selection.filter(pl.col("lon").is_not_null())
    _too_many = _points.height > MAX_POINTS
    if not _too_many:
        # reversed so the first category (open notices by default) is drawn on top
        for _t in reversed(chosen_types):
            _p = _points.filter(pl.col("activity_type") == _t)
            if _p.height == 0:
                continue
            _fig.add_trace(
                go.Scattermap(
                    lon=_p["lon"].to_list(),
                    lat=_p["lat"].to_list(),
                    mode="markers",
                    marker=dict(size=4, color=ACTIVITY[_t][1], opacity=0.75),
                    name=f"{ACTIVITY[_t][0]} ({_p.height:,})",
                    # customdata[3] is the record id - the records table reads it back from a map selection
                    customdata=list(zip(_p["address"].fill_null("address not recorded"), _p["event_date"].cast(pl.String), _p["neighborhood"].fill_null("-"), _p["record_id"].cast(pl.String))),
                    hovertemplate="<b>%{customdata[0]}</b><br>%{customdata[1]} · %{customdata[2]}<br>record %{customdata[3]}<extra>" + ACTIVITY[_t][0] + "</extra>",
                )
            )

    if pick_hoods.value:
        _sel = hoods.filter(pl.col("neighborhood").is_in(pick_hoods.value))["neighborhood"].to_list()
        _boxes = [f["properties"]["bbox"] for f in geojson["features"] if f["properties"]["name"] in _sel]
        _w, _s, _e, _n = min(b[0] for b in _boxes), min(b[1] for b in _boxes), max(b[2] for b in _boxes), max(b[3] for b in _boxes)
        _center, _zoom = dict(lon=(_w + _e) / 2, lat=(_s + _n) / 2), 13.2 if len(_sel) == 1 else 12.2
    else:
        _center, _zoom = dict(lon=-76.62, lat=39.285), 10.85

    # The blank style keeps the map fully offline: the neighborhood polygons ARE the geography.
    _blank = {"version": 8, "sources": {}, "layers": [{"id": "bg", "type": "background", "paint": {"background-color": "#060a14"}}]}
    _fig.update_layout(
        map=dict(style="https://tiles.openfreemap.org/styles/dark" if street_basemap.value else _blank, center=_center, zoom=_zoom),
        margin=dict(l=0, r=0, t=0, b=0),
        height=620,
        legend=dict(x=0.01, y=0.99, traceorder="reversed", bgcolor="rgba(6,10,20,0.75)", bordercolor="rgba(125,211,232,0.2)", borderwidth=1, font=dict(size=11)),
        **DARK,
    )

    # mo.ui.plotly makes the figure an input: a box/lasso selection flows back into Python.
    city_map = mo.ui.plotly(_fig)
    _note = (
        mo.callout(
            mo.md(f"**{_points.height:,} records match** - too many to draw individually (limit {MAX_POINTS:,}). The map shows the neighborhood rate only. Narrow the neighborhoods, categories or years to see each record."),
            kind="info",
        )
        if _too_many
        else mo.md(
            f"_Shading: selected records per 1,000 parcels, {year_from}-{year_to} (neighborhoods under 100 parcels are left unshaded). Dots: one source record each, at its recorded coordinates. "
            "**Use the box or lasso tool in the map's toolbar to select dots - the record table below narrows to exactly those records.**_"
        )
    )
    mo.vstack([mo.md("### Locate the records, keep the city in view"), city_map, _note])
    return (city_map,)


@app.cell(hide_code=True)
def _(city_map, mo, pl, selection):
    # Record ids lassoed on the map (customdata[3]); empty until something is selected.
    _picked = [str(p["customdata"][3]) for p in (city_map.value or []) if isinstance(p, dict) and len(p.get("customdata") or []) > 3]
    _shown = selection.filter(pl.col("record_id").cast(pl.String).is_in(_picked)) if _picked else selection
    _cols = ["activity_type", "event_date", "address", "neighborhood", "blocklot", "record_id", "dataset"]
    _limit = 5_000
    _source = f"**{_shown.height:,} records selected on the map**" if _picked else f"**{_shown.height:,} records** match the controls above"
    mo.vstack(
        [
            mo.md(f"### The underlying records\n{_source}{f' (showing the most recent {_limit:,})' if _shown.height > _limit else ''}. Search, sort or download them."),
            mo.ui.table(_shown.select(_cols).sort("event_date", descending=True, nulls_last=True).head(_limit), selection=None, page_size=8, show_column_summaries=False),
        ]
    )
    return


@app.cell(hide_code=True)
def _(
    ACTIVITY,
    DARK,
    GRID,
    chosen_types,
    go,
    mo,
    pl,
    scope_label,
    selection,
    summary,
    year_from,
    year_to,
):
    _by_year = selection.group_by("year", "activity_type").agg(pl.len().alias("records")).sort("year")
    _fig = go.Figure()
    for _t in chosen_types:
        _s = _by_year.filter(pl.col("activity_type") == _t)
        _fig.add_trace(go.Bar(x=_s["year"].to_list(), y=_s["records"].to_list(), name=ACTIVITY[_t][0], marker_color=ACTIVITY[_t][1], hovertemplate="%{x}: %{y:,} records<extra>" + ACTIVITY[_t][0] + "</extra>"))
    _fig.update_layout(
        barmode="group", height=360, margin=dict(l=50, r=20, t=30, b=40), legend=dict(orientation="h", y=1.12, font=dict(size=11)),
        xaxis=dict(title="year of the record's date", dtick=1, range=[year_from - 0.5, year_to + 0.5], gridcolor=GRID),
        yaxis=dict(title="records", gridcolor=GRID), **DARK,
    )
    _partial = summary["yearRange"][1]
    mo.vstack(
        [
            mo.md(f"### Activity over time · {scope_label}"),
            _fig,
            mo.md(
                f"_Each bar counts records by their own date: notice issued, permit issued, demolition finished. **This is not a reconstruction of past vacancy** - "
                f"the vacancy source only contains notices still open in the snapshot, so older years show notices currently marked open; intervening status changes are not observed. {_partial} is a partial year, and the city's permit system changed in early 2025._"
            ),
        ]
    )
    return


@app.cell
def _(PROCESSED, duckdb, mo, year_from, year_to):
    # DuckDB straight over the Parquet files: rank neighborhoods inside the chosen window.
    _events = (PROCESSED / "events.parquet").as_posix()
    _hoods = (PROCESSED / "neighborhoods.parquet").as_posix()
    ranking = duckdb.sql(
        f"""
        SELECT n.neighborhood,
               n.parcels,
               count(*) FILTER (e.activity_type = 'vacant')      AS open_notices,
               count(*) FILTER (e.activity_type = 'rehab')       AS rehab_records,
               count(*) FILTER (e.activity_type = 'demolition')  AS demolitions,
               count(*) FILTER (e.activity_type LIKE 'permit_%') AS permits,
               round(1000.0 * count(*) FILTER (e.activity_type = 'vacant') / n.parcels, 1) AS open_notices_per_1k_parcels,
               round(1000.0 * count(*) FILTER (e.activity_type = 'rehab')  / n.parcels, 1) AS rehab_per_1k_parcels
        FROM read_parquet('{_hoods}') n
        LEFT JOIN read_parquet('{_events}') e
               ON e.neighborhood = n.neighborhood AND e.year BETWEEN {int(year_from)} AND {int(year_to)}
        WHERE n.parcels >= 100
        GROUP BY n.neighborhood, n.parcels
        ORDER BY open_notices_per_1k_parcels DESC
        """
    ).pl()
    mo.vstack(
        [
            mo.md(f"### Neighborhood ranking · {year_from}-{year_to}\nSorted by open notices per 1,000 parcels (neighborhoods with at least 100 parcels). Click a column to re-sort; computed with DuckDB over the Parquet files."),
            mo.ui.table(ranking, selection=None, page_size=8, show_column_summaries=False),
        ]
    )
    return (ranking,)


@app.cell
def _(hood_names, mo, pick_hoods):
    # Follow the first neighborhood in the main filter; a direct comparison choice remains possible.
    _a = pick_hoods.value[0] if pick_hoods.value else ("Broadway East" if "Broadway East" in hood_names else hood_names[0])
    compare_a = mo.ui.dropdown(options=hood_names, value=_a, label="Neighborhood A", searchable=True)
    return (compare_a,)


@app.cell
def _(hood_names, mo):
    # Kept independent so a ridge selection never resets the second neighborhood.
    _b = "McElderry Park" if "McElderry Park" in hood_names else hood_names[-1]
    compare_b = mo.ui.dropdown(options=hood_names, value=_b, label="Neighborhood B", searchable=True)
    return (compare_b,)


@app.cell(hide_code=True)
def _(
    ACTIVITY,
    DARK,
    GRID,
    compare_a,
    compare_b,
    events,
    go,
    hoods,
    make_subplots,
    mo,
    pl,
    summary,
    year_from,
    year_to,
):
    _names = {"vacant": ACTIVITY["vacant"], "rehab": ACTIVITY["rehab"], "demolition": ACTIVITY["demolition"], "permit": ("Building permits (all categories)", "#f5b041")}
    _pair = [compare_a.value, compare_b.value]
    _ev = events.filter(pl.col("neighborhood").is_in(_pair) & pl.col("year").is_between(year_from, year_to)).with_columns(
        pl.when(pl.col("activity_type").str.starts_with("permit_")).then(pl.lit("permit")).otherwise(pl.col("activity_type")).alias("layer")
    )
    _parcels = {r["neighborhood"]: r["parcels"] for r in hoods.filter(pl.col("neighborhood").is_in(_pair)).to_dicts()}

    _table = []
    for _layer, (_label, _) in _names.items():
        _row = {"Metric": _label}
        for _h in _pair:
            _n = _ev.filter((pl.col("neighborhood") == _h) & (pl.col("layer") == _layer)).height
            _dates = summary["datasets"][_layer]["dateRange"]
            _observed = year_to >= int(_dates[0][:4]) and year_from <= int(_dates[1][:4])
            _row[f"{_h} - records"] = _n if _observed else None
            _row[f"{_h} - per 1k parcels"] = round(1000 * _n / _parcels[_h], 1) if _observed and _parcels.get(_h) else None
        _table.append(_row)

    _fig = make_subplots(rows=2, cols=2, subplot_titles=[v[0] for v in _names.values()], vertical_spacing=0.16, horizontal_spacing=0.08)
    _years = list(range(int(year_from), int(year_to) + 1))
    for _i, _layer in enumerate(_names):
        for _j, _h in enumerate(_pair):
            _s = dict(_ev.filter((pl.col("neighborhood") == _h) & (pl.col("layer") == _layer)).group_by("year").agg(pl.len()).rows())
            _fig.add_trace(
                go.Scatter(x=_years, y=[1000 * _s.get(y, 0) / _parcels[_h] if _parcels.get(_h) and int(summary["datasets"][_layer]["dateRange"][0][:4]) <= y <= int(summary["datasets"][_layer]["dateRange"][1][:4]) else None for y in _years], mode="lines+markers", name=_h, legendgroup=_h, showlegend=_i == 0,
                           line=dict(color="#7be7f5" if _j == 0 else "#f0c987", width=2), marker=dict(size=5), hovertemplate="%{x}: %{y:.1f} records / 1,000 parcels<extra>" + _h + "</extra>"),
                row=_i // 2 + 1, col=_i % 2 + 1,
            )
    _fig.update_layout(height=520, margin=dict(l=40, r=20, t=60, b=30), legend=dict(orientation="h", y=1.13, font=dict(size=12)), **DARK)
    _fig.update_xaxes(gridcolor=GRID)
    _fig.update_yaxes(gridcolor=GRID, rangemode="tozero")
    _fig.update_annotations(font_size=12)

    _same = compare_a.value == compare_b.value
    mo.vstack(
        [
            mo.md("### Compare two neighborhoods fairly\nEach chart shows records per 1,000 parcels, so neighborhood size does not drive the comparison. Neighborhood A follows the first neighborhood in your main filter; you can change either side here."),
            mo.hstack([compare_a, compare_b], justify="start", gap=2),
            mo.callout("Pick two different neighborhoods to compare.", kind="warn") if _same else mo.ui.table(pl.DataFrame(_table), selection=None, pagination=False, show_column_summaries=False, show_data_types=False, show_download=False),
            _fig,
            mo.md(
                f"_Records dated {year_from}-{year_to}. Rates divide by each neighborhood's parcel count ({_parcels.get(_pair[0], 0):,} vs {_parcels.get(_pair[1], 0):,}) - they are rates of **records**, and a parcel can have many permits. "
                "Gaps and blank table values mean the source does not cover that period. Lines start where each source starts (demolitions 2011, rehab 2015, permits 2019). Differences are descriptive: these records cannot say *why* two places differ._"
            ),
        ]
    )
    return


@app.cell(hide_code=True)
def insight_synthesis(
    ACTIVITY,
    DARK,
    GRID,
    go,
    headline,
    mo,
    pl,
    ranking,
    year_from,
    year_to,
):
    _h = headline
    _top = ranking.row(0, named=True)
    _rank_text = (f"{_top['neighborhood']} ranks first with {_top['open_notices_per_1k_parcels']:,.0f} open notices per 1,000 parcels" if _top["open_notices"] > 0 else "no open notices have dates in this window; there is no leading neighborhood")

    # Do the two maps overlap? One dot per neighborhood, inside the selected window.
    _rho = ranking.select(pl.corr("open_notices_per_1k_parcels", "rehab_per_1k_parcels", method="spearman")).item()
    _rho_text = f"Spearman ρ = {_rho:.2f}" if _rho is not None and _rho == _rho else "no correlation can be computed for this window"
    _fig = go.Figure(
        go.Scatter(
            x=ranking["open_notices_per_1k_parcels"].to_list(), y=ranking["rehab_per_1k_parcels"].to_list(), mode="markers",
            marker=dict(size=7, color=ACTIVITY["rehab"][1], opacity=0.7, line=dict(width=0)),
            customdata=list(zip(ranking["neighborhood"], ranking["open_notices"], ranking["rehab_records"])),
            hovertemplate="<b>%{customdata[0]}</b><br>%{customdata[1]:,} open notices · %{customdata[2]:,} rehab permits<extra></extra>",
        )
    )
    _fig.update_layout(
        height=340, margin=dict(l=55, r=20, t=40, b=45), title=dict(text=f"Vacancy and recorded rehab activity · {year_from}-{year_to} · {_rho_text}", font=dict(size=13)),
        xaxis=dict(title="open notices per 1,000 parcels", gridcolor=GRID, zerolinecolor=GRID, rangemode="tozero"),
        yaxis=dict(title="rehab permits per 1,000 parcels", gridcolor=GRID, zerolinecolor=GRID, rangemode="tozero"), **DARK,
    )

    _text = mo.md(
        f"""
        ## Insight synthesis

        **Where to investigate:** in your selected window ({year_from}-{year_to}), {_rank_text}.
        Ranking uses neighborhoods with at least 100 parcels to reduce the instability of tiny denominators.

        **Does recorded rehab overlap with vacancy?** Each dot below is one neighborhood ({_rho_text}).
        Hover to find places with similar notice rates but different rehab activity. The rehab source itself is limited
        to buildings with vacancy notices, and both axes share a parcel denominator: this association cannot establish an intervention's effect.

        **Follow up on records, not assumptions.** {_h['relapsed']:,} parcels have an open notice issued after a rehab permit.
        Those addresses are leads for inspection, not proof that renovation failed. Across the broader permit layer,
        {_h['permit_records']:,} records touch {_h['permit_parcels']:,} parcels; {_h['permit_mods']:,} are modifications.
        """
    )
    _so_what = mo.md(
        """
        **Next action:** choose an older notice cohort, inspect the neighborhood bars, and export its records for a community association or reporter to investigate. The notebook identifies where to ask questions; site visits and completion records are needed to establish outcomes.
        """
    )
    mo.vstack([_text, _fig, _so_what])
    return


@app.cell(hide_code=True)
def _(mo, quality):
    _p = quality["permits"]
    _limits = mo.md(
        f"""
        - **No vacancy history.** Both vacancy layers - including the one titled "All Vacant Building Notices" - contain only open notices: `DateCancel` and `DateAbate` are empty on every record. Closed notices are invisible, so this is survivorship data and the notebook never claims a past vacancy count.
        - **Duplicates.** Exact duplicate rows are dropped. The demolition layer reuses a few OBJECTIDs for *different* demolitions; those are genuine records and are kept.
        - **Missing neighborhoods.** {_p['source_label_missing_or_unknown']:,} permits had no neighborhood label; all were assigned by point-in-polygon. Where a source label exists it agrees with the spatial join {_p['label_vs_spatial_join_agreement']:.0%} of the time.
        - **Costs are unreliable.** {_p['cost_null']:,} permits have no cost, {_p['cost_nonpositive']:,} are zero or negative, {_p['cost_over_100m']:,} exceed $100M - so costs are never summed.
        - **Dates.** One service stores UTC instants, another stores local wall-clock time labelled as UTC; both are normalized to Baltimore calendar dates.
        - **Linking.** Layers are joined only on `BLOCKLOT` - never by fuzzy address matching.
        """
    )
    _marimo = mo.md(
        """
        - **A custom notice-age widget.** Clickable cohort bars are keyboard-accessible buttons; a synced year threshold drives the cohort chart and downloadable record table. It bundles a distribution and a filter into one control, using [marimo anywidget support](https://docs.marimo.io/api/inputs/anywidget/).
        - **Two WigglyStuff widgets.** [RidgelineChart and CellTour](https://github.com/koaning/wigglystuff) add neighborhood selection and an optional five-stop introduction. We adapted the ridges with calendar-year labels, full neighborhood names, a shared count scale, keyboard selection and the notebook's colors. The tour targets named cells in both app and edit mode. The original notice-age widget above is our own implementation.
        - **Reactivity replaced callbacks.** One `selection` dataframe feeds the stat tiles, map, timeline and table; changing a control re-runs exactly the cells that depend on it. The custom widget handles browser clicks; marimo handles the downstream Python recomputation.
        - **The plot is an input.** Wrapping the map in `mo.ui.plotly` turns a lasso on the map into a Python value, so the record table follows the map with three lines of code.
        - **A notebook that is a Python file.** It diffs cleanly in git, an AI agent can edit it like any module, and `python baltimore.py` runs it top to bottom - our pre-submission "no errors" check. PEP 723 metadata plus `--sandbox` makes it reproducible from one command.
        - **`mo.stop` and `mo.accordion`** let us fail with a message instead of a traceback, and keep a five-minute read short without deleting the detail.
        - **Friction.** Names shared across cells need one definition. Local plotting variables use `_` prefixes to avoid collisions, and the charts carry explicit backgrounds to stay readable across notebook themes.
        """
    )
    _agents = mo.md(
        """
        The existing project includes an agent-assisted pipeline and web app. **Codex assisted with this notebook revision**:
        reading the rubric, reviewing calculations, building a custom widget, and checking execution.

        - **Inspect the implementation, not just the prose.** A comparison originally claimed to omit unobserved years while drawing zeros in them. Reviewing the plotting code exposed the mismatch.
        - **Challenge the story.** A permit before a later notice does not prove a completed rehab or a return to occupancy. We changed the claim to the sequence actually observed.
        - **Keep computation deterministic.** Agents help write code; no language model invents records, scores neighborhoods, or generates the statistics shown here.
        - **Make results reproducible.** The notebook reads the repository's saved extracts and includes dependency metadata. Execution and interactive checks complement prose review.
        - **Human responsibility.** The team should review interpretation and provide its own firsthand feedback before submission; agent assistance does not establish causality or certify data quality.
        """
    )
    mo.vstack(
        [
            mo.md(
                """
                ## Discussion and future work

                These are **administrative records of what the city wrote down**, not a census of buildings - the limits below shape every claim made above.
                """
            ),
            mo.accordion({"Known limits of the data": _limits}),
            mo.md(
                """
                **Future work**

                - **Snapshot the open-notice layer daily.** These extracts omit closed notices. Repeated snapshots could track entries and exits from the open list; inspection or closure records would still be needed to explain an exit.
                - **A custom `anywidget` 3D map** (MapLibre + deck.gl) so that clicking a neighborhood on the map drives the whole notebook.
                - **Join 311 requests, tax-sale and receivership layers** from Open Baltimore to follow a parcel from complaint to outcome.

                ### Companion web experience · [bmore.casa](https://bmore.casa)

                The repository also includes a **MapLibre + deck.gl** web app, live at [bmore.casa](https://bmore.casa), with a 3D hexagon view,
                timeline playback, parcel exploration and neighborhood comparisons. It offers another way to explore
                the same processed data. **This notebook is the complete, independently usable submission**:
                its findings, interactive controls, source documentation and downloadable records are all here.

                """
            ),
            mo.accordion({"Feedback on marimo: what worked and what was difficult": _marimo, "Working with agentic tools: contributions and checks": _agents}),
        ]
    )
    return


if __name__ == "__main__":
    app.run()
