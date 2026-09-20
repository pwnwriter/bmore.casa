/** The marimo notebook served from this domain as a separate process (see deploy/). */
export const NOTEBOOK_URL = process.env.NEXT_PUBLIC_NOTEBOOK_URL || "/notebook/";

/** The same notebook on marimo's molab, where visitors can read, run and fork it. */
export const MOLAB_URL = process.env.NEXT_PUBLIC_MOLAB_URL || "https://molab.marimo.io/notebooks/nb_ThUzURg3SKsod1RDYv1Vm9";
