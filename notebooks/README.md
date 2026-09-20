# Baltimore Reborn notebook

The DSAI x marimo submission is `baltimore.py`. Keep it inside this repository: it reads the bundled `data/processed` and `public/data` files relative to the notebook. No API key is required. Package installation needs internet; the default visualizations use local data without a street-tile service.

## Run

From the repository root:

```bash
uv sync --locked
uv run marimo run notebooks/baltimore.py
# To inspect or edit the code:
uv run marimo edit notebooks/baltimore.py
```

Alternatively, `uvx marimo run --sandbox notebooks/baltimore.py` uses the notebook's inline dependencies. The repository lockfile is the exact reproducible environment.

## Five-minute demonstration

1. **0:00–0:45 — Executive summary.** 11,550 open notices; 29% issued before 2016; 38% concentrated in ten neighborhoods. These are snapshot records, not historical vacancy totals.
2. **0:45–1:15 — Sources.** Six Open Baltimore layers, parcel linking, source coverage, and saved snapshot date. Expand the quality checks only if asked.
3. **1:15–2:00 — Custom widget.** Click 2015, then 2020. The cohort grows from 3,383 to 5,287 notices. The neighborhood bars and downloadable records react to the same cutoff.
4. **2:00–3:15 — Map.** Select Broadway East. Explore notice, rehab, and demolition records, then compare with McElderry Park. The comparison charts use records per 1,000 parcels; gaps mark unobserved source periods.
5. **3:15–4:15 — Synthesis.** Inspect the neighborhood scatter. Its correlation describes co-location; it does not establish causality or rehab success.
6. **4:15–5:00 — Limits and tooling.** A permit is not completed work. Show the marimo and agentic-tool reflections; add your team's firsthand experience when presenting.

## Validation

```bash
uv run marimo check notebooks/baltimore.py
uv run python notebooks/baltimore.py
```

Both checks passed during this revision. Browser validation confirmed the custom cutoff updates the rendered count and neighborhood plot. The default presentation rendered with the local geographic data.

`uv run baltimore-reborn verify` is a separate raw-download audit. It requires `data/raw/manifest.json`, which is absent in this checkout; it was not successfully revalidated in this revision. The saved quality report is provenance from the prior pipeline run, not a new independent audit.

## Rubric coverage

- Executive summary, problem statement, data overview, core visualization, insight synthesis, discussion/future work.
- Custom anywidget cohort explorer, reactive map filters, neighborhood comparison, searchable and downloadable records.
- Explicit administrative-data limitations, source attribution, marimo feedback, and agentic-tool reflection.

The linked HopHacks prize guide permits one track per project. Select DSAI + marimo / Best Data Visualization if this is your chosen track; this work does not submit the project or register it for a prize.

The notebook stands alone before web hosting: its companion section describes the MapLibre/deck.gl app without depending on a deployed link or video. Source inventory, saved quality report, and tooling reflections are expandable to keep the main read short.
