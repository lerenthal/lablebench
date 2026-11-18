<script lang="ts">
  /**
   * What the printer is and what is loaded in it.
   *
   * This sits beside the canvas rather than inside a menu because it is the
   * thing that decides where the label lands. It answers four questions, and
   * each of them has to be answerable as "the printer did not say" without
   * that reading as a number:
   *
   *   which printer this is, and which one of several it is (the serial);
   *   what media is in it, in millimetres;
   *   how much of the roll is left;
   *   whether any of that matches the design on the canvas.
   *
   * The refresh button is a fallback, not the mechanism. The app re-reads
   * the tag by itself when the heartbeat says the lid has been shut - see
   * `heartbeatSaysNewMedia`. The button is for printers that report neither
   * the lid nor the paper, and for the operator who would rather press
   * something than trust that.
   */
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { tr } from "$/utils/i18n";
  import {
    connectionState,
    heartbeatData,
    printerClient,
    printerInfo,
    printerMeta,
    printerProfile,
    rfidInfo,
    rfidReadAt,
  } from "$/stores/app";
  import { labelsLeft, rollStateOf, type RollState } from "$/utils/printer_roll";
  import { canvasForPrinter, physicalLabelOf } from "$/utils/printer_profile";
  import { LabelType } from "@mmote/niimbluelib";
  import type { TranslationKey } from "$/locale";
  import { logWarn } from "$/utils/app_log";
  import { onDestroy } from "svelte";

  interface Props {
    /** The canvas the designer currently has, in printer dots. */
    canvasSize: { width: number; height: number };
    /** The resolution those dots are measured at. */
    dpmm: number;
    /** Put the loaded label on the canvas. */
    onFit: () => void;
  }

  let { canvasSize, dpmm, onFit }: Props = $props();

  const connected = $derived($connectionState === "connected");

  const roll = $derived<RollState>(
    rollStateOf({
      connected,
      printer: $printerProfile,
      paperInfo: $rfidInfo.paperInfo,
      tag: $rfidInfo.labelRfidInfo,
      heartbeat: $heartbeatData,
    }),
  );

  const left = $derived(labelsLeft($rfidInfo.labelRfidInfo));

  /** The design on the canvas, in millimetres, the way the printer sees it. */
  const designMm = $derived(
    physicalLabelOf(canvasSize.width, canvasSize.height, $printerProfile?.direction ?? "left", dpmm),
  );

  /**
   * Whether the loaded roll and the design are different labels.
   *
   * Compared as canvas dots rather than millimetres: the canvas is a whole
   * number of dots and a millimetre is not, so two sizes that differ by less
   * than one dot are the same label and must not be reported as a mismatch.
   */
  const mismatch = $derived.by(() => {
    if (roll.kind !== "loaded" || $printerProfile === undefined) return false;

    const wanted = canvasForPrinter(roll.label, $printerProfile.direction, $printerProfile.dpmm);

    return wanted.width !== canvasSize.width || wanted.height !== canvasSize.height;
  });

  let refreshing = $state<boolean>(false);

  const refresh = async () => {
    if ($printerClient === undefined || refreshing) return;

    refreshing = true;
    try {
      await $printerClient.fetchRfidInfo();
    } catch (e) {
      logWarn("printer", `The printer did not report the roll: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      refreshing = false;
    }
  };

  // How long ago the roll was read. A reading with no age on it is a reading
  // the operator will trust long after it stopped being true.
  let now = $state<number>(Date.now());
  const tick = setInterval(() => (now = Date.now()), 15_000);
  onDestroy(() => clearInterval(tick));

  const readAgo = $derived.by<string | undefined>(() => {
    if ($rfidReadAt === undefined) return undefined;

    const seconds = Math.max(0, Math.round((now - $rfidReadAt) / 1000));

    if (seconds < 60) return $tr("printer.read.just_now");

    const minutes = Math.round(seconds / 60);

    return `${minutes} ${$tr("printer.read.minutes_ago")}`;
  });

  const typeName = $derived.by<string | undefined>(() => {
    const type = $rfidInfo.labelRfidInfo?.consumablesType;
    if (type === undefined) return undefined;

    return $tr(`preview.label_type.${LabelType[type]}` as TranslationKey);
  });
</script>

<div class="printer-panel">
  <div class="printer-panel__head">
    <span class="printer-panel__title">{$tr("printer.title")}</span>
    {#if connected}
      <button
        class="btn btn-sm btn-outline-secondary printer-panel__refresh"
        disabled={refreshing}
        title={$tr("printer.refresh.hint")}
        onclick={refresh}>
        <MdIcon icon="refresh" />
      </button>
    {/if}
  </div>

  <div class="printer-panel__body">
    {#if !connected}
      <p class="printer-panel__empty">{$tr("printer.none")}</p>
    {:else}
      <!-- 1. which printer, and which one of several -->
      <dl class="printer-panel__rows">
        <dt>{$tr("printer.model")}</dt>
        <dd>{$printerMeta?.model ?? $tr("printer.unknown")}</dd>

        <dt>{$tr("printer.serial")}</dt>
        <dd class="printer-panel__mono">{$printerInfo?.serial || $tr("printer.not_reported")}</dd>

        {#if $printerProfile !== undefined}
          <dt>{$tr("printer.head")}</dt>
          <dd>{$printerProfile.headMm} mm</dd>
        {/if}

        {#if $heartbeatData?.batteryPercents !== undefined}
          <dt>{$tr("printer.battery")}</dt>
          <dd>{$heartbeatData.batteryPercents}%</dd>
        {/if}
      </dl>

      <hr />

      <!-- 2. what is in it -->
      <dl class="printer-panel__rows">
        <dt>{$tr("printer.loaded")}</dt>
        <dd>
          {#if roll.kind === "loaded"}
            <strong>{roll.label.acrossMm} × {roll.label.alongMm} mm</strong>
            {#if roll.gapMm !== undefined}
              <span class="printer-panel__hint">({$tr("connector.paper.gap")} {roll.gapMm} mm)</span>
            {/if}
          {:else if roll.kind === "lid_open"}
            <span class="text-warning">{$tr("printer.roll.lid_open")}</span>
          {:else if roll.kind === "unreadable"}
            <span class="text-warning">{$tr("printer.roll.unreadable")}</span>
          {:else if roll.kind === "no_tag"}
            <span class="printer-panel__hint">{$tr("printer.roll.no_tag")}</span>
          {:else if roll.kind === "too_wide"}
            <span class="text-warning">
              {$tr("printer.roll.too_wide")
                .replace("%w", String(roll.acrossMm))
                .replace("%h", String(roll.headMm))}
            </span>
          {:else}
            <span class="printer-panel__hint">{$tr("printer.roll.no_size")}</span>
          {/if}
          {#if roll.kind === "no_size" && roll.reading !== undefined}
            <!--
              What the printer actually sent. Only here, in the one state
              where the app is admitting it did not understand the answer.
            -->
            <div class="printer-panel__reading">{roll.reading}</div>
          {/if}
        </dd>

        {#if typeName !== undefined}
          <dt>{$tr("printer.roll.type")}</dt>
          <dd>{typeName}</dd>
        {/if}

        <!--
          How much is left. A roll with no tag has no count, and rendering
          that as a number would stop a lab holding a full roll.
        -->
        <dt>{$tr("printer.roll.left")}</dt>
        <dd>
          {#if left !== undefined}
            <strong>{left.left}</strong>
            <span class="printer-panel__hint">{$tr("printer.roll.left.of")} {left.total}</span>
          {:else}
            <span class="printer-panel__hint">{$tr("printer.roll.left.unknown")}</span>
          {/if}
        </dd>

        {#if readAgo !== undefined}
          <dt>{$tr("printer.read")}</dt>
          <dd class="printer-panel__hint">{readAgo}</dd>
        {/if}
      </dl>

      <!-- 3. whether it matches what is being designed -->
      {#if mismatch}
        <div class="alert alert-warning py-2 px-2 small mb-0 mt-2">
          <div>
            {$tr("printer.mismatch")
              .replace("%w", String(designMm.acrossMm))
              .replace("%h", String(designMm.alongMm))}
          </div>
          <button class="btn btn-sm btn-warning mt-2" onclick={onFit}>
            <MdIcon icon="aspect_ratio" />
            {$tr("printer.mismatch.fit")}
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .printer-panel {
    background: var(--lb-surface);
    border: 1px solid var(--lb-border);
    border-radius: var(--lb-radius-lg);
    box-shadow: var(--lb-shadow-sm);
    overflow: hidden;
  }

  .printer-panel__head {
    align-items: center;
    border-bottom: 1px solid var(--lb-border);
    display: flex;
    justify-content: space-between;
    padding: var(--lb-space-2) var(--lb-space-3);
  }

  .printer-panel__title {
    color: var(--lb-text-faint);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }

  .printer-panel__refresh {
    line-height: 1;
    padding: 0.1rem 0.35rem;
  }

  .printer-panel__body {
    padding: var(--lb-space-3);
  }

  .printer-panel__empty {
    color: var(--lb-text-faint);
    font-size: var(--lb-text-sm);
    margin: 0;
  }

  /* Two columns: the question on the left, the printer's answer on the right. */
  .printer-panel__rows {
    column-gap: var(--lb-space-3);
    display: grid;
    font-size: var(--lb-text-sm);
    grid-template-columns: auto minmax(0, 1fr);
    margin: 0;
    row-gap: 0.15rem;
  }

  .printer-panel__rows dt {
    color: var(--lb-text-faint);
    font-weight: 400;
  }

  .printer-panel__rows dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
    text-align: right;
  }

  .printer-panel__mono {
    font-family: monospace;
    font-size: var(--lb-text-xs);
  }

  .printer-panel__hint {
    color: var(--lb-text-faint);
  }

  .printer-panel__reading {
    color: var(--lb-text-faint);
    font-family: monospace;
    font-size: var(--lb-text-xs);
    margin-top: 0.15rem;
    overflow-wrap: anywhere;
    text-align: left;
  }

  hr {
    margin: var(--lb-space-2) 0;
  }
</style>
