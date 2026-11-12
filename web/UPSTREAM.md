# Vendored upstream: niimblue

This directory is a vendored copy of [niimblue](https://github.com/MultiMote/niimblue),
with LabelBench-specific changes applied on top.

| | |
|---|---|
| Upstream URL | https://github.com/MultiMote/niimblue |
| Commit SHA | `937200ff498653d74924ca30d473318dfaf91bd9` |
| Commit date | 2026-11-06 |
| Upstream version | `2026.10.0` (package.json) |
| Licence | MIT — see `LICENSE` in this directory |
| Retrieved with | `git archive HEAD \| tar -x -C web` (no history, no `node_modules`) |

## Why this upstream

`niimblue` is a working browser-side NIIMBOT label designer built on
[`@mmote/niimbluelib`](https://github.com/MultiMote/niimbluelib) (MIT). It already
provides the canvas editor, barcode/QR objects, 1-bit dithering, print preview,
templating and CSV-driven batch printing — i.e. the hard parts of this product.
The printer protocol is never re-implemented.

The full audit, the seam analysis and the fork-vs-rebuild decision are in
[`../docs/AUDIT-niimblue.md`](../docs/AUDIT-niimblue.md).

## What LabelBench changes here

Everything is added at the boundary; upstream's own files are edited only where a
behaviour had to change, and each such edit is listed below.

### New modules (no upstream files touched)

| File | Purpose |
|---|---|
| `src/services/api.ts` | Typed client for the LabelBench REST API. One error shape. |
| `src/services/template_store.ts` | Translation layer between niimblue's in-memory `ExportedLabelTemplate` and the server's column model. |
| `src/services/asset_store.ts` | Moves image bitmaps out of the template document and into the server asset store (`asset:<id>` markers). |
| `src/services/default_template.ts` | The default-template **pointer**. Only the id is kept in the browser; the template is fetched from the server. |
| `src/utils/label_render.ts` | The shared render pipeline (merge → mirror → render → 1-bit post-process), extracted so the manual preview and the CSV batch runner render identically. |
| `src/utils/csv_batch.ts` | PapaParse import, column detection, auto-binding, serial auto-increment, variable resolution. |
| `src/utils/batch_printer.ts` | Batch runner: per-row failure isolation, pause, cancel, copies per row, print-head width enforcement. |
| `src/utils/print_limits.ts` | The print-head rules in one place: the model's head width from niimbluelib's own model table, and the block-vs-warn decision. Both the manual preview and the batch runner go through it. |
| `src/services/device_grants.ts` | One-click reconnect. Lists the printers this machine is already allowed to use (`navigator.bluetooth.getDevices()`, `navigator.serial.getPorts()`) and remembers which was used last. |
| `src/components/dialogs/CsvBatchControl.svelte` | The CSV batch dialog (§5.4). |
| `src/components/dialogs/QuickPrintGallery.svelte` | The quick-print gallery (§5.5). |
| `scripts/check-print-limits.mjs` | `npm run check-limits` — bundles the real width module with the project's esbuild and exercises the decision table. |

### Upstream files modified

| File | Change |
|---|---|
| `src/types.ts` | Added the LabelBench template fields (`model`, `dpmm`, `variables`, `tags`, `assetIds`) and the server-side document types. All optional, so the undo buffer and legacy-import paths stay valid. |
| `src/utils/canvas_preprocess.ts` | Added `extractVariables` / `extractVariablesFromJson` — the merge variables a template declares. |
| `src/utils/file_utils.ts` | Builds templates with the new fields. |
| `src/components/dialogs/SavedLabelsMenu.svelte` | **Rewritten** against the server store. The seam swap required async call sites; the template list, save, replace, delete, load, import and export all go through `templateStore` now. |
| `src/components/designer-controls/SavedLabelsBrowser.svelte` | The list payload changed from `ExportedLabelTemplate[]` to `TemplateListItem[]` — the browser only needs identity, title, thumbnail and label geometry, not the canvas document. |
| `src/components/LabelDesigner.svelte` | Template state (model, variables, tags, id), the model selector, the CSV batch and quick-print entry points, and the default template loaded from the server. |
| `src/components/PrinterConnector.svelte` | The Reconnect dropdown: connects to an already-granted device with no picker. |
| `src/components/MainPage.svelte` | A key icon in the footer for the optional API key. |
| `src/services/api.ts` | Sends `X-API-Key` when one is set, and reports a 401 as what it is. |
| `src/locale/dicts/en.json` | New UI strings. Other locales fall back to English. |
| `package.json` | Added `papaparse` + `@types/papaparse`, `@types/w3c-web-serial`. |

### Re-exported upstream code

`src/utils/persistence.ts` still holds every **workstation-local** preference
(UI config, label presets, preview parameters, last-used transport, cached font
list). Those are legitimately per-machine. The **template library** no longer
lives there — it moved to the central server.

## Upgrading

When upstream moves:

1. `git archive` the new upstream commit into a scratch directory.
2. Diff it against this tree to see what upstream changed.
3. Re-apply the "Upstream files modified" table above.
4. The new modules need no work unless upstream changed the seams they use.

`docs/AUDIT-niimblue.md` records the exact seam, so a future session does not have
to re-derive it.
