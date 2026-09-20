# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "marimo>=0.24",
#     "duckdb>=1.1",
#     "plotly>=5.24",
#     "polars>=1.9",
#     "pyarrow>=17",
# ]
# ///
"""Baltimore Reborn - a reactive civic-data story about vacancy and reinvestment.

Run from a fresh clone (the cleaned Parquet files ship with the repo):

    uvx marimo run --sandbox notebooks/baltimore.py     # read it as an app
    uvx marimo edit --sandbox notebooks/baltimore.py    # read it with the code

No API keys and no network access are needed.
"""

import marimo

__generated_with = "0.24.2"
app = marimo.App(
    width="medium",
    app_title="Baltimore Reborn - civic data notebook",
)


@app.cell
def _():
    import json

    import duckdb
    import marimo as mo
    import plotly.graph_objects as go
    import polars as pl
    from plotly.subplots import make_subplots

    return duckdb, go, json, make_subplots, mo, pl


@app.cell
def _(json, mo, pl):
    ROOT = mo.notebook_dir().parent
    PROCESSED = ROOT / "data" / "processed"
    PUBLIC = ROOT / "public" / "data"

    # Every file read below is checked first, so a missing file is a message, never a traceback.
    _required = [
        PROCESSED / "events.parquet",
        PROCESSED / "neighborhoods.parquet",
        PROCESSED / "vacant_open.parquet",
        PROCESSED / "permits.parquet",
        PROCESSED / "quality_report.json",
        PUBLIC / "summary.json",
        PUBLIC / "neighborhoods.geojson",
    ]
    _missing = [str(p.relative_to(ROOT)) for p in _required if not p.exists()]
    mo.stop(
        bool(_missing),
        mo.callout(mo.md(f"**Processed data not found:** `{'`, `'.join(_missing)}`\n\nRun `uv run baltimore-reborn refresh` from the project root, then re-run this notebook."), kind="danger"),
    )

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
    DARK = dict(paper_bgcolor="#060a14", plot_bgcolor="#0a1020", font=dict(color="#c9d6e4", family="Inter, system-ui, sans-serif"))
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


@app.cell
def _(events, permits, pl, summary, vacant):
    def yearly(activity_type: str) -> pl.DataFrame:
        """Records per year for one activity type, oldest year first."""
        return events.filter(pl.col("activity_type") == activity_type).group_by("year").agg(pl.len().alias("n")).sort("year")

    def headline_metrics() -> dict:
        """City-wide figures quoted in the prose. Computed once, so no number is typed by hand."""
        last_full = summary["yearRange"][1] - 1  # the final year is still in progress
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
def _(
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
        subplot_titles=["Today's open vacancy notices, by the year they were issued", "The city's response: demolitions vs. rehab permits"],
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

    mo.vstack(
        [
            mo.md(
                """
                # Baltimore Reborn
                ### Where vacancy persists, where reinvestment is recorded - and how far the city's own records can take us

                ## Executive summary
                """
            ),
            mo.hstack(
                [
                    mo.stat(value=f"{_h['open']:,}", label="open vacant building notices", caption="city-wide, today", bordered=True),
                    mo.stat(value=f"{_h['old'] / _h['open']:.0%}", label="issued before 2016", caption=f"oldest: {_h['oldest']}", bordered=True),
                    mo.stat(value=f"{_h['top10_share']:.0%}", label="sit in just 10 neighborhoods", caption=f"of {_h['n_hoods']}; {_h['hoods_without']} have none", bordered=True),
                    mo.stat(value=f"{_h['relapsed']:,}", label="parcels vacant again", caption="open notice issued after a rehab permit", bordered=True),
                ],
                widths="equal", gap=1,
            ),
            mo.md(
                f"""
                We joined **six Open Baltimore datasets** on the city's parcel ID to ask one question: *is reinvestment reaching the places where vacancy has lasted longest?*

                - **Vacancy is old and concentrated.** {_h['old']:,} of today's open notices have been open for a decade or more (solid bars), and 10 of {_h['n_hoods']} neighborhoods hold {_h['top10_share']:.0%} of them.
                - **The response changed shape.** City demolitions peaked at {_h['demo_peak']:,} in {_h['demo_peak_year']} and fell to {_h['demo_last']:,} in {_h['last_full']}, while rehab permits on vacant buildings rose to {_h['rehab_peak']:,} in {_h['rehab_peak_year']}.
                - **A permit is not an ending.** {_h['relapsed']:,} parcels carry an open notice issued *after* their rehab permit.

                Every number here is computed live from the data. Scroll to **Core visualization** to test these claims on any neighborhood.
                """
            ),
            _fig,
        ]
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## Problem statement

    Baltimore has fought vacancy with a succession of programs - *Vacants to Value* (2010), the state-funded
    *Project C.O.R.E.* demolitions (2016) and the $3 billion vacant-housing plan announced in 2023 - and
    [BNIA-JFI's Vital Signs](https://bniajfi.org/) tracks neighborhood indicators year by year. But the city's raw
    records sit in separate layers: notices in one, rehab permits in another, demolitions and building permits in two more.
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

                Four are event records (below); the neighborhood boundaries ({summary['neighborhoods']['count']} polygons) place each record, and the
                {summary['parcels']['total_parcels']:,} real-property parcels are the denominator for every rate. The pipeline refuses to continue
                unless the rows downloaded equal the count the city's API reports.
                """
            ),
            mo.ui.table(pl.DataFrame(_rows), selection=None, pagination=False, show_column_summaries=False, show_data_types=False, show_download=False),
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
                    "Cleaning checks, layer by layer": mo.ui.table(_quality, selection=None, pagination=False, show_column_summaries=False, show_data_types=False, show_download=False),
                }
            ),
        ]
    )
    return


@app.cell
def _(ACTIVITY, DEFAULT_TYPES, hoods, mo, summary):
    hood_names = hoods["neighborhood"].to_list()
    pick_hoods = mo.ui.multiselect(options=hood_names, value=[], label="Neighborhoods", max_selections=12)
    pick_types = mo.ui.multiselect(options=[label for label, _ in ACTIVITY.values()], value=[ACTIVITY[t][0] for t in DEFAULT_TYPES], label="Activity categories")
    pick_years = mo.ui.range_slider(start=summary["yearRange"][0], stop=summary["yearRange"][1], step=1, value=summary["yearRange"], label="Record date (years)", show_value=True, full_width=True)
    street_basemap = mo.ui.checkbox(value=False, label="Street basemap (needs internet; off = fully offline map)")
    return hood_names, pick_hoods, pick_types, pick_years, street_basemap


@app.cell(hide_code=True)
def _(mo, pick_hoods, pick_types, pick_years, street_basemap):
    mo.vstack(
        [
            mo.md(
                """
                ## Core visualization

                Pick neighborhoods (none = the whole city), activity categories and a date window - the headline counts, map, timeline, ranking and record table all
                recompute. Try **Broadway East** or **Carrollton Ridge**, then drag the years to 2004-2015 to see only the decade-old notices.
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
def _(
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
    mo.vstack([mo.md("### Map"), city_map, _note])
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
                f"the vacancy source only contains notices still open today, so older years show only the notices that have never been resolved. {_partial} is a partial year, and the city's permit system changed in early 2025._"
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
def _(hood_names, mo):
    # Defaults: two adjacent East Baltimore neighborhoods; fall back safely if the city ever renames them.
    _a = "Broadway East" if "Broadway East" in hood_names else hood_names[0]
    _b = "McElderry Park" if "McElderry Park" in hood_names else hood_names[-1]
    compare_a = mo.ui.dropdown(options=hood_names, value=_a, label="Neighborhood A", searchable=True)
    compare_b = mo.ui.dropdown(options=hood_names, value=_b, label="Neighborhood B", searchable=True)
    return compare_a, compare_b


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
            _row[f"{_h} - records"] = _n
            _row[f"{_h} - per 1k parcels"] = round(1000 * _n / _parcels[_h], 1) if _parcels.get(_h) else None
        _table.append(_row)

    _fig = make_subplots(rows=2, cols=2, subplot_titles=[v[0] for v in _names.values()], vertical_spacing=0.16, horizontal_spacing=0.08)
    _years = list(range(int(year_from), int(year_to) + 1))
    for _i, _layer in enumerate(_names):
        for _j, _h in enumerate(_pair):
            _s = dict(_ev.filter((pl.col("neighborhood") == _h) & (pl.col("layer") == _layer)).group_by("year").agg(pl.len()).rows())
            _fig.add_trace(
                go.Scatter(x=_years, y=[_s.get(y, 0) for y in _years], mode="lines+markers", name=_h, legendgroup=_h, showlegend=_i == 0,
                           line=dict(color="#7be7f5" if _j == 0 else "#f0c987", width=2), marker=dict(size=5), hovertemplate="%{x}: %{y:,}<extra>" + _h + "</extra>"),
                row=_i // 2 + 1, col=_i % 2 + 1,
            )
    _fig.update_layout(height=520, margin=dict(l=40, r=20, t=60, b=30), legend=dict(orientation="h", y=1.13, font=dict(size=12)), **DARK)
    _fig.update_xaxes(gridcolor=GRID)
    _fig.update_yaxes(gridcolor=GRID, rangemode="tozero")
    _fig.update_annotations(font_size=12)

    _same = compare_a.value == compare_b.value
    mo.vstack(
        [
            mo.md("### Compare two neighborhoods"),
            mo.hstack([compare_a, compare_b], justify="start", gap=2),
            mo.callout("Pick two different neighborhoods to compare.", kind="warn") if _same else mo.ui.table(pl.DataFrame(_table), selection=None, pagination=False, show_column_summaries=False, show_data_types=False, show_download=False),
            _fig,
            mo.md(
                f"_Records dated {year_from}-{year_to}. Rates divide by each neighborhood's parcel count ({_parcels.get(_pair[0], 0):,} vs {_parcels.get(_pair[1], 0):,}) - they are rates of **records**, and a parcel can have many permits. "
                "Lines start where each source starts (demolitions 2011, rehab 2015, permits 2019). Differences are descriptive: these records cannot say *why* two places differ._"
            ),
        ]
    )
    return


@app.cell(hide_code=True)
def _(ACTIVITY, DARK, GRID, go, headline, mo, pl, ranking, year_from, year_to):
    _h = headline
    _top = ranking.row(0, named=True)

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
        height=340, margin=dict(l=55, r=20, t=40, b=45), title=dict(text=f"Rehab permits follow vacancy - up to a point · {year_from}-{year_to} · {_rho_text}", font=dict(size=13)),
        xaxis=dict(title="open notices per 1,000 parcels", gridcolor=GRID, zerolinecolor=GRID, rangemode="tozero"),
        yaxis=dict(title="rehab permits per 1,000 parcels", gridcolor=GRID, zerolinecolor=GRID, rangemode="tozero"), **DARK,
    )

    _text = mo.md(
        f"""
        ## Insight synthesis

        **1 · Vacancy in Baltimore is old, and it is concentrated.** Of **{_h['open']:,} open notices**, {_h['old']:,} ({_h['old'] / _h['open']:.0%}) were issued
        before 2016 - the oldest on {_h['oldest']} - while {_h['recent']:,} ({_h['recent'] / _h['open']:.0%}) date from 2022 or later. Ten of {_h['n_hoods']} neighborhoods,
        led by {_h['top_hood']}, hold {_h['top10_share']:.0%} of all open notices; {_h['hoods_without']} neighborhoods have none. In the window you selected
        ({year_from}-{year_to}), **{_top['neighborhood']}** ranks first with {_top['open_notices_per_1k_parcels']:,.0f} open notices per 1,000 parcels.

        **2 · The city's response has changed shape.** Completed city demolitions peak at **{_h['demo_peak']:,} in {_h['demo_peak_year']}** and fall to {_h['demo_last']:,}
        in {_h['last_full']}. Rehab permits on vacant buildings move the other way: from {_h['rehab_first']:,} in {_h['rehab_first_year']} to **{_h['rehab_peak']:,} in {_h['rehab_peak_year']}**.
        The records show *that* the balance shifted from removal to reuse; they do not explain why.

        **3 · A permit is not an ending.** Matching on the parcel ID (`BLOCKLOT`), **{_h['relapsed']:,} parcels** have a rehab permit issued *before* the vacancy
        notice that is open today - buildings that were on a path back into use and are vacant again. The data cannot say whether those rehabs were ever finished;
        it can say exactly where to go and look.

        **4 · Permits are not buildings.** {_h['permit_records']:,} permit records touch only {_h['permit_parcels']:,} distinct parcels, and {_h['permit_mods']:,} are
        modifications of an earlier permit - which is why every rate above is labelled *records per 1,000 parcels*.

        **5 · The two maps overlap - up to a point.** Each dot below is a neighborhood: where open notices are dense, rehab permits are too ({_rho_text}). Part of
        that is by construction - the rehab layer only covers buildings that once had a notice - so read the *shape*: with all years selected, the rehab rate
        stops climbing beyond roughly 100 open notices per 1,000 parcels. The hardest-hit neighborhoods record about as much rehab activity as places with a
        third of their vacancy. Hover to find them.
        """
    )
    _so_what = mo.md(
        """
        **So what?** Reinvestment is being recorded in the hardest-hit neighborhoods, yet thousands of notices there have stayed open for a decade. An outreach
        team, a community association or a reporter can use the map above to list those addresses in minutes.
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
        - **Reactivity replaced callbacks.** One `selection` dataframe feeds the stat tiles, map, timeline and table; changing a control re-runs exactly the cells that depend on it. There is no event-handling code in this notebook.
        - **The plot is an input.** Wrapping the map in `mo.ui.plotly` turns a lasso on the map into a Python value, so the record table follows the map with three lines of code.
        - **A notebook that is a Python file.** It diffs cleanly in git, an AI agent can edit it like any module, and `python notebooks/baltimore.py` runs it top to bottom - our pre-submission "no errors" check. PEP 723 metadata plus `--sandbox` makes it reproducible from one command.
        - **`mo.stop` and `mo.accordion`** let us fail with a message instead of a traceback, and keep a five-minute read short without deleting the detail.
        - **Friction.** The one-definition-per-variable rule means every loop variable needs a `_` prefix, which is noisy in plotting code; and a notebook cannot pin its own light/dark theme, so dark charts have to carry their own background.
        """
    )
    _agents = mo.md(
        """
        This project - pipeline, web app and notebook - was built during HopHacks with **Claude Code** as a pair programmer.

        - **Make the agent prove it.** The most valuable prompt was not "build a map" but "refuse to continue unless the downloaded rows equal the API's count". That became a `verify` command with 30 checks, and it is why we trust the numbers above.
        - **Agents are good at the boring, decisive search.** The agent checked all 271 of the city's GIS services for measured building heights, found none, and so we never invented any. It also noticed that *both* vacancy layers hold only open notices - which changed the story from "vacancy over time" to "what persists".
        - **Unrun code is unverified code.** In one session the agent could edit files but not run commands; everything written then was treated as untested until it was type-checked and looked at in a browser.
        - **Point the agent at the rubric.** When asked for AI-generated video, the agent re-read the judging criteria and argued against it: fabricated imagery next to real records, and nothing a judge could verify. Letting an agent say no was a feature.
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

                - **Snapshot the open-notice layer daily.** The city publishes no closed notices, so differencing snapshots is the only way to measure how fast vacancy is actually resolved.
                - **A custom `anywidget` 3D map** (MapLibre + deck.gl) so that clicking a neighborhood on the map drives the whole notebook.
                - **Join 311 requests, tax-sale and receivership layers** from Open Baltimore to follow a parcel from complaint to outcome.
                - The same pipeline already powers a companion 3D web app (`bun run dev` in this repository).

                ### Feedback on marimo
                """
            ),
            _marimo,
            mo.md("### Working with agentic tools"),
            _agents,
        ]
    )
    return


if __name__ == "__main__":
    app.run()
