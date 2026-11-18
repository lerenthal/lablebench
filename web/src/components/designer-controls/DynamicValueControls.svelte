<script lang="ts">
  import * as fabric from "fabric";
  import { tr } from "$/utils/i18n";
  import { TextboxExt } from "$/fabric-object/textbox-ext";
  import {
    DATE_TIME_FORMATS,
    dateTimeToken,
    parseDynamicToken,
    preprocessDateTime,
    substituteTokens,
  } from "$/utils/dynamic_values";
  import {
    fieldTextHasHeader,
    headingOfFieldText,
    withHeader,
    withHeading,
  } from "$/utils/csv_fields";
  import { previewValues } from "$/stores/csv_source";
  import type { SerialConfig } from "$/types";
  import SerialConfigControls from "$/components/designer-controls/SerialConfigControls.svelte";

  interface Props {
    selectedObject: fabric.FabricObject | undefined;
    serialConfig: SerialConfig | undefined;
    /** What the next label would print, for the serial variable. */
    serialNextValue: string | undefined;
    /** Called when the template's serial counter settings change. */
    onSerialConfigChanged?: (config: SerialConfig | undefined) => void;
    editRevision: number;
    valueUpdated: () => void;
  }

  let {
    selectedObject,
    serialConfig,
    serialNextValue,
    onSerialConfigChanged,
    editRevision,
    valueUpdated,
  }: Props = $props();

  const tokenOf = (obj: fabric.FabricObject | undefined): string =>
    obj instanceof TextboxExt ? (obj.dynamicToken ?? obj.text ?? "") : "";

  /**
   * The token lives on a fabric object, which is not reactive state, so
   * nothing here would notice this panel's own edits. `editRevision` is the
   * signal the designer bumps whenever an object changes, so it is read to
   * make the panel follow the object it is showing.
   */
  const parsed = $derived.by(() => {
    void editRevision;

    return parseDynamicToken(tokenOf(selectedObject));
  });

  const isDate = $derived(parsed?.kind === "date");

  const isSerial = $derived(
    parsed?.kind === "variable" &&
      parsed.name !== undefined &&
      parsed.name === serialConfig?.variable,
  );

  const isField = $derived(
    parsed?.kind === "variable" && parsed.name !== undefined && !isSerial,
  );

  const currentFormat = $derived(isDate ? (parsed?.format ?? "") : "");

  /**
   * A field: a merge variable that is not the serial number.
   *
   * Every such object carries its value and, optionally, its heading in one
   * string, so this panel is where the heading is turned on, off or reworded.
   * It is read back out of the text each time rather than kept beside it: a
   * flag could come to disagree with what the label actually says.
   */
  const fieldText = $derived.by(() => {
    void editRevision;

    return isField ? tokenOf(selectedObject) : "";
  });
  const fieldColumn = $derived(isField ? (parsed?.name ?? "") : "");
  const headingShown = $derived(isField ? fieldTextHasHeader(fieldText) : false);

  let formatInput = $state("");
  let headingInput = $state("");

  $effect(() => {
    // editRevision is read so the panel follows the selected object.
    void editRevision;

    if (currentFormat !== formatInput) {
      formatInput = currentFormat;
    }

    const heading = headingOfFieldText(fieldText) ?? "";

    if (heading !== headingInput) {
      headingInput = heading;
    }
  });

  /**
   * Put a new field text on the object, and show what it would print.
   *
   * The token goes on `dynamicToken` and the resolved value on the canvas,
   * which is the same arrangement every dynamic object uses. Resolving here
   * rather than waiting for the next refresh is what makes the toggle feel
   * like a toggle: the heading appears on the label as it is switched on.
   */
  const applyFieldText = (text: string) => {
    if (!(selectedObject instanceof TextboxExt)) {
      return;
    }

    selectedObject.dynamicToken = text;
    selectedObject.set({ text: substituteTokens(text, $previewValues) });
    headingInput = headingOfFieldText(text) ?? "";
    valueUpdated();
  };

  const applyFormat = (format: string) => {
    if (!(selectedObject instanceof TextboxExt)) {
      return;
    }

    formatInput = format;
    selectedObject.dynamicToken = dateTimeToken(format);
    selectedObject.set({ text: preprocessDateTime(format) });
    valueUpdated();
  };
</script>

{#if isDate}
  <div class="mb-3">
    <h6 class="small text-uppercase">{$tr("params.datetime.title")}</h6>

    <label class="form-label small" for="datetime-format">{$tr("params.datetime.format")}</label>
    <input
      id="datetime-format"
      class="form-control"
      type="text"
      bind:value={formatInput}
      onchange={() => applyFormat(formatInput)} />

    <div class="mt-2 d-flex flex-wrap gap-1">
      {#each DATE_TIME_FORMATS as format (format)}
        <button
          class="btn btn-sm {currentFormat === format ? 'btn-primary' : 'btn-outline-secondary'}"
          onclick={() => applyFormat(format)}>
          {format}
        </button>
      {/each}
    </div>

    <div class="small text-muted mt-2">
      {$tr("params.datetime.preview")}: <code>{preprocessDateTime(formatInput)}</code>
    </div>
  </div>
{/if}

{#if isField}
  <div class="mb-3">
    <h6 class="small text-uppercase">{$tr("params.field.title")}</h6>

    <div class="small">
      {$tr("params.field.bound")}: <code>{`{${fieldColumn}}`}</code>
    </div>

    <div class="form-check form-switch mt-2">
      <input
        class="form-check-input"
        type="checkbox"
        role="switch"
        id="field-heading-shown"
        checked={headingShown}
        onchange={(e) => applyFieldText(withHeader(fieldText, e.currentTarget.checked))} />
      <label class="form-check-label small" for="field-heading-shown">
        {$tr("params.field.show_heading")}
      </label>
    </div>

    <label class="form-label small mt-2" for="field-heading">{$tr("params.field.heading")}</label>
    <input
      id="field-heading"
      class="form-control form-control-sm"
      type="text"
      bind:value={headingInput}
      onchange={() => applyFieldText(withHeading(fieldText, headingInput))} />
    <div class="small text-muted mt-1">{$tr("params.field.heading_hint")}</div>
  </div>
{/if}

{#if isSerial}
  <div class="mb-3">
    <h6 class="small text-uppercase">{$tr("params.serial.title")}</h6>

    <div class="small">
      {$tr("params.serial.bound")}: <code>{parsed?.name}</code>
    </div>

    <div class="small text-muted mt-1">{$tr("params.serial.hint")}</div>

    {#if serialNextValue !== undefined}
      <div class="small mt-1">
        {$tr("params.serial.next")}: <code>{serialNextValue}</code>
      </div>
    {/if}

    <!--
      The counter, the prefix and the suffix belong to the serial number
      object, so they are shown with it. They used to sit in the properties
      panel whether anything was selected or not, where they read as a stray
      button rather than as the settings of anything.
    -->
    {#if onSerialConfigChanged !== undefined}
      <div class="mt-2">
        <SerialConfigControls {serialConfig} onChange={onSerialConfigChanged} />
      </div>
    {/if}
  </div>
{/if}

<input type="hidden" value={editRevision} />
