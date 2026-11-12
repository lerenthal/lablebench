<script lang="ts">
  import * as fabric from "fabric";
  import { tr } from "$/utils/i18n";
  import { TextboxExt } from "$/fabric-object/textbox-ext";
  import {
    DATE_TIME_FORMATS,
    dateTimeToken,
    parseDynamicToken,
    preprocessDateTime,
  } from "$/utils/dynamic_values";
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

  const parsed = $derived(parseDynamicToken(tokenOf(selectedObject)));

  const isDate = $derived(parsed?.kind === "date");

  const isSerial = $derived(
    parsed?.kind === "variable" &&
      parsed.name !== undefined &&
      parsed.name === serialConfig?.variable,
  );

  const currentFormat = $derived(isDate ? (parsed?.format ?? "") : "");

  let formatInput = $state("");

  $effect(() => {
    // editRevision is read so the panel follows the selected object.
    void editRevision;

    if (currentFormat !== formatInput) {
      formatInput = currentFormat;
    }
  });

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
      {#each DATE_TIME_FORMATS as format}
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
