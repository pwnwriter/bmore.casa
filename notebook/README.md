# bmore.casa notebook

`baltimore.py` is a reactive [marimo](https://marimo.io) notebook about vacancy and reinvestment in Baltimore, built on
six Open Baltimore layers. It is the project's DSAI x marimo entry and works on its own, without the web app.
No API key is required. Package installation needs internet; the default visualizations use local data without a
street-tile service.

## Run

From this folder (`notebook/`):

```bash
uv sync --locked
uv run marimo run baltimore.py
# To inspect or edit the code:
uv run marimo edit baltimore.py
```

Alternatively, `uvx marimo run --sandbox baltimore.py` uses the notebook's inline dependencies. The repository lockfile is the exact reproducible environment.

Inside the repository the notebook reads the bundled `data/processed` files beside it and `public/data` from the sibling `web/` folder.

## Standalone copies and molab forks

The notebook needs seven saved data files. Sharing only the Python file does not include them.
Download `bmore-casa-submission.zip` from the [latest release](https://github.com/pwnwriter/baltimore-reborn/releases/latest),
or build it yourself with `uv run python scripts/package_notebook.py`. This creates:

- `dist/baltimore-data.zip`: the seven original data files, with their relative paths.
- `dist/bmore-casa-submission.zip`: the notebook, data archive, and run instructions.

**Local run.** Extract the submission ZIP and run `uvx marimo run --sandbox baltimore.py`
from the extracted folder. No access to the author's account or repository is needed.
Package installation requires internet; the saved data itself does not.

**molab.** Import `baltimore.py` and upload `baltimore-data.zip` through the Files sidebar
into the same folder as the notebook. The notebook automatically unpacks the archive when data
is missing. Uploading the archive through Files is important: files produced only by code may
not persist between molab sessions, and the archive can restore them on the next run.
See [molab storage policy](https://marimo.io/pages/molab/storage).

## What's inside

- Executive summary, problem statement, data overview, core visualization, insight synthesis, discussion and future work.
- A custom anywidget cohort explorer, reactive map filters, neighborhood comparison, and searchable, downloadable records.
- Explicit administrative-data limitations, source attribution, marimo feedback, and an agentic-tool reflection.

Source inventory, the saved quality report, and tooling reflections are expandable to keep the main read short.
A companion section describes the MapLibre/deck.gl web app without depending on it.

## Validation

```bash
uv run marimo check baltimore.py
uv run python baltimore.py      # runs every cell top to bottom
```

CI runs both on every push, then builds the submission ZIP and runs it from an empty folder containing only the
notebook and the data archive.

`uv run bmore-casa verify` is a separate audit of the raw ArcGIS download. It needs `data/raw/`, which is
git-ignored; regenerate it with `uv run bmore-casa refresh`. The saved `quality_report.json` records the
checks from the pipeline run that produced the shipped data.
