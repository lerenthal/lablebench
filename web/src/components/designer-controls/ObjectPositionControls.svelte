<script lang="ts">
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { tr } from "$/utils/i18n";
  import * as fabric from "fabric";
  import { onDestroy, untrack } from "svelte";
  import QRCode from "$/fabric-object/qrcode";
  import Barcode from "$/fabric-object/barcode";

  interface Props {
    selectedObject: fabric.FabricObject;
    /** Changes whenever something edits the object from outside (center buttons, arrow keys, ...) */
    editRevision?: number;
    /**
     * Printer dots per millimetre, from the label the object sits on.
     *
     * The boxes below are in millimetres and the canvas is in dots, so the
     * conversion needs the resolution the label was measured at. It travels
     * with the label rather than being assumed, because a template made at
     * 300 dpi is not 8 dots to the millimetre.
     */
    dpmm?: number;
  }

  let { selectedObject, editRevision, dpmm = 8 }: Props = $props();

  /**
   * The boxes are millimetres; the object is dots.
   *
   * A thermal head prints dots and nothing finer, so every figure typed here
   * snaps to one: at 8 dots/mm that is 0.125 mm, and a value between dots is
   * rounded to the nearest. Showing one decimal rather than three is
   * deliberate - it is the precision the hardware actually has.
   */
  const toMm = (dots: number): number => Math.round((dots / dpmm) * 10) / 10;
  const toDots = (mm: number): number => Math.round(mm * dpmm);
  let prevObject: fabric.FabricObject | undefined;
  let prevCanvas: fabric.Canvas | undefined;

  let x = $state<number>();
  let y = $state<number>();
  let width = $state<number>();
  let height = $state<number>();
  let widthScaled = $state<number>();
  let heightScaled = $state<number>();
  let keepAspectRatio = $state<boolean>(false);

  // Images and circles are resized through scaleX/scaleY, not through width/height
  // (a circle is drawn from its radius, so changing width/height only grows its selection box).
  const usesScaledSize = $derived(
    selectedObject instanceof fabric.FabricImage || selectedObject instanceof fabric.Circle,
  );

  const objectDimensionsChanged = (e?: fabric.ModifiedEvent) => {
    const pos = selectedObject.getPointByOrigin("left", "top");
    x = toMm(pos.x);
    y = toMm(pos.y);
    width = toMm(selectedObject.width);
    height = toMm(selectedObject.height);

    updateScales(e?.action);
  };

  /** Re-read the values from the object without touching the aspect ratio toggle */
  const syncFromObject = () => {
    const pos = selectedObject.getPointByOrigin("left", "top");
    x = toMm(pos.x);
    y = toMm(pos.y);
    width = toMm(selectedObject.width);
    height = toMm(selectedObject.height);
    widthScaled = toMm(selectedObject.width * selectedObject.scaleX);
    heightScaled = toMm(selectedObject.height * selectedObject.scaleY);
  };

  /** Show the position live while the object is dragged (runs after the snapping handler) */
  const canvasObjectMoving = (e: { target: fabric.FabricObject }) => {
    if (e.target !== selectedObject) return;
    const pos = selectedObject.getPointByOrigin("left", "top");
    x = toMm(pos.x);
    y = toMm(pos.y);
  };

  const objectChanged = (newObject: fabric.FabricObject) => {
    if (prevObject !== undefined) {
      prevObject.off("modified", objectDimensionsChanged);
    }
    prevCanvas?.off("object:moving", canvasObjectMoving);

    newObject.on("modified", objectDimensionsChanged);
    prevCanvas = newObject.canvas;
    prevCanvas?.on("object:moving", canvasObjectMoving);
    objectDimensionsChanged();

    prevObject = newObject;
  };

  const updateObject = (e: Event, source?: "width" | "height") => {
    // Inputs are applied live (oninput): skip transient empty/invalid values while typing.
    if (![x, y, width, height, widthScaled, heightScaled].every(Number.isFinite)) return;

    const newPos = new fabric.Point(toDots(x!), toDots(y!));

    selectedObject.setPositionByOrigin(newPos, "left", "top");

    if (usesScaledSize) {
      if (keepAspectRatio) {
        const target = source === "width" ? toDots(widthScaled!) : toDots(heightScaled!);
        const base = source === "width" ? selectedObject.width! : selectedObject.height!;
        const scale = target / base;

        selectedObject.scaleX = scale;
        selectedObject.scaleY = scale;
      } else {
        selectedObject.scaleX = toDots(widthScaled!) / selectedObject.width!;
        selectedObject.scaleY = toDots(heightScaled!) / selectedObject.height!;
      }

      updateScales();
    } else
      selectedObject.set({
        // One dot is the smallest thing the head can print, so that is the
        // floor rather than one millimetre.
        width: Math.max(toDots(width!), 1),
        height: Math.max(toDots(height!), 1),
      });

    selectedObject.setCoords();
    selectedObject.canvas?.requestRenderAll();
  };

  const toggleAspectRatio = (e: Event) => {
    if (keepAspectRatio) {
      selectedObject.scaleX = Math.min(selectedObject.scaleX, selectedObject.scaleY);
      selectedObject.scaleY = selectedObject.scaleX;
      updateScales();

      updateObject(e);
    }
  };

  const updateScales = (action?: string) => {
    widthScaled = toMm(selectedObject.width * selectedObject.scaleX);
    heightScaled = toMm(selectedObject.height * selectedObject.scaleY);

    if (action === "scaleX" || action === "scaleY") keepAspectRatio = false;
    if ((action === "scale" || action === undefined) && selectedObject.scaleX === selectedObject.scaleY)
      keepAspectRatio = true;
  };

  onDestroy(() => {
    // Deselecting unmounts this panel, and by the time the teardown runs the
    // prop can already be gone - which threw on every deselect. The listener
    // was attached to `prevObject`, so that is the one to detach it from.
    prevObject?.off("modified", objectDimensionsChanged);
    prevCanvas?.off("object:moving", canvasObjectMoving);
  });

  // The object was changed from outside (center buttons, arrow keys, ...): refresh the inputs.
  $effect(() => {
    void editRevision;
    untrack(() => syncFromObject());
  });

  $effect(() => {
    const obj = selectedObject;
    // Only re-sync when the selected object changes. Without untrack the effect also tracks
    // width/height (read in updateScales) and resets the inputs on every keystroke.
    untrack(() => objectChanged(obj));
  });
</script>

<div class="dropdown">
  <button
    class="btn btn-sm btn-secondary dropdown-toggle"
    type="button"
    data-bs-toggle="dropdown"
    title={$tr("params.generic.position")}>
    <MdIcon icon="control_camera" />
  </button>
  <div class="dropdown-menu arrangement p-2">
    <div class="input-group flex-nowrap input-group-sm mb-2">
      <span class="input-group-text">x</span>
      <input class="form-control" type="number" step="0.1" bind:value={x} oninput={updateObject} />
      <span class="input-group-text">mm</span>
    </div>
    <div class="input-group flex-nowrap input-group-sm mb-2">
      <span class="input-group-text">y</span>
      <input class="form-control" type="number" step="0.1" bind:value={y} oninput={updateObject} />
      <span class="input-group-text">mm</span>
    </div>
    {#if !(selectedObject instanceof fabric.FabricText || usesScaledSize || selectedObject instanceof QRCode || selectedObject instanceof Barcode)}
      <div class="input-group flex-nowrap input-group-sm mb-2">
        <input class="form-control" type="number" min="0.1" step="0.1" bind:value={width} oninput={updateObject} />
        <span class="input-group-text">x</span>
        <input class="form-control" type="number" min="0.1" step="0.1" bind:value={height} oninput={updateObject} />
        <span class="input-group-text">mm</span>
      </div>
    {/if}
    {#if usesScaledSize}
      <div class="input-group flex-nowrap input-group-sm mb-2">
        <input
          class="form-control"
          type="number"
          min="0.1"
          step="0.1"
          bind:value={widthScaled}
          oninput={(e) => updateObject(e, "width")} />
        <span class="input-group-text">x</span>
        <input
          class="form-control"
          type="number"
          min="0.1"
          step="0.1"
          bind:value={heightScaled}
          oninput={(e) => updateObject(e, "height")} />
        <span class="input-group-text">mm</span>
      </div>
      <div class="form-check form-switch">
        <input
          class="form-check-input"
          type="checkbox"
          role="switch"
          id="keepImageAspectRatio"
          bind:checked={keepAspectRatio}
          onchange={toggleAspectRatio} />
        <label class="form-check-label" for="keepImageAspectRatio" style="text-wrap: nowrap">
          {$tr("params.generic.keepAspectRatio")}</label>
      </div>
    {/if}
  </div>
</div>
