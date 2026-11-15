<script lang="ts">
  /**
   * CSV batch printing (§5.4) — the Phase 1 headline feature.
   *
   * Import a CSV, bind its columns to the template's declared variables, preview
   * the merged rows, then print them one after another to the printer connected
   * to this workstation.
   *
   * The column → variable binding is persisted with the template so re-importing
   * a CSV of the same shape just works.
   */
  import { LabelType, PageColorType, type PrintTaskName } from "@mmote/niimbluelib";
  import { connectionState, printerClient, printerInfo, printerMeta, printerProfile } from "$/stores/app";
  import AppModal from "$/components/basic/AppModal.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { tr } from "$/utils/i18n";
  import { Toasts } from "$/utils/toasts";
  import {
    autoBind,
    findMissingRequired,
    parseCsv,
    resolveVariables,
    serialValue,
    type CsvRow,
  } from "$/utils/csv_batch";
  import {
    createBatchControl,
    niimbotSink,
    runBatch,
    type BatchControl,
    type BatchRowState,
  } from "$/utils/batch_printer";
    import { DEFAULT_RENDER_PARAMS, renderLabelCanvas, type RenderParams } from "$/utils/label_render";
  import { extractVariablesFromJson } from "$/utils/canvas_preprocess";
  import { headMmForModel } from "$/utils/print_limits";
  import {
    PRINT_HEAD_PIXELS,
    type ExportedLabelTemplate,
    type FabricJson,
    type LabelProps,
    type SerialConfig,
    type TemplateVariable,
    type TemplateVariables,
  } from "$/types";

  interface Props {
    template: ExportedLabelTemplate;
    /** The canvas document with assets already resolved to data URLs. */
    fabricJson: FabricJson;
    labelProps: LabelProps;
    /** Called when the user changes the binding, so it can be persisted. */
    onBindingChanged?: (variables: TemplateVariables) => void;
    onClose?: () => void;
  }

  let { template, fabricJson, labelProps, onBindingChanged, onClose }: Props = $props();

  /**
   * The dialog works on a snapshot of the template taken when it opens.
   * `$state.snapshot` deep-copies the reactive prop into a plain value, so the
   * editable form state below is initialised from it exactly once and is not
   * re-seeded when the parent re-renders.
   */
  const initial = (() => $state.snapshot({ template, labelProps }))();

  let modalRef: AppModal;

  let csvText = $state<string>("");
  let columns = $state<string[]>([]);
  let rows = $state<CsvRow[]>([]);
  let parseErrors = $state<string[]>([]);
  let delimiter = $state<string>(",");

  let variables = $state<TemplateVariable[]>(initial.template.variables?.variables ?? []);
  let binding = $state<Record<string, string>>({ ...(initial.template.variables?.csv_mapping ?? {}) });

  let serialEnabled = $state<boolean>(initial.template.variables?.serial !== undefined);
  let serialVariable = $state<string>(initial.template.variables?.serial?.variable ?? "");
  let serialPrefix = $state<string>(initial.template.variables?.serial?.prefix ?? "");
  let serialSuffix = $state<string>(initial.template.variables?.serial?.suffix ?? "");
  let serialCounter = $state<string>(initial.template.variables?.serial?.counter ?? "");
  let serialStart = $state<number>(initial.template.variables?.serial?.start ?? 1);
  let serialStep = $state<number>(initial.template.variables?.serial?.step ?? 1);
  let serialPad = $state<number>(initial.template.variables?.serial?.pad ?? 0);

  let copiesPerRow = $state<number>(1);
  let density = $state<number>(2);
  let dithering = $state<RenderParams["postProcess"]>("threshold");
  let rotation = $state<"left" | "top">(initial.labelProps.printDirection);

  let page = $state<number>(0);
  let pageSize = 10;
  let selectedRow = $state<number>(-1);
  let previewImage = $state<string>("");

  let rowStates = $state<BatchRowState[]>([]);
  let running = $state<boolean>(false);
  let paused = $state<boolean>(false);
  let progress = $state<number>(0);
  let batchError = $state<string>("");

  let control: BatchControl | undefined = undefined;

  /**
   * Which printer this batch goes to.
   *
   * The NIIMBOT prints at 203 dpi, which is the app's native resolution, so
   * a canvas pixel is a dot and the label is rendered as it is.
   */
  const disconnected = $derived($connectionState !== "connected");

  /**
   * What the batch will print to.
   *
   * The dialog says which printer the batch is going to rather than leaving
   * the user to work it out from the toolbar.
   */
  const targetPrinter = $derived(
    $connectionState === "connected" ? $tr("batch.printer.niim") : $tr("batch.printer.none"),
  );

  /**
   * The head width of the connected printer, in millimetres.
   *
   * A NIIMBOT reports its own head width over the wire, in its own dots.
   * The printer's profile carries it already converted.
   */
  const deviceHeadWidthMm = $derived($printerProfile?.headMm);
  const totalPages = $derived(Math.max(1, Math.ceil(rows.length / pageSize)));
  const currentPageRows = $derived(rows.slice(page * pageSize, page * pageSize + pageSize));
  const doneCount = $derived(rowStates.filter((row) => row.status === "done").length);
  const failedCount = $derived(rowStates.filter((row) => row.status === "failed").length);

  /**
   * The print task is detected from the connected printer by niimbluelib.
   * The template's target model is only a hint — the connected unit wins.
   */
  const detectedPrintTask = $derived<PrintTaskName | undefined>(
    $printerClient?.getPrintTaskType?.() ?? undefined,
  );
  const printTaskName = $derived<PrintTaskName>(detectedPrintTask ?? "B1");

  // The template's declared variables, falling back to whatever placeholders the
  // canvas actually uses.
  $effect(() => {
    if (variables.length === 0) {
      const found = extractVariablesFromJson(fabricJson as { objects?: Array<{ text?: string }> });
      if (found.length > 0) {
        variables = found.map((name) => ({ name, type: "text", required: false }));
      }
    }
  });

  const effectiveVariables = $derived<TemplateVariables>({
    variables,
    csv_mapping: binding,
    serial: serialEnabled && serialVariable !== "" ? serialConfig() : undefined,
  });

  function serialConfig(): SerialConfig {
    return {
      variable: serialVariable,
      counter: serialCounter,
      prefix: serialPrefix,
      suffix: serialSuffix,
      start: serialStart,
      step: serialStep,
      pad: serialPad,
    };
  }

  const notifyBindingChanged = () => {
    onBindingChanged?.(effectiveVariables);
  };

  const onImportFile = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];

    if (file === undefined) {
      return;
    }

    csvText = await file.text();
    parseCsvText();
    input.value = "";
  };

  const parseCsvText = () => {
    if (csvText.trim() === "") {
      columns = [];
      rows = [];
      parseErrors = [];
      return;
    }

    const parsed = parseCsv(csvText);
    columns = parsed.columns;
    rows = parsed.rows;
    parseErrors = parsed.errors;
    delimiter = parsed.delimiter;

    // Keep only bindings whose column still exists.
    const pruned: Record<string, string> = {};
    for (const [variable, column] of Object.entries(binding)) {
      if (columns.includes(column)) {
        pruned[variable] = column;
      }
    }
    binding = pruned;

    page = 0;
    selectedRow = -1;
    rowStates = [];
  };

  const onAutoBind = () => {
    binding = autoBind(columns, variables, binding);
    notifyBindingChanged();
  };

  const onBindingChange = (variable: string, column: string) => {
    const next = { ...binding };

    if (column === "") {
      delete next[variable];
    } else {
      next[variable] = column;
    }

    binding = next;
    notifyBindingChanged();
  };

  const resolvedFor = (row: CsvRow, index: number): Record<string, string> =>
    resolveVariables(
      row,
      variables,
      binding,
      serialEnabled && serialVariable !== "" ? { config: serialConfig(), index } : undefined,
    );

  const onPreviewRow = async (index: number) => {
    selectedRow = index;

    const canvas = await renderLabelCanvas(
      fabricJson,
      labelProps,
      resolvedFor(rows[index]!, index),
      { ...DEFAULT_RENDER_PARAMS, postProcess: dithering },
    );

    // The rendered canvas is detached and its size is not known until it is
    // rendered, so hand the result over as an image. That also guarantees the
    // preview shows exactly the raster the printer will receive.
    previewImage = canvas.toDataURL("image/png");
  };

  const onPrint = async (onlySelected: boolean) => {
    if (disconnected) {
      Toasts.error($tr("batch.no_printer"));
      return;
    }

    if (rows.length === 0) {
      Toasts.error($tr("batch.no_rows"));
      return;
    }

    const targets = rows.map((row, index) => ({ row, index }));

    if (onlySelected && selectedRow !== -1) {
      const single = targets.filter((target) => target.index === selectedRow);
      targets.length = 0;
      targets.push(...single);
    }

    const missing = targets
      .map((target) => findMissingRequired(variables, binding, target.row))
      .filter((names) => names.length > 0);

    if (missing.length > 0) {
      batchError = $tr("batch.missing_required").replace("{names}", missing[0]!.join(", "));
      return;
    }

    batchError = "";
    progress = 0;
    paused = false;
    running = true;

    const states: BatchRowState[] = targets.map((target) => ({
      index: target.index,
      variables: resolvedFor(target.row, target.index),
      copies: copiesPerRow,
      status: "pending",
    }));

    rowStates = states;

    control = createBatchControl();

    try {
      // The transport is behind the sink, so the runner, the serial
      // allocation and the row reporting stay the same whatever it is.
      const totalCopies = targets.reduce((sum, target) => sum + copiesPerRow, 0);

      const sink = niimbotSink({
        client: $printerClient!,
        printTaskName,
        density,
        labelType: LabelType.WithGaps,
        speed: 1,
        pageColor: PageColorType.SingleColor,
        printDirection: rotation,
        totalCopies,
      });

      const results = await runBatch(
        {
          sink,
          fabricJson,
          labelProps: { ...labelProps, printDirection: rotation },
          renderParams: { ...DEFAULT_RENDER_PARAMS, postProcess: dithering },
          serialConfig:
            serialEnabled && serialVariable !== "" ? serialConfig() : undefined,
          headWidthMm: deviceHeadWidthMm,
          modelHeadWidthMm: headMmForModel(template.model),
        },
        states,
        {
          onRowUpdate: (row) => {
            rowStates = rowStates.map((existing) => (existing.index === row.index ? row : existing));
          },
          onProgress: (percent) => {
            progress = percent;
          },
        },
        control,
      );

      rowStates = results;
    } catch (e) {
      batchError = e instanceof Error ? e.message : String(e);
    } finally {
      running = false;
      control = undefined;
    }
  };

  const onPauseToggle = () => {
    if (control === undefined) {
      return;
    }

    if (paused) {
      control.resume();
    } else {
      control.pause();
    }

    paused = !paused;
  };

  const onCancel = () => {
    control?.cancel();
    paused = false;
  };

  const onRetryFailed = async () => {
    const failed = rowStates.filter((row) => row.status === "failed");

    if (failed.length === 0) {
      return;
    }

    await onPrint(false);
  };

  const serialPreview = $derived(
    serialEnabled && serialVariable !== ""
      ? serialValue(serialConfig(), Math.max(0, selectedRow))
      : "",
  );

  const headWidth = $derived($printerProfile?.headMm);
  /** The width the label lays down across the head, in millimetres. */
  const printableWidth = $derived(
    Math.round(
      ((rotation === "left" ? labelProps.size.height : labelProps.size.width) / labelProps.dpmm) * 100,
    ) / 100,
  );
  /** The device cannot print this width, so the rows are rejected. */
  const widthOverflow = $derived(headWidth !== undefined && printableWidth > headWidth);
  /** The template's own model is narrower. A wider printer still prints it. */
  const modelHeadWidth = $derived(headMmForModel(template.model));
  const modelWidthMismatch = $derived(
    modelHeadWidth !== undefined && printableWidth > modelHeadWidth && !widthOverflow,
  );
</script>

<AppModal title={$tr("batch.title")} {onClose} bind:this={modalRef} size="xl">
  <div class="d-flex align-items-center gap-2 mb-3">
    <MdIcon icon="print" />
    <span class="text-secondary">{$tr("batch.printer")}:</span>
    <span class="fw-medium">{targetPrinter}</span>
  </div>

  <div class="row g-3">
    <div class="col-lg-5">
      <div class="d-flex gap-2 mb-2">
        <label class="btn btn-sm btn-outline-secondary mb-0">
          <MdIcon icon="upload_file" />
          {$tr("batch.import_csv")}
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            class="d-none"
            onchange={onImportFile} />
        </label>
        <button class="btn btn-sm btn-outline-secondary" onclick={parseCsvText} disabled={csvText.trim() === ""}>
          <MdIcon icon="refresh" />
          {$tr("batch.parse")}
        </button>
        <button class="btn btn-sm btn-outline-secondary" onclick={onAutoBind} disabled={columns.length === 0}>
          <MdIcon icon="link" />
          {$tr("batch.auto_bind")}
        </button>
      </div>

      <textarea
        class="form-control dsv mb-2"
        rows="6"
        placeholder={$tr("batch.paste_csv")}
        bind:value={csvText}
        onchange={parseCsvText}></textarea>

      <div class="small text-muted mb-2">
        {$tr("batch.rows")}: <strong>{rows.length}</strong>
        {#if columns.length > 0}
          · {$tr("batch.columns")}: <strong>{columns.length}</strong>
          · delimiter <code>{delimiter === "\t" ? "TAB" : delimiter}</code>
        {/if}
      </div>

      {#if parseErrors.length > 0}
        <div class="alert alert-warning py-1 px-2 small">
          {#each parseErrors.slice(0, 5) as error}
            <div>{error}</div>
          {/each}
        </div>
      {/if}

      <h6 class="small text-uppercase">{$tr("batch.mapping")}</h6>

      {#if variables.length === 0}
        <div class="text-muted small">{$tr("batch.no_variables")}</div>
      {:else}
        <div class="mb-2">
          {#each variables as variable (variable.name)}
            <div class="input-group input-group-sm mb-1">
              <span class="input-group-text" title={variable.name}>
                {variable.name}
                {#if variable.required}<span class="text-danger">*</span>{/if}
              </span>
              <select
                class="form-select"
                value={binding[variable.name] ?? ""}
                onchange={(e) => onBindingChange(variable.name, e.currentTarget.value)}>
                <option value="">{$tr("batch.unmapped")}</option>
                {#each columns as column (column)}
                  <option value={column}>{column}</option>
                {/each}
              </select>
            </div>
          {/each}
        </div>
      {/if}

      <h6 class="small text-uppercase">{$tr("batch.serial")}</h6>
      <div class="form-check form-switch mb-1">
        <input
          class="form-check-input"
          type="checkbox"
          role="switch"
          id="serial-enabled"
          bind:checked={serialEnabled}
          onchange={notifyBindingChanged} />
        <label class="form-check-label" for="serial-enabled">{$tr("batch.serial.enable")}</label>
      </div>

      {#if serialEnabled}
        <div class="input-group input-group-sm mb-1">
          <span class="input-group-text">{$tr("batch.serial.variable")}</span>
          <select class="form-select" bind:value={serialVariable} onchange={notifyBindingChanged}>
            <option value="">{$tr("batch.unmapped")}</option>
            {#each variables as variable (variable.name)}
              <option value={variable.name}>{variable.name}</option>
            {/each}
          </select>
        </div>
        <div class="input-group input-group-sm mb-1">
          <span class="input-group-text">{$tr("batch.serial.suffix")}</span>
          <input class="form-control" type="text" bind:value={serialSuffix} onchange={notifyBindingChanged} />
        </div>
        <div class="input-group input-group-sm mb-1">
          <span class="input-group-text">{$tr("batch.serial.counter")}</span>
          <input class="form-control" type="text" bind:value={serialCounter} onchange={notifyBindingChanged} />
        </div>
        <div class="input-group input-group-sm mb-1">
          <span class="input-group-text">{$tr("batch.serial.prefix")}</span>
          <input class="form-control" type="text" bind:value={serialPrefix} onchange={notifyBindingChanged} />
          <span class="input-group-text">{$tr("batch.serial.start")}</span>
          <input
            class="form-control"
            type="number"
            bind:value={serialStart}
            onchange={notifyBindingChanged} />
          <span class="input-group-text">{$tr("batch.serial.step")}</span>
          <input
            class="form-control"
            type="number"
            bind:value={serialStep}
            onchange={notifyBindingChanged} />
          <span class="input-group-text">{$tr("batch.serial.pad")}</span>
          <input
            class="form-control"
            type="number"
            min="0"
            max="20"
            bind:value={serialPad}
            onchange={notifyBindingChanged} />
        </div>
        {#if serialPreview !== ""}
          <div class="small text-muted mb-2">
            {$tr("batch.serial.preview")}: <code>{serialPreview}</code>
          </div>
        {/if}
      {/if}
    </div>

    <div class="col-lg-7">
      <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
        <div class="input-group input-group-sm" style="max-width: 220px">
          <span class="input-group-text">{$tr("batch.copies")}</span>
          <input class="form-control" type="number" min="1" bind:value={copiesPerRow} />
        </div>

        <div class="input-group input-group-sm" style="max-width: 220px">
          <span class="input-group-text">{$tr("batch.density")}</span>
          <input class="form-control" type="number" min="1" max="5" bind:value={density} />
        </div>

        <div class="input-group input-group-sm" style="max-width: 260px">
          <span class="input-group-text">{$tr("batch.dithering")}</span>
          <select class="form-select" bind:value={dithering}>
            <option value="threshold">threshold</option>
            <option value="dither">dither</option>
            <option value="floyd_steinberg">floyd_steinberg</option>
            <option value="jjn">jjn</option>
            <option value="stucki">stucki</option>
            <option value="bayer4">bayer4</option>
            <option value="screentone">screentone</option>
          </select>
        </div>

        <div class="input-group input-group-sm" style="max-width: 220px">
          <span class="input-group-text">{$tr("batch.rotation")}</span>
          <select class="form-select" bind:value={rotation}>
            <option value="left">90°</option>
            <option value="top">0°</option>
          </select>
        </div>
      </div>

      {#if widthOverflow}
        <div class="alert alert-danger py-1 px-2 small">
          <MdIcon icon="block" />
          {$tr("batch.width_warning")} ({printableWidth} mm &gt; {headWidth} mm)
        </div>
      {/if}

      {#if modelWidthMismatch}
        <div class="alert alert-warning py-1 px-2 small">
          <MdIcon icon="warning" />
          {$tr("params.label.warning.model")} ({printableWidth} px &gt; {modelHeadWidth} px)
        </div>
      {/if}

      {#if batchError !== ""}
        <div class="alert alert-danger py-1 px-2 small">{batchError}</div>
      {/if}

      <div class="d-flex gap-2 align-items-center mb-2">
        <button
          class="btn btn-sm btn-primary"
          onclick={() => onPrint(false)}
          disabled={running || disconnected || rows.length === 0 || widthOverflow}>
          <MdIcon icon="print" />
          {$tr("batch.print_all")}
        </button>
        <button
          class="btn btn-sm btn-outline-secondary"
          onclick={() => onPrint(true)}
          disabled={running || disconnected || selectedRow === -1 || widthOverflow}>
          {$tr("batch.print_selected")}
        </button>
        {#if running}
          <button class="btn btn-sm btn-outline-secondary" onclick={onPauseToggle}>
            <MdIcon icon={paused ? "play_arrow" : "pause"} />
            {paused ? $tr("batch.resume") : $tr("batch.pause")}
          </button>
          <button class="btn btn-sm btn-outline-danger" onclick={onCancel}>
            <MdIcon icon="close" />
            {$tr("batch.cancel")}
          </button>
        {/if}
        {#if failedCount > 0 && !running}
          <button class="btn btn-sm btn-outline-warning" onclick={onRetryFailed}>
            <MdIcon icon="refresh" />
            {$tr("batch.retry_failed")}
          </button>
        {/if}
      </div>

      {#if running || doneCount > 0 || failedCount > 0}
        <div class="progress mb-2" role="progressbar">
          <div class="progress-bar" style="width: {progress}%">{progress}%</div>
        </div>
        <div class="small text-muted mb-2">
          {$tr("batch.progress").replace("{done}", String(doneCount)).replace("{total}", String(rows.length))}
          {#if failedCount > 0}
            · <span class="text-danger">{$tr("batch.status.failed")}: {failedCount}</span>
          {/if}
        </div>
      {/if}

      {#if previewImage !== ""}
        <div class="text-center mb-2">
          <img class="batch-preview" src={previewImage} alt="label preview" />
        </div>
      {/if}

      <div class="table-responsive batch-table-wrap">
        <table class="table table-sm table-hover align-middle">
          <thead>
            <tr>
              <th scope="col">#</th>
              {#each columns as column (column)}
                <th scope="col">{column}</th>
              {/each}
              <th scope="col">{$tr("batch.status")}</th>
            </tr>
          </thead>
          <tbody>
            {#each currentPageRows as row, offset (row)}
              {@const absoluteIndex = page * pageSize + offset}
              {@const state = rowStates.find((s) => s.index === absoluteIndex)}
              <tr
                class:table-active={selectedRow === absoluteIndex}
                class:table-danger={state?.status === "failed"}
                onclick={() => onPreviewRow(absoluteIndex)}
                style="cursor: pointer">
                <td>{absoluteIndex + 1}</td>
                {#each columns as column (column)}
                  <td class="text-truncate" style="max-width: 160px">{row[column] ?? ""}</td>
                {/each}
                <td>
                  {#if state === undefined}
                    <span class="text-muted">{$tr("batch.status.pending")}</span>
                  {:else}
                    <span
                      class:text-success={state.status === "done"}
                      class:text-danger={state.status === "failed"}
                      class:text-muted={state.status === "skipped"}>
                      {$tr(`batch.status.${state.status}`)}
                    </span>
                    {#if state.error !== undefined}
                      <div class="small text-danger" title={state.error}>{state.error}</div>
                    {/if}
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      {#if totalPages > 1}
        <div class="btn-group btn-group-sm">
          <button
            class="btn btn-outline-secondary"
            disabled={page === 0}
            onclick={() => (page = Math.max(0, page - 1))}>
            <MdIcon icon="chevron_left" />
          </button>
          <span class="btn btn-outline-secondary disabled">{page + 1} / {totalPages}</span>
          <button
            class="btn btn-outline-secondary"
            disabled={page + 1 >= totalPages}
            onclick={() => (page = Math.min(totalPages - 1, page + 1))}>
            <MdIcon icon="chevron_right" />
          </button>
        </div>
      {/if}
    </div>
  </div>
</AppModal>

<style>
  textarea.dsv {
    font-family: monospace;
    font-size: 0.8rem;
  }

  .batch-preview {
    max-width: 100%;
    max-height: 220px;
    border: 1px solid var(--border-color, #dee2e6);
    image-rendering: pixelated;
  }

  .batch-table-wrap {
    max-height: 320px;
    overflow-y: auto;
  }
</style>
