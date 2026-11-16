<script lang="ts">
  /**
   * Link a barcode or a QR code to another object on the label.
   *
   * A barcode encodes a fixed string, so a barcode that has to carry a
   * serial number is normally typed by hand and is then wrong on every
   * label but the first. Linking it to an object — a serial number, a date,
   * or a plain text box — means the bars are encoded from whatever that
   * object holds at the moment the label is printed.
   */
  import type * as fabric from "fabric";
  import { tr } from "$/utils/i18n";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import {
    findById,
    linkObject,
    linkSources,
    unlinkObject,
  } from "$/utils/linked_objects";
  import type { Barcode } from "$/fabric-object/barcode";
  import type { QRCode } from "$/fabric-object/qrcode";

  interface Props {
    target: Barcode | QRCode;
    /**
     * Bumped by the designer whenever the canvas changed. It is read here so
     * that the control re-reads the object's own properties: they live on a
     * plain object rather than in reactive state, so nothing else would tell
     * the control that the link had changed.
     */
    editRevision: number;
    /** Called after the canvas changed, so the designer can record it. */
    valueUpdated: () => void;
  }

  let { target, editRevision, valueUpdated }: Props = $props();

  const canvas = $derived(target.canvas as fabric.Canvas | undefined);

  const sources = $derived.by(() => {
    // Read so this list is rebuilt after every canvas edit. The value is
    // the subscription; it is the read that matters, not the number.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    editRevision;

    return canvas === undefined ? [] : linkSources(canvas);
  });

  const onLinkChanged = (id: string) => {
    if (id === "") {
      unlinkObject(target);
      valueUpdated();
      return;
    }

    const source = findById(canvas!, id);

    if (source !== undefined) {
      linkObject(target, source);
      valueUpdated();
    }
  };
</script>

<input type="hidden" value={editRevision} />

<div class="input-group input-group-sm flex-nowrap">
  <span class="input-group-text" title={$tr("params.link.label")}>
    <MdIcon icon="link" />
  </span>
  <select
    class="form-select"
    value={target.linkedObjectId ?? ""}
    onchange={(e) => onLinkChanged(e.currentTarget.value)}>
    <option value="">{$tr("params.link.none")}</option>
    {#each sources as source (source.obj.objectId)}
      <option value={source.obj.objectId ?? ""}>{source.label}</option>
    {/each}
  </select>
</div>

{#if target.linkedObjectId !== undefined}
  <div class="link-hint">{$tr("params.link.hint")}</div>
{/if}

<style>
  .input-group {
    width: fit-content;
  }

  .link-hint {
    color: var(--muted-foreground);
    font-size: 0.8rem;
    line-height: 1.3;
  }
</style>
