---
description: Full pre-deployment QA review of LabelBench — build, typecheck, API, print correctness, printer integration, security, deployment, and a manual hardware checklist
argument-hint: "[optional focus area, e.g. 'print', 'api', 'deploy', 'security']"
allowed-tools: Bash, Read, Grep, Glob
---

# LabelBench — Pre-Deployment App Review

Review **LabelBench** before the user deploys it to their lab LAN.

LabelBench is a self-hosted, browser-direct label designer for NIIMBOT thermal label printers: a **Svelte 5 +
TypeScript SPA** in `web/` (Vite, Bootstrap 5 + SCSS, fabric.js) with no Tailwind, no FontAwesome, no Google Fonts, no
CDN links and no runtime internet calls; a **Fastify + SQLite** server in `app/` (better-sqlite3) that serves the SPA,
stores templates centrally and owns atomic serial counters; **printing in the browser only** (Web Bluetooth for the
D11, Web Serial for the B21/B1 — the server never talks to a printer); and a **Docker Compose** deployment
(`docker-compose.yml` with app + Caddy, `deploy/caddy/Caddyfile`, `deploy/prepare-host.sh`, `scripts/setup-certs.sh`,
`scripts/backup.sh`) using an internal mkcert CA on an offline LAN.

Repo root: `/media/yaniv/1tb_WDC/hermes_agent_projects/LabelBench` (branch `main`). If the user passes a focus
argument, still cover every section, but go deeper on the named one.

## Ground rules

1. **Never fabricate a result.** If you did not run a command, say so. If a printer was not exercised, say so in those
   words. Never claim "the label printed correctly" unless you physically saw it.
2. **No internet access.** Anything needing it is `BLOCKED`.
3. **Headless browsers cannot grant a Bluetooth or serial device**, so hardware printing **cannot be automated**.
   Verify everything verifiable without the device; produce the manual checklist in §10 instead.
4. **Device grants are origin-specific.** A printer granted at `https://labelbench.local:8443` is *not* granted at
   `https://10.10.17.185:8443`, and a grant does not carry between ports.
5. **The server must never connect to a printer.** Any code that would is a critical FAIL.
6. **Do not propose** re-adding DYMO/WebUSB, Tailwind, FontAwesome, Google Fonts, CDN links, or runtime internet
   calls. NIIMBOT-only; all output is native 203 dpi (8 dpmm).
7. **Never print or commit credentials or key material.** Write them as `[REDACTED]`.
8. **Do not fix anything.** Report findings; propose the fix in one line.

**Verdicts** — one per item. **PASS** = you ran it and it behaved correctly. **FAIL** = you ran it and it did not;
give file, line, actual output, expected behaviour. **BLOCKED** = you could not run it; you **must** state (a) what
hardware, credential or access is missing and (b) exactly what the user must do to unblock it — never pass a BLOCKED
item silently. `N/A` only when an item genuinely does not apply, and say why.

## 0. Baseline

```bash
cd /media/yaniv/1tb_WDC/hermes_agent_projects/LabelBench
git status --short && git log --oneline -8 && git branch --show-current
```

- [ ] Working tree recorded. Note untracked files — stray scratch directories under `web/` are linted by ESLint and
      create spurious failures.
- [ ] Branch is `main`; HEAD commit recorded in the report.

### Known baseline — re-verify, do not assume

The tip of `main` was last observed to fail these. **Re-run them yourself.** If one now passes, report PASS and note
the fix; never report a stale failure as current, or a stale pass as a failure.

| Command | Last observed |
|---|---|
| `cd web && npm run sv-check` | **0 errors**, 3 warnings |
| `cd web && npm run build` | **succeeds** |
| `cd web && npm run check-limits` | **26 checks, ALL PASS** |
| `cd web && npm run lint` | not yet run on this tip — record the count |
| `cd app && npm run typecheck` | clean |
| `cd app && npm test` | 30 pass, 0 fail |
| `docker compose config -q` | clean |
| live `GET /api/health` over HTTPS | `{"status":"ok",...}` |

Two defects that were real and are now **fixed** — confirm the fixes rather than assuming them:

1. `web/src/utils/print_limits.ts` was rewritten (commit `46bacb5`): `headWidthForModel` → `headMmForModel`,
   `evaluateWidth` changed from 4 parameters to 3 **and now works in millimetres**, and `NIIMBOT_DPMM` was
   re-exported. The callers and the regression script were updated to match; `check-print-limits.mjs` now asserts
   the millimetre API and the printer's geometry helpers (`canvasForLabel`, `physicalLabelOf`, `loadedLabelOf`,
   `canvasForPrinter`).
2. `web/src/utils/printer_profile.ts` passed a `LabelType` where the library's narrowed union was required; the
   list is now typed `LabelType[]` so the comparison widens correctly.

**A host-side trap, not an app defect.** `cd app && npm test` fails with `ERR_DLOPEN_FAILED` /
`NODE_MODULE_VERSION 127` when the prebuilt `better_sqlite3.node` was compiled for Node 22 but the host runs
Node 26. The fix is `npm rebuild better-sqlite3` in `app/`. The Docker image builds its own native module for
its own ABI, so the **deployment is unaffected either way** — check the running app before blaming the code, and
do not report this as an application failure.

## 1. Build, typecheck, CI status

- [ ] `cd app && npm run typecheck`
- [ ] `cd app && npm test` (runs `tsx --test src/test/*.test.ts`) — record pass/fail counts.
      `app/src/test/api.test.ts` covers health, templates CRUD, version snapshot + restore, duplication, assets,
      serial counters and the API-key gate.
- [ ] `cd app && npm run build` — compiles the server to `app/dist`.
- [ ] `cd web && npm run sv-check` — the svelte-check script. There is **no** `npm run check` in `web/package.json`,
      and `sv-check` is what CI runs.
- [ ] `cd web && npm run build` — the SPA builds to `web/dist`.
- [ ] `cd web && npm run check-limits` — the regression script `web/scripts/check-print-limits.mjs`, which bundles the
      real `web/src/utils/print_limits.ts` with esbuild and asserts on its exports. If it fails on a missing export,
      read script and module and report the mismatch: name, arity and units expected vs exported.
- [ ] `cd web && npm run lint` — record the error count and whether errors are in tracked source or untracked scratch
      files.
- [ ] CI: read `.github/workflows/ci.yml`. It defines **two jobs** — `api` (display name "API server", working dir
      `app/`: `npm ci`, `npm run typecheck`, `npm test`) and `web` (display name "Web", working dir `web/`: `npm ci`,
      `npm run sv-check`, `npm run build`, `npm run check-limits`). Confirm the local command set matches CI exactly —
      a check that passes locally but is absent from CI is a finding.
- [ ] CI status: `gh run list --limit 5` if authenticated to a GitHub host. If `gh auth status` says you are not
      logged in, mark **BLOCKED** and state that the user must run `gh auth login` or paste the run URLs. Never guess
      a CI result.

## 2. The API surface

Routes registered in `app/src/routes/api.ts` — verify against the file, do not take this list as gospel: `GET
/api/health` · `GET|POST /api/templates` · `GET|PUT|DELETE /api/templates/:id` · `POST /api/templates/:id/duplicate` ·
`GET /api/templates/:id/versions` · `POST /api/templates/:id/versions/:versionId/restore` · `GET /api/assets` · `POST
/api/assets` · `GET /api/assets/:id` · `GET /api/serial-counters` · `POST /api/serial-counters/:name/next` · `POST
/api/serial-counters/:name/reset`

```bash
cd /media/yaniv/1tb_WDC/hermes_agent_projects/LabelBench
docker compose config -q && docker compose up -d --build && docker compose ps
```

Read `LABELBENCH_HTTPS_PORT` and `LABELBENCH_HTTP_PORT` from `.env` (`8443` and `8082` in the reference deployment)
and substitute them. Use `curl -k` — the internal CA is not in your trust store.

- [ ] `GET /api/health` returns `{"status":"ok","service":"labelbench-server",...}`.
- [ ] Templates CRUD: create, read, update, list, duplicate, delete. Response shapes must match
      `app/src/domain/template.ts` (`TemplateSummary` for list, `Template` for single). A malformed payload must be
      rejected `400 invalid_template`, not a 500.
- [ ] Versions: after an update, `GET /api/templates/:id/versions` lists a new snapshot and `POST
      /api/templates/:id/versions/:versionId/restore` returns the pre-update template. Confirm the snapshot covers the
      **whole** template, not just the canvas (`template_version` in `app/src/db/schema.ts`).
- [ ] Serial counters — real semantics from `app/src/services/serial.ts`: the stored `value` is the number **last
      handed out**, the next allocation is `value + step`, the first allocation on a new counter returns `start ?? 1`,
      and `reset` with no body sets it to 0 so the next allocation is 1.

  ```bash
  C="https://127.0.0.1:8443"
  curl -sk -X POST "$C/api/serial-counters/review-check/next" -H 'Content-Type: application/json' -d '{"start":100,"step":5}'
  curl -sk -X POST "$C/api/serial-counters/review-check/next" -H 'Content-Type: application/json' -d '{}'
  curl -sk -X POST "$C/api/serial-counters/review-check/reset" -H 'Content-Type: application/json' -d '{"value":10}'
  curl -sk -X POST "$C/api/serial-counters/review-check/next" -H 'Content-Type: application/json' -d '{}'
  curl -sk "$C/api/serial-counters"
  ```

  Expected: 100, then 105, then reset to 10, then 15.
- [ ] Counter validation: a name that is empty, over 128 characters, or contains control characters must be rejected
      `400 invalid_counter` (schema in `app/src/domain/serial.ts`), as must a non-integer `start`/`step`.
- [ ] Counter atomicity: allocation sits inside `db.transaction(...).immediate()` in `app/src/services/serial.ts`.
      Confirm by reading the code, and by running two concurrent `next` calls on one counter and confirming the values
      differ.
- [ ] Assets: `POST /api/assets` is multipart, field name `file`. Upload a small PNG — expect `201` with `id`, `mime`,
      `size_bytes`, `kind`. `GET /api/assets/:id` must return the exact bytes, the right `Content-Type`, and
      `Cache-Control: public, max-age=31536000, immutable`.
- [ ] Asset dedup: assets are content-addressed by SHA-256 (`app/src/services/assets.ts`). Uploading the same bytes
      twice must return the existing asset, not store a second copy.
- [ ] Asset size limit: `LABELBENCH_MAX_ASSET_BYTES` (default 25 MB) returns `413 too_large`; the server `bodyLimit`
      is 32 MB.
- [ ] The API-key gate (`app/src/auth/index.ts`, `app/src/server.ts`): with `LABELBENCH_AUTH_MODE=apikey` and a key
      set, every `/api/*` route except `/api/health` requires a matching `X-API-Key` header and answers `401`
      otherwise; the comparison is constant-time; the SPA shell stays ungated so the key UI can load. Read the
      `onRequest` hook and exercise it if the gate is enabled. **Never print the key** — refer to it as `[REDACTED]`.
- [ ] The server exposes **no** route that prints, queues or reaches a printer. It never opens a device.

## 3. Print correctness

Read `web/src/utils/print_limits.ts`, `web/src/utils/printer_profile.ts`, `web/src/utils/label_render.ts`,
`web/src/utils/batch_printer.ts`.

- [ ] **The print-head check is in millimetres, not pixels.** The head is quoted in the printer's dots (D11 = 96 px,
      B21 = 384 px) at the printer's own resolution (203 dpi = 8 dpmm) — so 12 mm and 48 mm. The label is measured in
      the **template's own** dpmm. Both sides must be converted to millimetres *before* comparison; confirm
      `evaluateWidth` compares `printWidthMm > deviceHeadMm`. A pixel-to-pixel comparison is a FAIL — it blocks a 40
      mm label on a 48 mm B21 head.
- [ ] Two distinct limits, both present: the **device** limit blocks the print; the **model** limit (the head of the
      model the template targets) only warns, because a wider printer prints it fine. Confirm `evaluateWidth` returns
      `blocked` for the device case and `warning` for the model case, and that the manual preview and the CSV batch
      runner both call the same function so the paths cannot drift.
- [ ] **Feed directions.** From the library's own table
      (`web/node_modules/@mmote/niimbluelib/dist/cjs/printer_models.js`): D11 — `printDirection: "left"`, 96 head px,
      203 dpi, density 1–3 (default 2), paper types `[WithGaps, Transparent]`. B21 — `printDirection: "top"`, 384 head
      px, 203 dpi, density 1–5 (default 3), paper types `[WithGaps, Black, Continuous, Transparent]`. Confirm the
      family sets in `web/src/utils/printer_profile.ts` agree with that table, and that the raster width is taken
      across the head (canvas **height** for `left`, canvas **width** for `top`).
- [ ] **Quarter-turn between families.** `turnContent` in `web/src/utils/label_fit.ts` rotates every object 90° and
      transposes the canvas when a design moves between a D11 and a B21; `adoptPrinter` in
      `web/src/components/LabelDesigner.svelte` calls it when the direction changes. Verify the content is not merely
      rotated but also **re-centred in the new canvas**, and that the printed label comes out the right way round, not
      sideways.
- [ ] **Label-type resolution.** `resolveLabelType` in `web/src/utils/printer_profile.ts` must only ever return a type
      the connected printer's own `paperTypes` list contains, must exclude `LabelType.Invalid`, and must prefer the
      roll's reported `consumablesType` when the user's choice is unsupported.
- [ ] **Native 203 dpi raster and the resample.** All NIIMBOT output is native 203 dpi = 8 dpmm. `resampleToDpmm` in
      `web/src/utils/label_render.ts` must rescale the whole raster from the template's own dpmm to the printer's
      native dpmm before sending, so a label drawn at another resolution prints at the correct physical size. Confirm
      the scale factor, that the whole raster is scaled (a 5 mm object stays 5 mm), and that the background is painted
      white — an unpainted background prints as noise.
- [ ] **WriteRfidFail.** The library's `PrinterErrorCode.WriteRfidFail` is **20** (`.../packets/enumerations.js`). The
      print never starts when the printer is told a label type it does not understand. Confirm the app never sends an
      unsupported type — the prevention path is the same check as the label-type item above. State plainly that the
      code is 20 and that the app prevents it by never sending an unsupported label type.
- [ ] Post-processing to 1 bit (`web/src/utils/post_process.ts`, `dither.ts`): threshold, threshold_rb, dither,
      floyd_steinberg, jjn, stucki, bayer2/4/8, screentone, grayscale, plus invert and mirror. Confirm
      `applyPostProcess` in `label_render.ts` is applied on both the manual and the batch path, and that its result is
      what reaches the head.

## 4. Canvas adaptation and label shape

- [ ] **Content scaled and centred when the label size changes.** `adaptContentToLabel` in
      `web/src/utils/label_fit.ts` is called from `onUpdateLabelProps` in `web/src/components/LabelDesigner.svelte`
      when the size changes. Verify it (a) scales the content by the factor that fits it to the new label, (b)
      **centres** the content's own bounding box — not the objects' origins, which vary per object type — and (c) does
      both in label coordinates, so it stays correct while the user zooms or pans.
- [ ] **A turned label turns its content.** When the new size is the old size swapped, the content must rotate a
      quarter turn with it. Confirm the turn-detection tolerance does not misfire on a near-square resize.
- [ ] **Out-of-bounds repair.** `fitObjectsInsideLabel` must move an object hanging off the label back inside, and
      must **scale down** an object larger than the label (moving cannot make it fit) while keeping its shape and
      correcting for the object's origin so it does not drift.
- [ ] **Label shape.** The shape is `rect`, `rounded_rect` or `circle` (`web/src/types.ts`,
      `LabelPropsEditor.svelte`). The geometry is now **shape-aware**: `web/src/utils/label_fit.ts` exports
      `printableArea(width, height, shape)`, `isOnLabel(x, y, width, height, shape)` and `CORNER_RADIUS`.
      `adaptContentToLabel` and `fitObjectsInsideLabel` take the shape and fit into the *printable area* — the
      inscribed square for a circle, the corner-inset for a rounded rectangle — and `preflight.ts` takes a
      `shape` option so `outside-label` tests the object's corners against the label itself.
      **Verify this actually holds** rather than taking it on trust: check that `runPreflight` is called with
      `shape` at every call site in `LabelDesigner.svelte`, that `adaptContentToLabel` is called with the shape
      when the label size changes, and that a circle label reports content in a corner as clipped. If the printable
      area of a circle or rounded rectangle is not enforced on some path, report it as a FAIL with the consequence:
      content in the corner of a circular label is silently clipped and the preflight does not warn.

## 5. Printer integration

Hardware cannot be exercised from a headless browser. Verify the code paths and the UI, then hand the user the
checklist in §10.

- [ ] **Bluetooth connect (D11).** `web/src/components/PrinterConnector.svelte` → `web/src/services/device_grants.ts`.
      Confirm the app calls `navigator.bluetooth.requestDevice` behind a user gesture, handles refusal, and remembers
      the granted device in `localStorage` under `labelbench_last_device`. Confirm a granted printer comes back with
      **no** picker via `navigator.bluetooth.getDevices()` — one-click reconnect.
- [ ] **Serial connect (B21 / B1).** `navigator.serial.requestPort` / `getPorts()`. Confirm
      `web/src/utils/serial_identify.ts` probes each granted port with the connection handshake so a printer is
      recognised from the ports that answer, and that a wrong port produces a message naming the port that *does* have
      a printer rather than a bare error.
- [ ] **Model detection from the printer's own model id.** The app must not ask the user which printer it is. Confirm
      the model comes from the printer's reported id via the library's model table (`getPrinterMetaById` /
      `getPrinterMetaByModel`), that the family mapping (`familyForModel`) covers the D11 and B21 variants the library
      knows, and that `web/src/stores/app.ts` populates `printerMeta` from the client's own metadata.
- [ ] **The printer is the authority — there is no model selector.** The toolbar must NOT offer a D11/B21 choice.
      Confirm `LabelDesigner.svelte` has no model buttons, that the connected printer is shown instead as a readout
      (`tool-group__printer`), and that `printerProfile` (derived in `web/src/stores/app.ts`) drives the model,
      the feed direction, the head width, the density range and the label type.
- [ ] **The design follows the connected printer.** When a printer connects, the app must adopt its feed direction
      (`left` for the D11 family, `top` for the B21 family) and turn the design a quarter if it was drawn for the
      other family — `retargetToDirection` / `turnContent` in `web/src/utils/label_fit.ts`, called from
      `adoptPrinter` in `LabelDesigner.svelte`. A design for the wrong family prints sideways otherwise. Confirm a
      template loaded from the gallery is re-targeted the same way, and that the **stored** template keeps its own
      model so the gallery can still show what a template was made for.
- [ ] **The label type is one the printer understands.** `resolveLabelType` in `web/src/utils/printer_profile.ts`
      filters the roll's RFID consumables type and the user's choice against the printer's own `paperTypes` list and
      falls back to `WithGaps`. Confirm the print preview sends that resolved type, and that the batch path does
      too. This is the **WriteRfidFail (library error code 20)** path: telling a printer a stock type it does not
      understand makes it attempt an RFID write it cannot complete, and the print never starts.
- [ ] **The printer's reported loaded media is picked up automatically.** `readLoadedLabel()` calls `fetchRfidInfo()`,
      and the app reads `paperInfo.paperWidth`, `paperInfo.paperHeight`, `paperInfo.paperType` and
      `paperInfo.gapHeight` (the `PaperInfo` interface in the library's `packets/dto.d.ts`).
      `loadedLabelOf` in `web/src/utils/printer_profile.ts` turns the reported millimetres into a physical label
      (width across the head × length along the roll), and `canvasForPrinter` puts it into a canvas **in the
      printer's own orientation**. Confirm the app applies it automatically on connect — `applyLoadedLabel` in
      `LabelDesigner.svelte` — and that the connector's manual action does the same, clamping the width to the
      printer's own printhead width.
- [ ] **A continuous roll is not mistaken for a label.** `loadedLabelOf` refuses a reported length above 300 mm,
      because on a continuous roll the sensor reports what is left of the media rather than one label. Confirm the
      guard is present and that such a roll leaves the label size alone rather than setting an absurd one.
- [ ] **Paper mismatch is a warning, not a block.** In the print preview, a disagreement between the drawn label and
      the reported media must warn (it still prints, in the wrong place) while an over-wide raster must block. Confirm
      the print button is disabled when the width is blocked.
- [ ] **Origin specificity is surfaced.** Confirm the UI or docs tell the user a grant is per origin —
      `https://labelbench.local:8443` and `https://10.10.17.185:8443` are different origins, and a grant does not
      carry between them or between ports.
- [ ] **Feature detection is honest.** `Utils.getAvailableTransports()` drives which transports the app offers. Note
      that **Web Bluetooth does not exist in Chrome on Linux** — a D11 needs a Windows, macOS or ChromeOS workstation,
      and a Linux workstation can use a B21 over Web Serial. Confirm the app degrades honestly when
      `navigator.bluetooth` is `undefined` rather than offering a transport that cannot work.

## 6. Templates

- [ ] **Central store.** No template may live only in the browser. Confirm `web/src/services/api.ts` +
      `template_store.ts` read and write through the server, and that a template saved on one workstation appears in
      the gallery on another.
- [ ] **Import / export round-trip.** Export to JSON (`FileUtils.saveLabelAsJson` / `saveLabelsAsJson`), re-import
      (`parseSingleOrList` in the saved-labels menu), and confirm the round-trip preserves the canvas object graph,
      the label geometry (size, dpmm, shape, split, mirror, offset), the target model, the declared variables, the CSV
      column bindings, the tags and the thumbnail. Confirm the `id` is handled deliberately — it is a server UUID when
      the template came from the central store.
- [ ] **Version history and restore.** As in §2 — confirm the restore returns a coherent template (the snapshot
      includes model and variables, not just the canvas).
- [ ] **Dynamic Date & time and Serial number tokens resolve at print time.** The grammar is in
      `web/src/utils/dynamic_values.ts` (`VARIABLE_TEMPLATE_RX`): `{dt}`, `{dt|YYYY-MM-DD}`, `{dt+1d}`, `{dt-1d}`,
      `{dt|HH:mm:ss}`, `{serial}`. Confirm the **template stores the token**, not today's value: the object carries
      `dynamicToken`, the canvas shows the resolved value for editing, and `canvasPreprocess` in
      `web/src/utils/canvas_preprocess.ts` re-resolves the token at render time, so tomorrow's label carries
      tomorrow's date. Confirm the serial number comes from the **server counter** at print time, and that a preview
      does not consume a number (peek vs allocate).
- [ ] **Linked barcodes and QR follow their source objects.** A barcode or QR linked to a serial-number object must
      encode the same number printed as text. Verify the link is by object id (`linkedObjectId` in
      `web/src/utils/linked_objects.ts`), that resolution reads the **source object's** token (not the barcode's own
      text), and that the bars and the text cannot disagree.

## 7. CSV batch printing

- [ ] **Column mapping.** `web/src/utils/csv_batch.ts`: `parseCsv` (PapaParse — BOM, ragged rows, quoted fields with
      delimiters and newlines, delimiter sniffing), `autoBind` (exact name, case-insensitive, and the `lot_code` →
      `lot` suffix-stripped rule), and hand adjustment. Confirm the binding is persisted with the template so
      re-importing a CSV of the same shape works next time, including when headers were renamed but the binding still
      points at an existing column.
- [ ] **One counter value per label.** With a serial sequence, **every copy is its own label** and takes its own
      number from the central counter (`allocateSerialValues` in `web/src/utils/dynamic_values.ts`, called per copy
      from `runBatch` in `web/src/utils/batch_printer.ts`). A row with three copies must print three different
      numbers, not one number three times. Confirm the counter advances across batches and across workstations.
- [ ] **Preflight blocking.** A row whose label is wider than the connected printer's print head must be **rejected
      with a clear message**, never silently sent. Confirm `runBatch` throws on `evaluation.blocked` and records the
      row as failed while the batch continues, and that the batch dialog shows the same warning before it starts.
- [ ] **Per-row isolation.** One bad row must not abort the batch: it is marked failed with its error, the rest
      continue, and failed rows can be retried alone. Confirm pause and cancel work mid-run and that cancelled rows
      end as `skipped`, not stuck on `printing`.
- [ ] **A missing required value blocks the batch** with the variable names listed (`findMissingRequired`), rather
      than printing an empty field.

## 8. Security and deployment

- [ ] **The API-key gate.** As in §2 — enabled, enforced, constant-time, health open, SPA shell ungated.
      `LABELBENCH_AUTH_MODE` and `LABELBENCH_API_KEY` come from `.env` / the compose environment. Confirm the key
      never appears in an image layer, a log line or a browser-visible URL. Report it as `[REDACTED]`.
- [ ] **Path traversal on asset upload.** The uploaded filename is stored as metadata; the on-disk path is
      content-addressed (`<sha256>.bin`), and `resolveInside` in `app/src/db/index.ts` refuses a path that escapes the
      asset root. **Verify empirically**: upload a file named `../../../etc/passwd` and confirm (a) the stored `path`
      is a digest, not the supplied name, and (b) no file appears outside the asset directory. Confirm `GET
      /api/assets/:id` cannot be made to read outside the asset root.
- [ ] **XSS in template names and CSV content.** Confirm the SPA never uses `{@html}` or `innerHTML` for these values
      (grep for both) — Svelte escapes text interpolation by default, so the risk is in any raw-HTML sink. Create a
      template named `<img src=x onerror=alert(1)>` and a CSV cell containing the same; confirm they render as literal
      text and never execute. Also confirm an uploaded asset with MIME type `text/html` is served in a way that cannot
      run script in the app's origin.
- [ ] **SQLite backup / restore correctness.** `scripts/backup.sh` uses SQLite's **online backup API**, not a file
      copy — the database runs in WAL mode, so a plain copy of `labelbench.db` can be missing the tables entirely. Run
      the script against the running stack and confirm it reports `integrity: ok` and a non-zero template count.
      Confirm it refuses to run when the `app` service is not running. **There is no `scripts/restore.sh`** — the
      restore is a documented manual procedure in `docs/PRODUCTION-INSTALL.md` §8 ("Restoring"), which removes the
      stale `-wal`/`-shm` files and `chown -R 1000:1000 /data`, because the container runs as `node` (uid 1000).
      Verify the procedure against the repo; no restore tool ships.
- [ ] **Caddy TLS and the CA distribution page.** Read `deploy/caddy/Caddyfile`: `auto_https off`, `admin off`, an
      internal certificate at `deploy/caddy/certs/labelbench.pem`, `Strict-Transport-Security`,
      `X-Content-Type-Options`, `Referrer-Policy`, `-Server`. Confirm the site block answers for **both** the hostname
      and the LAN IP with the IP as a SAN (one site, two addresses — two site blocks break the handshake for a
      ClientHello with no SNI). Confirm the plain-HTTP site serves the root CA at `/rootCA.pem` and the setup page at
      `/setup`, and that the HTTP listener redirects naming the HTTPS port **explicitly** (using `{host}` would send
      the browser to an HTTP port over HTTPS). The private key must stay out of git (`.gitignore` excludes
      `deploy/caddy/certs/*.pem`).
- [ ] **The CA fingerprint is verifiable.** `deploy/caddy/setup.html` publishes the root CA's SHA-256 fingerprint so a
      workstation can check it before trusting it. Confirm it matches the actual certificate: `openssl x509 -in
      deploy/caddy/certs/rootCA.pem -noout -fingerprint -sha256`.
- [ ] **The image holds no secrets.** `app/Dockerfile` is a multi-stage Debian build; the runtime stage copies only
      `dist`, `public`, `package.json` and `node_modules`. Confirm the running container holds no `.env`, no
      certificates, no private keys and no source — check with `docker compose exec -T app ls -la /app`.
- [ ] **Compose correctness.** `docker compose config -q` is clean. The app service exposes 3000 internally and stores
      state in the `labelbench-data` volume; Caddy publishes the HTTPS and HTTP ports from `.env`. Ports 80 and 443
      are deliberately unused so another app can own them. Confirm the Caddy container mounts the whole `deploy/caddy`
      **directory**, not the Caddyfile alone — a single-file bind mount pins the inode, and the container serves a
      stale file after an atomic replacement.
- [ ] **The server never connects to a printer.** Grep the server source for device access — there must be none.
      Printing is browser-only.

## 9. UI / UX

- [ ] **The immersive layout.** Top app bar (`MainPage.svelte`), left tool rail (`designer-toolbar` in
      `LabelDesigner.svelte`), canvas hero (`stage`), right inspector (`props-panel`), bottom status bar
      (`app-footer`). The grid is `13.5rem minmax(0,1fr) 21rem` with breakpoints at 1200 px and 900 px. Confirm the
      four regions are present and the canvas is the visual centre of gravity.
- [ ] **Light and dark themes.** The dark palette is the default; the light palette sits behind `@media
      (prefers-color-scheme: light)` in `web/src/styles/style.scss`. Verify both render correctly and that no text is
      unreadable in either. Note whether the theme follows the OS only or a manual override exists.
- [ ] **Offline fonts.** `web/src/styles/font.scss` must reference the **locally bundled**
      `@fontsource-variable/noto-sans` WOFF2 files and the local Material Icons — no Google Fonts, no CDN. Confirm the
      built `web/dist` contains the font files and the CSS references them by relative path.
- [ ] **Nothing breaks at narrow widths.** Check roughly 1400, 1200, 900 and 768 px: the grid collapses to two columns
      then one, the tool rail stays usable, the canvas stays reachable, and nothing overflows horizontally. Report the
      width at which the layout actually breaks, if it does.
- [ ] **The status bar is informative** — connection state and the connected printer's name, the first thing a person
      looks for when something is not printing.
- [ ] **The language picker works** (`web/src/locale/dicts/` holds many dictionaries) and the UI is fully translated
      in the selected locale.

## 10. MANUAL HARDWARE CHECKLIST — for the user to run

Everything below needs a physical printer and a real browser. A headless browser cannot be granted a Bluetooth or
serial device, so **none of this can be automated** and none of it may be reported as passed on the strength of code
inspection. Copy this section into the final report verbatim, with the verdict boxes left blank for the user.

**Before you start**

- [ ] Use **Chrome, Edge, or another Chromium browser** (Firefox and Safari do not implement the device APIs this app
      needs).
- [ ] Open the app at a **browser-trusted HTTPS origin** — `https://labelbench.local:8443` — **not** `http://`, and
      not `localhost`. In the console `window.isSecureContext` must be `true` and `typeof navigator.serial` / `typeof
      navigator.bluetooth` must not be `undefined`. If `navigator.bluetooth` is `undefined` you are on Linux Chrome,
      which has no Web Bluetooth — use a B21/B1 over serial instead.
- [ ] Trust the internal CA on this workstation first (section 7 of `docs/PRODUCTION-INSTALL.md`). Until the CA is
      trusted the browser strips the device APIs entirely.
- [ ] **The printer must be plugged into the workstation running the browser.** A printer on another machine is
      invisible to this one.
- [ ] On Linux, the browser's user must be in the `dialout` group (`sudo usermod -aG dialout "$USER"`, then log out
      and back in) or the serial port cannot be opened.
- [ ] Connect on **the same address you print on** — a grant at `https://labelbench.local:8443` does not carry to
      `https://10.10.17.185:8443`.

**A — NIIMBOT D11 over Bluetooth**

- [ ] Pair the D11 with the workstation's Bluetooth settings.
- [ ] In LabelBench, choose **Bluetooth** in the app bar and press connect; pick the D11 in the browser's device
      chooser.
- [ ] The app shows the model **`D11`** automatically, detected from the printer's own model id, with no model picker
      in the app.
- [ ] The **loaded media** panel shows the roll's width × height in mm (the printer measures it behind the print
      head). Note the numbers.
- [ ] The app reports a print head of **12 mm** (96 px at 203 dpi) and feed direction **left**.
- [ ] Load a D11 template (40 × 12 mm is the default D11 preset) and press print. The preview shows the real 1-bit
      rendering.
- [ ] **The printed label is the right way up** — text reads normally, not sideways, not mirrored.
- [ ] The label's width across the head matches the roll's width, and the gap between labels is correct.
- [ ] The print head does not cut off the right-hand edge of the content.
- [ ] **No `WriteRfidFail` error** (library error code 20) appears in the log or console. If it does, the app sent a
      label type the printer does not understand — report the label type selected and the model.
- [ ] Disconnect and reconnect. The printer comes back **without** a device chooser (one-click reconnect via the
      remembered grant).
- [ ] Repeat the connect from `https://10.10.17.185:8443` and confirm the chooser appears again — the grant did not
      carry to the other origin.

**B — NIIMBOT B21 over serial (USB)**

- [ ] Plug the B21 into the workstation with USB. It appears as a serial port (`ls /dev/ttyACM*`).
- [ ] In LabelBench, choose **Serial** and press connect; pick the printer's port from the browser's chooser. If the
      wrong port is picked, confirm the app names the port that *does* have a printer.
- [ ] The app shows the model **`B21`** automatically.
- [ ] The **loaded media** panel shows the roll's width × height in mm.
- [ ] The app reports a print head of **48 mm** (384 px at 203 dpi) and feed direction **top**.
- [ ] The density control accepts the range the printer supports (1–5 for a B21); the default is 3.

**C — THE REQUIRED 40 × 20 mm CHECK ON A B21** *(the specific regression the review must not skip)*

- [ ] Open the label properties and set the size to **40 mm × 20 mm**, unit set to **mm**. The canvas must become
      **320 × 160 px** (40 mm × 8 px/mm by 20 mm × 8 px/mm) at 8 dpmm.
- [ ] The target model is **B21**, whose feed direction is **top** — so the 40 mm dimension crosses the 48 mm print
      head and the 20 mm dimension runs along the roll.
- [ ] **The width check must NOT block.** 40 mm ≤ 48 mm, so the print button stays enabled. If the app blocks this
      label, that is a **FAIL** of the millimetre-based width check — the classic symptom of comparing pixels across
      two resolutions (40 mm at 300 dpi is 472 px against a 384 px head). Record the exact message.
- [ ] Place a **40 × 20 mm** roll in the B21 and print.
- [ ] Measure the printed label with a ruler: it must be **40 mm across the head and 20 mm along the roll**, within
      about 1 mm. A different physical size means the raster was not resampled to the printer's native 203 dpi.
- [ ] The content is **the right way up** and **centred** — not sideways, not shifted toward one edge.
- [ ] Nothing is clipped at either edge, and the content is not scaled relative to the label.
- [ ] Repeat with the same 40 × 20 mm template after switching the target model to **D11**: the app must now **block**
      the print, with a message in millimetres (40 mm > 12 mm), rather than sending a raster the D11 cannot print.
      Record the exact wording.
- [ ] Switch back to B21 and confirm the design was turned a quarter turn with the canvas and the content re-centred —
      the printed label must come out the same way round as before the switch.

**D — Serial number, CSV batch, and the counter**

- [ ] Open the CSV batch dialog, import a CSV with several rows, and confirm the columns auto-bind to the template's
      variables.
- [ ] Enable serial auto-increment with **3 copies per row**. Print. Confirm the three copies carry **three different
      serial numbers** and that the barcode linked to the serial encodes the **same** number as the text.
- [ ] Print the next row and confirm the numbers continue where the previous row stopped — the counter is server-side
      and must not restart.
- [ ] **On a second workstation**, print one label of the same template and confirm its serial number continues the
      same sequence rather than colliding with the first workstation's.
- [ ] Stop and resume a batch mid-run; cancel a batch and confirm the remaining rows are marked skipped rather than
      left hanging.
- [ ] Load a template whose label is wider than the printer's head and confirm the batch **rejects the rows with a
      clear message** instead of sending them.

**E — Deployment and certificate**

- [ ] On a workstation that has never opened the app, browse to `http://labelbench.local:8082` and confirm the setup
      page appears with the root CA download and the fingerprint.
- [ ] Compare the fingerprint on that page with `openssl x509 -in deploy/caddy/certs/rootCA.pem -noout -fingerprint
      -sha256` **before** trusting anything.
- [ ] Trust the CA, then open `https://labelbench.local:8443` and confirm there is no certificate warning.
- [ ] Run `./scripts/backup.sh`, confirm it prints `integrity: ok` and a non-zero template count, and confirm the
      database file it wrote is larger than a few kilobytes (a WAL-mode database copied naively comes out tiny and
      with no tables).
- [ ] Follow the restore procedure in `docs/PRODUCTION-INSTALL.md` §8 on a scratch deployment. Confirm the templates
      and assets come back and that **saving a new template still works** afterwards (a template that lists but cannot
      be saved is the signature of the ownership problem).

## 11. How to report

1. **Summary** — the commit reviewed, a one-line verdict (`READY TO DEPLOY` / `NOT READY`), and the PASS / FAIL /
   BLOCKED counts.
2. **The verdict table** — every checklist item with its verdict, keeping the §1–§10 numbering so the user can tick
   items off by hand.
3. **FAILs, most severe first.** For each: file and line, what you observed, the exact command output that shows it,
   the correct behaviour, and a one-line suggested fix. Distinguish a **regression introduced by a recent commit**
   (name it) from a **long-standing gap**.
4. **BLOCKED items.** For each: exactly what hardware, credential or access is missing, and exactly what the user must
   do to unblock it. A BLOCKED item is never quietly a PASS.
5. **What was verified without hardware**, and **what was not verified at all** — in those words, with no inference
   from code inspection dressed up as a hardware result.
6. **The manual hardware checklist** from §10, copied verbatim, with the blank verdict boxes intact.

Report rules: never claim a physical print result; never print a key, password, token or private key (write
`[REDACTED]`); quote real command output only for commands you actually ran; if a check is impossible offline, say so
and name the missing piece; do not propose re-adding DYMO/WebUSB, Tailwind, FontAwesome, Google Fonts, CDN links or
runtime internet calls.
