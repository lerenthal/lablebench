<script lang="ts">
  /**
   * Designing a label from a spreadsheet.
   *
   * Load the CSV, and the label's fields follow from it: one per column, each
   * showing a real value from a chosen row, each then positioned and styled
   * like any other object. That is the way round the lab asked for, and the
   * opposite of what the app used to do - which was to make you draw text
   * objects, type `{lot}` into them from memory, and only then import a CSV
   * and hope the names matched.
   *
   * The row is a preview and nothing else. The template stores the token; the
   * row only decides which value stands in for it on the canvas, so flipping
   * through rows changes what you see and nothing about what you save.
   */
  import AppModal from "$/components/basic/AppModal.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { tr } from "$/utils/i18n";
  import { operatorName } from "$/stores/app";
  import {
    clearCsvSource,
    csvPreviewRow,
    csvSource,
    loadCsvSource,
    previewRowValues,
  } from "$/stores/csv_source";
  import { headerLabelFor } from "$/utils/csv_fields";

  interface Props {
    /** Columns that already have a field on the canvas. */
    existingColumns: string[];
    /** Lay out a field for every column given. */
    onGenerate: (columns: string[], showHeadings: boolean) => void;
    /** Add one field, centred like any other new object. */
    onAddField: (column: string, showHeading: boolean) => void;
    onAddDate: () => void;
    onAddSerial: () => void;
    onAddOperator: () => void;
    onClose?: () => void;
  }

  let {
    existingColumns,
    onGenerate,
    onAddField,
    onAddDate,
    onAddSerial,
    onAddOperator,
    onClose,
  }: Props = $props();

  let showHeadings = $state<boolean>(true);
  let pasted = $state<string>("");

  const columns = $derived($csvSource?.columns ?? []);
  const rowCount = $derived($csvSource?.rows.length ?? 0);
  const errors = $derived($csvSource?.errors ?? []);

  const onImportFile = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];

    if (file === undefined) {
      return;
    }

    loadCsvSource(file.name, await file.text());
    pasted = "";
    input.value = "";
  };

  const onUsePasted = () => {
    if (pasted.trim() === "") {
      return;
    }

    loadCsvSource($tr("fields.pasted"), pasted);
  };

  const stepRow = (by: number) => {
    if (rowCount === 0) {
      return;
    }

    csvPreviewRow.set(Math.min(rowCount - 1, Math.max(0, $csvPreviewRow + by)));
  };

  /** What a column shows on the row being previewed, shortened for the list. */
  const sampleOf = (column: string): string => {
    const value = $previewRowValues[column] ?? "";

    return value.length > 28 ? `${value.slice(0, 27)}…` : value;
  };
</script>

<AppModal title={$tr("fields.title")} {onClose} size="lg">
  <!-- 1. the spreadsheet ------------------------------------------------- -->
  <h6 class="small text-uppercase">{$tr("fields.source")}</h6>

  <div class="d-flex flex-wrap align-items-center gap-2">
    <label class="btn btn-sm btn-primary mb-0">
      <MdIcon icon="upload_file" />
      {$tr("fields.import")}
      <input type="file" accept=".csv,text/csv,text/plain" class="d-none" onchange={onImportFile} />
    </label>

    {#if $csvSource !== undefined}
      <span class="small">
        <strong>{$csvSource.name}</strong>
        · {$tr("fields.rows")}: <strong>{rowCount}</strong>
        · {$tr("fields.columns")}: <strong>{columns.length}</strong>
      </span>
      <button class="btn btn-sm btn-outline-secondary" onclick={clearCsvSource}>
        <MdIcon icon="close" />
        {$tr("fields.forget")}
      </button>
    {:else}
      <span class="small text-muted">{$tr("fields.none_loaded")}</span>
    {/if}
  </div>

  {#if $csvSource === undefined}
    <div class="mt-2">
      <textarea
        class="form-control dsv"
        rows="4"
        placeholder={$tr("fields.paste")}
        bind:value={pasted}></textarea>
      <button
        class="btn btn-sm btn-outline-secondary mt-2"
        disabled={pasted.trim() === ""}
        onclick={onUsePasted}>
        <MdIcon icon="playlist_add" />
        {$tr("fields.use_pasted")}
      </button>
    </div>
  {/if}

  {#if errors.length > 0}
    <div class="alert alert-warning py-1 px-2 small mt-2 mb-0">
      {#each errors.slice(0, 5) as error, i (i)}
        <div>{error}</div>
      {/each}
    </div>
  {/if}

  {#if $csvSource !== undefined && columns.length > 0}
    <!-- 2. the row being previewed --------------------------------------- -->
    <hr />
    <h6 class="small text-uppercase">{$tr("fields.preview_row")}</h6>

    <div class="d-flex align-items-center gap-2">
      <button
        class="btn btn-sm btn-outline-secondary"
        disabled={$csvPreviewRow <= 0}
        onclick={() => stepRow(-1)}>
        <MdIcon icon="chevron_left" />
      </button>
      <span class="small">{$csvPreviewRow + 1} / {rowCount}</span>
      <button
        class="btn btn-sm btn-outline-secondary"
        disabled={$csvPreviewRow >= rowCount - 1}
        onclick={() => stepRow(1)}>
        <MdIcon icon="chevron_right" />
      </button>
      <span class="small text-muted">{$tr("fields.preview_row_hint")}</span>
    </div>

    <!-- 3. the fields ---------------------------------------------------- -->
    <hr />
    <h6 class="small text-uppercase">{$tr("fields.generate")}</h6>

    <div class="form-check form-switch">
      <input
        class="form-check-input"
        type="checkbox"
        role="switch"
        id="fields-headings"
        bind:checked={showHeadings} />
      <label class="form-check-label small" for="fields-headings">{$tr("fields.with_headings")}</label>
    </div>

    <button class="btn btn-sm btn-primary mt-2" onclick={() => onGenerate(columns, showHeadings)}>
      <MdIcon icon="auto_awesome_motion" />
      {$tr("fields.generate_all")}
    </button>
    <div class="small text-muted mt-1">{$tr("fields.generate_hint")}</div>

    <table class="table table-sm align-middle mt-3 mb-0">
      <thead>
        <tr>
          <th class="small text-uppercase">{$tr("fields.column")}</th>
          <th class="small text-uppercase">{$tr("fields.heading")}</th>
          <th class="small text-uppercase">{$tr("fields.value")}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each columns as column (column)}
          <tr>
            <td><code>{`{${column}}`}</code></td>
            <td class="small">{headerLabelFor(column)}</td>
            <td class="small text-muted">{sampleOf(column)}</td>
            <td class="text-end">
              {#if existingColumns.includes(column)}
                <span class="small text-success">
                  <MdIcon icon="check" />
                  {$tr("fields.on_label")}
                </span>
              {:else}
                <button
                  class="btn btn-sm btn-outline-secondary"
                  onclick={() => onAddField(column, showHeadings)}>
                  <MdIcon icon="add" />
                </button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  <!-- 4. the fields that do not come from the spreadsheet ---------------- -->
  <hr />
  <h6 class="small text-uppercase">{$tr("fields.manual")}</h6>
  <div class="small text-muted mb-2">{$tr("fields.manual_hint")}</div>

  <div class="d-flex flex-wrap gap-2">
    <button class="btn btn-sm btn-outline-secondary" onclick={onAddDate}>
      <MdIcon icon="event" />
      {$tr("params.datetime.title")}
    </button>
    <button class="btn btn-sm btn-outline-secondary" onclick={onAddSerial}>
      <MdIcon icon="123" />
      {$tr("params.serial.title")}
    </button>
    <button class="btn btn-sm btn-outline-secondary" onclick={onAddOperator}>
      <MdIcon icon="badge" />
      {$tr("fields.operator")}
    </button>
  </div>

  <div class="mt-3">
    <label class="form-label small" for="operator-name">{$tr("fields.operator_name")}</label>
    <input
      id="operator-name"
      class="form-control form-control-sm"
      type="text"
      maxlength="64"
      placeholder={$tr("fields.operator_placeholder")}
      bind:value={$operatorName} />
    <div class="small text-muted mt-1">{$tr("fields.operator_hint")}</div>
  </div>
</AppModal>

<style>
  textarea.dsv {
    font-family: monospace;
  }
</style>
