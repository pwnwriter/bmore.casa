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

## Standalone copies and molab forks

The notebook needs seven saved data files. Sharing only the Python file does not include them.
Build a portable submission with `uv run python scripts/package_notebook.py`. This creates:

- `dist/baltimore-data.zip`: the seven original data files, with their relative paths.
- `dist/baltimore-reborn-submission.zip`: the notebook, data archive, and run instructions.

For molab, import the updated notebook and upload `baltimore-data.zip` through the Files sidebar
into the same folder as `notebook.py`. The notebook automatically unpacks the archive when data
is missing. Uploading the archive through Files is important: files produced only by code may
not persist between molab sessions. The archive can restore those files on the next run.
See [molab storage policy](https://marimo.io/pages/molab/storage).

For a local run, extract the submission ZIP and run `uvx marimo run --sandbox baltimore.py`
from the extracted folder. No access to the author's account or repository is needed.
Package installation requires internet; the saved data itself does not.

Before submitting, have a teammate fork the molab notebook into their own account and run all
cells. Confirm `baltimore-data.zip` is present in the fork; if it is absent, upload the included
archive. A successful run in the author's existing session is not a fresh-account test.

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

The portable submission was also executed from a new temporary folder containing only the
notebook and data ZIP, using the installed project environment. All seven extracted files matched
the repository snapshot, and a rerun restored a deleted data file. This tests data portability;
it does not replace the separate-account molab fork check described above.

The loader was also applied to the live molab notebook while preserving its newer chart edits.
After uploading the archive through Files, a new molab duplicate in the author's account
included `baltimore-data.zip` and ran all cells successfully, rendering the 11,550-notice headline
and the analysis sections with zero reported errors. A different-account run still needs a teammate.

`uv run baltimore-reborn verify` is a separate raw-download audit. It requires `data/raw/manifest.json`, which is absent in this checkout; it was not successfully revalidated in this revision. The saved quality report is provenance from the prior pipeline run, not a new independent audit.

## Rubric coverage

- Executive summary, problem statement, data overview, core visualization, insight synthesis, discussion/future work.
- Custom anywidget cohort explorer, reactive map filters, neighborhood comparison, searchable and downloadable records.
- Explicit administrative-data limitations, source attribution, marimo feedback, and agentic-tool reflection.

The linked HopHacks prize guide permits one track per project. Select DSAI + marimo / Best Data Visualization if this is your chosen track; this work does not submit the project or register it for a prize.

The notebook stands alone before web hosting: its companion section describes the MapLibre/deck.gl app without depending on a deployed link or video. Source inventory, saved quality report, and tooling reflections are expandable to keep the main read short.
