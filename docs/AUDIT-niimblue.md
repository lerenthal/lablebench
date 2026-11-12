# Audit: niimblue — fork or rebuild?

The brief requires the audit and the decision to be delivered *before* the bulk of
the work. This is that deliverable.

- **Upstream audited:** [MultiMote/niimblue](https://github.com/MultiMote/niimblue) @ `937200ff` (2026-11-06)
- **Core dependency audited:** [MultiMote/niimbluelib](https://github.com/MultiMote/niimbluelib) @ `35110a71`
- **Decision: FORK niimblue.** Not the fallback.

---

## 1. What niimblue already is

| | |
|---|---|
| Framework | Svelte **5** (runes), Vite 7, TypeScript throughout |
| Canvas | Fabric.js 7 |
| Barcode / QR | JsBarcode (20 1-D symbologies), `qrcode-generator` |
| CSV | `d3-dsv` (upstream), replaced by PapaParse in LabelBench |
| Printer comms | `@mmote/niimbluelib` **0.49.1** — the current npm release |
| Licence | MIT |
| Activity | Last commit 2026-11-06; upstream pushed 2026-11-11; 830 stars, 135 forks, 12 open issues |

## 2. The seam — this is what decided it

All template persistence goes through one module, `src/utils/persistence.ts`:

```
grep -rn 'LocalStoragePersistence\.' src/ | grep -v 'src/utils/persistence.ts' | wc -l
→ 30 call sites total
```

Of those 30, the **template library** accounts for 8, in two files:

| File | Calls |
|---|---|
| `src/components/dialogs/SavedLabelsMenu.svelte` | `loadLabels` ×4, `saveLabels` ×2, `appendLabels`, `saveDefaultTemplate` ×2, `loadDefaultTemplate`, `hasCustomDefaultTemplate` |
| `src/components/LabelDesigner.svelte` | `loadDefaultTemplate`, `loadLastLabelProps` |

The remaining ~22 call sites are **workstation-local preferences** — UI config,
label presets, preview parameters, last-used connection type, cached font list.
Those are legitimately per-machine and stay local.

So the surface to replace is **five methods**:

```ts
loadLabels(): ExportedLabelTemplate[]
saveLabels(labels): { zodErrors, otherErrors }
appendLabels(labels): { zodErrors, otherErrors }
saveDefaultTemplate(label?)
loadDefaultTemplate(): ExportedLabelTemplate | null
```

A server-backed module with the same surface is a thin diff. The brief's own test
for this is *"if niimblue is too coupled to standalone/local storage to cleanly add
server sync"* — it is not.

## 3. Feature-by-feature against Phase 1

| Brief requirement | Upstream status | Notes |
|---|---|---|
| §5.2 drag-and-drop canvas, mm-accurate | **Met** | Fabric.js canvas, size in px derived from mm at 8 px/mm |
| §5.2 object types (text/barcode/QR/image/rect/line/date) | **Met** | plus ArUco markers and PDF import |
| §5.2 live 1-bit print preview | **Met** | 11 post-process modes, same code path as the print head receives |
| §5.2 every object static or bound to a variable | **Met, differently** | upstream binds variables *implicitly* via `{placeholder}` in text/QR/barcode; there is no declared-variable list |
| §5.3 central templates | **Missing** | 100% `localStorage` |
| §5.3 tags / folders, duplication | **Missing** | no grouping at all; duplication is trivial to add server-side |
| §5.4 CSV import | **Partial** | `d3-dsv`, paste-into-a-textarea, no file import, no delimiter sniffing |
| §5.4 column → variable mapping, persisted | **Partial** | mapping is implicit in the placeholder text; the **CSV data itself** is stored inside the template, not the mapping |
| §5.4 merged-row preview table | **Partial** | page-by-page canvas preview, no table |
| §5.4 batch print, progress, pause/cancel, per-row failure | **Partial** | the batch loop exists but has no per-row failure isolation, no pause/cancel |
| §5.4 serial auto-increment | **Missing** | — |
| §5.5 quick-print gallery | **Missing** | — |
| §5.1 connect via Web Bluetooth / Web Serial | **Met** | both transports, model auto-detected via niimbluelib |
| §5.1 device auto-reconnect | **Partial** | niimbluelib accepts `authorizedDevice` / `authorizedPort`, but upstream's UI always calls `requestDevice` / `requestPort` — the one-click reconnect path is not exposed |
| §5.1 status reads (battery, paper) | **Met** | heartbeat + RFID info already in the stores |
| §5.1 print-head width enforcement | **Partial** | upstream *warns* when the raster is wider than the head; it does not reject |
| §5.1 density 1–5 | **Correction** | niimbluelib metadata: **D11 = 1–3, B21 = 1–5**. Clamp per model. |
| §8 HTTPS / Caddy / mkcert | **Missing** | upstream ships an nginx Dockerfile on plain HTTP |
| §8 Docker Compose, systemd | **Missing** | — |
| §8 Chromium feature detection | **Met** | `Utils.getAvailableTransports()` + a browser warning banner |

### The upstream model was close enough to map

Upstream's `ExportedLabelTemplate`:

```
{ canvas: FabricJson, label: LabelProps, thumbnailBase64, title, timestamp, id, csv }
```

The brief's §7 row:

```
template: id, name, model, label_w_mm, label_h_mm, orientation, canvas_json, variables_json, created_at, updated_at
```

Mapping (documented in `web/src/services/template_store.ts`):

| §7 column | Upstream field |
|---|---|
| `name` | `title` |
| `model` | *(new — upstream has no model field)* |
| `label_w_mm` / `label_h_mm` | derived from `label.size` ÷ dpmm |
| `orientation` | `label.printDirection` |
| `canvas_json` | `{ fabric: canvas, label, dpmm, thumbnail }` |
| `variables_json` | *(new — upstream has no declared-variable list)* |
| `asset_ids` | *(new — upstream inlines images as data URLs)* |

## 4. Why not the fallback

The fallback in the brief is Svelte/React + Vite + niimbluelib + Fabric.js + bwip-js +
PapaParse, "reimplement only the editor + merge UI".

Reimplementing "only the editor + merge UI" means reimplementing:

- the Fabric object graph with barcode (20 symbologies), QR, ArUco, image, text,
  vector objects, each with its own serialisation
- the 1-bit dithering pipeline (11 modes)
- the print preview path
- the `{placeholder}` merge engine with date/time arithmetic
- the mirrored-object / split-label / tail geometry

That is most of the product. The brief's stated reason for the fallback — *"only if
niimblue is too coupled to standalone/local storage"* — does not apply: the coupling
is one module and five methods.

## 5. What the fork still had to build

Not nothing — the fork is roughly a third of the work:

1. **Central template store** — API client + translation layer + swap of the seam.
2. **Asset store** — image bitmaps moved out of the template document into the
   server, referenced by `asset:<id>`.
3. **CSV batch** — PapaParse import, declared variables, persisted column mapping,
   serial auto-increment, preview table, and a batch runner with per-row failure
   isolation, pause and cancel.
4. **Enforcement** — the print-head width check became a *rejection*, not a warning.
5. **Reconnect** — `navigator.bluetooth.getDevices()` / `navigator.serial.getPorts()`.
6. **Packaging** — Fastify + SQLite API server, Caddy + mkcert, Compose, systemd.

## 6. Design decisions taken during the audit

| Decision | Reason |
|---|---|
| `canvas_json` holds `{fabric, label, dpmm, thumbnail}` rather than the Fabric graph alone | The brief's §7 column list has no home for label geometry, and the whole document must stay a self-contained render unit so a later server-side render path (§9) consumes it unchanged. |
| Label size is stored in **mm** (§7) but rendered from **px** (`label.size`) | The brief mandates mm; the renderer needs the exact pixel geometry. Storing both, derived from one another at a fixed dpmm, means they cannot drift. |
| The mapping lives in `variables_json` (§7), and the CSV **data** does not | Upstream stores the CSV *data* in the template. The brief wants the *mapping* persisted so a re-imported CSV "just works" — data belongs to the job, not the template. |
| Version snapshots capture every column the restore path writes | A canvas-only snapshot restores a stale name/model next to new artwork — an incoherent template that passes field-level checks. Caught by the API test. |
| The auth gate is a seam, not a feature | §1/§6 say auth is off in Phase 1; §10 M3 lists "Auth". Built as a middleware that is disabled by default. |

## 7. Findings that contradict the brief

| Brief says | Reality |
|---|---|
| "density 1–5" | D11 is 1–3, B21 is 1–5 (`niimbluelib` model metadata) |
| "D11 = 96 px, B21 = 384 px" | **Confirmed correct** (`printer_models.ts`: `D11.printheadPixels = 96`, `B21.printheadPixels = 384`, both 203 dpi / 8 px/mm) |
| "D11 → Web Bluetooth, B21 → Web Serial" | Correct as a rule of thumb, but the transport is a property of the *workstation*, not the model. The NIIMBOT **B1** on this desk enumerates as USB CDC-ACM (`3513:0002`) — the same profile as the B21 — so it is a Web Serial device with a 384 px head. |
| "the B21 may enumerate as CDC-ACM (/dev/ttyACM*)" | Confirmed for the B1 hardware: `/dev/ttyACM0`, `ID_VENDOR=NIIMBOT`, `ID_MODEL=B1_LABEL_PRINTER`, `ID_SERIAL=B1-H83003154` |
| "some newer B21 firmware ignores the density command" | Consistent with `B21V1PrintTask` sending `setDensity` unconditionally; verify on hardware in M0 |

## 8. Verification

| Check | Result |
|---|---|
| `npx svelte-check` (web) | 0 errors |
| `npm run build` (web) | SPA built to `web/dist` |
| `npx tsc --noEmit` (app) | clean |
| `node --test` (app API suite) | 14/14 pass |
| `curl /api/health`, SPA, SPA fallback, template CRUD | all green, reachable on the LAN IP |
