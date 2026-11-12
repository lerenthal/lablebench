/**
 * The default-template pointer.
 *
 * Upstream kept the whole default template in localStorage. In LabelBench the
 * template itself lives on the server, so only its **id** is kept locally —
 * a pointer, not a copy. The template is fetched from the server on load.
 *
 * This is a workstation preference (which template to start from), so it
 * belongs here rather than in the shared library.
 */

const STORAGE_KEY = "labelbench_default_template_id";

export const DefaultTemplate = {
  /** The id of the default template, or undefined when there is none. */
  id(): string | undefined {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === null || value === "" ? undefined : value;
    } catch {
      return undefined;
    }
  },

  /** Point at a template. Pass undefined to clear it. */
  set(id: string | undefined): void {
    try {
      if (id === undefined) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, id);
      }
    } catch (e) {
      console.warn("Could not store the default template pointer", e);
    }
  },
};
