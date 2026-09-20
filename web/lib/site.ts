/** The marimo notebook is a separate process served under the same domain (see deploy/). */
export const NOTEBOOK_URL = process.env.NEXT_PUBLIC_NOTEBOOK_URL || "/notebook/";
