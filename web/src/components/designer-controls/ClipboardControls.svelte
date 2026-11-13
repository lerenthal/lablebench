<script lang="ts">
  /**
   * Copy and paste for the selected object.
   *
   * Two things can be copied: the object itself, and the text it carries.
   * They are kept apart because they are wanted in different places — a
   * duplicated shape is a new shape, while copied text is meant to go into
   * a shape that already exists.
   */
  import * as fabric from "fabric";
  import { tr } from "$/utils/i18n";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { Toasts } from "$/utils/toasts";
  import {
    clipboardKind,
    copyObject,
    copyObjectText,
    pasteObject,
    pasteText,
  } from "$/utils/clipboard";

  interface Props {
    selectedObject: fabric.FabricObject | undefined;
    /** Called after the canvas changed, so the designer can record it. */
    valueUpdated: () => void;
    /** The canvas to paste onto. Falls back to the selected object's canvas. */
    canvas?: fabric.Canvas;
    /** Changes whenever the designer changes something. */
    editRevision?: number;
  }

  let { selectedObject, valueUpdated, canvas, editRevision = 0 }: Props = $props();

  /**
   * The clipboard lives outside the component, so what is on it is not
   * something Svelte can watch. This counter stands in for it: it is bumped
   * whenever the clipboard may have changed.
   */
  let clipboardRevision = $state(0);

  /** The canvas the paste goes onto. */
  const targetCanvas = (): fabric.Canvas | undefined => canvas ?? selectedObject?.canvas;

  const canPaste = $derived.by(() => {
    void clipboardRevision;
    void editRevision;

    return clipboardKind() === "object" && targetCanvas() !== undefined;
  });

  const canPasteText = $derived.by(() => {
    void clipboardRevision;
    void editRevision;

    return clipboardKind() === "text" && selectedObject !== undefined;
  });

  const copy = () => {
    if (!copyObject(selectedObject)) {
      Toasts.message($tr("object.nothing_to_copy"));
      return;
    }

    clipboardRevision++;
    Toasts.message($tr("object.copied"));
  };

  const copyText = () => {
    if (!copyObjectText(selectedObject)) {
      Toasts.message($tr("object.nothing_to_copy"));
      return;
    }

    clipboardRevision++;
    Toasts.message($tr("object.text_copied"));
  };

  const paste = () => {
    const target = targetCanvas();

    if (target === undefined || pasteObject(target) === undefined) {
      Toasts.message($tr("object.nothing_to_paste"));
      return;
    }

    clipboardRevision++;
    valueUpdated();
  };

  const pasteTextInto = async () => {
    if (selectedObject === undefined || !(await pasteText(selectedObject))) {
      Toasts.message($tr("object.cannot_paste_text"));
      return;
    }

    clipboardRevision++;
    valueUpdated();
  };
</script>

<div class="btn-group btn-group-sm">
  <button
    class="btn btn-secondary"
    type="button"
    disabled={selectedObject === undefined}
    onclick={copy}
    title={$tr("object.copy")}>
    <MdIcon icon="content_copy" />
  </button>
  <button
    class="btn btn-secondary"
    type="button"
    disabled={!canPaste}
    onclick={paste}
    title={$tr("object.paste")}>
    <MdIcon icon="content_paste" />
  </button>
  <button
    class="btn btn-secondary"
    type="button"
    disabled={selectedObject === undefined}
    onclick={copyText}
    title={$tr("object.copy_text")}>
    <MdIcon icon="text_fields" />
  </button>
  <button
    class="btn btn-secondary"
    type="button"
    disabled={!canPasteText}
    onclick={pasteTextInto}
    title={$tr("object.paste_text")}>
    <MdIcon icon="text_snippet" />
  </button>
</div>
