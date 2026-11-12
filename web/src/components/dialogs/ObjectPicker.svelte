<script lang="ts">
  import { type LabelProps, type OjectType } from "$/types";
  import { tr } from "$/utils/i18n";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import ZplImportButton from "$/components/designer-controls/ZplImportButton.svelte";
  import PdfImportButton from "$/components/designer-controls/PdfImportButton.svelte";
  import AppModal from "$/components/basic/AppModal.svelte";

  interface Props {
    onSubmit: (i: OjectType) => void;
    labelProps: LabelProps;
    zplImageReady: (img: Blob) => void;
    pdfImageReady: (img: HTMLCanvasElement) => void;
    onClose?: () => void;
  }

  let { onSubmit, labelProps, zplImageReady, pdfImageReady, onClose }: Props = $props();
  let modalRef: AppModal;

  const onClick = (i: OjectType) => {
    modalRef.hide();
    onSubmit(i);
  };

  const zplReady = (img: Blob) => {
    modalRef.hide();
    zplImageReady(img);
  };

  const pdfReady = (img: HTMLCanvasElement) => {
    modalRef.hide();
    pdfImageReady(img);
  };
</script>

<AppModal title={$tr("editor.objectpicker.title")} {onClose} bind:this={modalRef} size="lg">
  <!--
    These were plain buttons, which in Bootstrap 4 means no surface, no border
    and ordinary-weight text: the list read as a row of faint words rather
    than as a set of things you can add. They are tiles now, each one
    plainly visible, and the one under the pointer goes bold.
  -->
  <div class="object-grid">
    <button class="object-tile" onclick={() => onClick("text")}>
      <MdIcon icon="title" />
      <span>{$tr("editor.objectpicker.text")}</span>
    </button>
    <button class="object-tile" onclick={() => onClick("line")}>
      <MdIcon icon="remove" />
      <span>{$tr("editor.objectpicker.line")}</span>
    </button>
    <button class="object-tile" onclick={() => onClick("rectangle")}>
      <MdIcon icon="crop_square" />
      <span>{$tr("editor.objectpicker.rectangle")}</span>
    </button>
    <button class="object-tile" onclick={() => onClick("circle")}>
      <MdIcon icon="radio_button_unchecked" />
      <span>{$tr("editor.objectpicker.circle")}</span>
    </button>

    <button class="object-tile" onclick={() => onClick("image")}>
      <MdIcon icon="image" />
      <span>{$tr("editor.objectpicker.image")}</span>
    </button>
    <button class="object-tile" onclick={() => onClick("qrcode")}>
      <MdIcon icon="qr_code_2" />
      <span>{$tr("editor.objectpicker.qrcode")}</span>
    </button>
    <button class="object-tile" onclick={() => onClick("aruco")}>
      <MdIcon icon="grid_on" />
      <span>{$tr("editor.objectpicker.aruco")}</span>
    </button>
    <button class="object-tile" onclick={() => onClick("barcode")}>
      <MdIcon icon="view_week" />
      <span>{$tr("editor.objectpicker.barcode")}</span>
    </button>

    <button class="object-tile" onclick={() => onClick("datetime")}>
      <MdIcon icon="schedule" />
      <span>{$tr("editor.objectpicker.datetime")}</span>
    </button>
    <button class="object-tile" onclick={() => onClick("serial")}>
      <MdIcon icon="pin" />
      <span>{$tr("editor.objectpicker.serial")}</span>
    </button>
  </div>

  <div class="d-flex gap-2 mt-3">
    <ZplImportButton {labelProps} onImageReady={zplReady} />
    <PdfImportButton {labelProps} onImageReady={pdfReady} />
  </div>
</AppModal>

<style>
  .object-grid {
    display: grid;
    gap: var(--lb-space-2);
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
  }

  .object-tile {
    align-items: center;
    background: var(--lb-surface-raised);
    border: 1px solid var(--lb-border);
    border-radius: var(--lb-radius);
    color: var(--lb-text);
    display: flex;
    font-size: var(--lb-text-base);
    font-weight: 500;
    gap: var(--lb-space-3);
    padding: var(--lb-space-3) var(--lb-space-4);
    text-align: left;
    transition: background-color 0.14s ease, border-color 0.14s ease, color 0.14s ease;
  }

  .object-tile :global(.mdi) {
    color: var(--lb-text-muted);
    font-size: 1.15rem;
  }

  /* The chosen one is marked by weight and by the accent, not by a lighter
     font that reads as "not there". */
  .object-tile:hover,
  .object-tile:focus-visible {
    background: var(--lb-surface-hover);
    border-color: var(--lb-accent);
    color: var(--lb-accent);
    font-weight: 700;
    outline: none;
  }

  .object-tile:hover :global(.mdi),
  .object-tile:focus-visible :global(.mdi) {
    color: var(--lb-accent);
  }

  .object-tile:focus-visible {
    box-shadow: var(--lb-ring);
  }
</style>
