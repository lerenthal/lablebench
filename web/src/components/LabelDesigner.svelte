<script lang="ts">
  import Dropdown from "bootstrap/js/dist/dropdown";
  import * as fabric from "fabric";
  import { DEFAULT_DPMM } from "$/services/template_store";
  import { onDestroy, onMount, tick } from "svelte";
  import { ArUcoMarker } from "$/fabric-object/aruco";
  import { Barcode } from "$/fabric-object/barcode";
  import { QRCode } from "$/fabric-object/qrcode";
  import { iconCodepoints, type MaterialIcon } from "$/styles/mdi_icons";
  import {
    appConfig,
    automation,
    connectionState,
    csvData,
    dimensionsUpdateRequest,
    loadedFonts,
    printerProfile,
  } from "$/stores/app";
  import {
    type ExportedLabelTemplate,
    type FabricJson,
    type LabelProps,
    type MoveDirection,
    type OjectType,
    type TemplateModel,
    type TemplateVariables,
  } from "$/types";
  import { FileUtils } from "$/utils/file_utils";
  import { turnContent } from "$/utils/label_fit";
  import { tr } from "$/utils/i18n";
  import { LabelDesignerObjectHelper } from "$/utils/label_designer_object_helper";
  import { LocalStoragePersistence } from "$/utils/persistence";
  import { Toasts } from "$/utils/toasts";
  import { UndoRedo, type UndoState } from "$/utils/undo_redo";
  import BarcodeParamsPanel from "$/components/designer-controls/BarcodeParamsControls.svelte";
  import CsvControl from "$/components/dialogs/CsvControl.svelte";
  import ClipboardControls from "$/components/designer-controls/ClipboardControls.svelte";
  import GenericObjectParamsControls from "$/components/designer-controls/GenericObjectParamsControls.svelte";
  import IconPicker from "$/components/dialogs/IconPicker.svelte";
  import LabelPropsEditor from "$/components/dialogs/LabelPropsEditor.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import ObjectPicker from "$/components/dialogs/ObjectPicker.svelte";
  import PrintPreview from "$/components/dialogs/PrintPreview.svelte";
  import QuickPrintGallery from "$/components/dialogs/QuickPrintGallery.svelte";
  import ArUcoParamsPanel from "$/components/designer-controls/ArUcoParamsControls.svelte";
  import QrCodeParamsPanel from "$/components/designer-controls/QRCodeParamsControls.svelte";
  import TextParamsControls from "$/components/designer-controls/TextParamsControls.svelte";
  import VariableInsertControl from "$/components/designer-controls/VariableInsertControl.svelte";
  import DynamicValueControls from "$/components/designer-controls/DynamicValueControls.svelte";
  import {
    counterNameFor,
    formatSerialValue,
    previewSerialValue,
    resolveDynamicObjects,
  } from "$/utils/dynamic_values";
  import { ensureObjectId, syncLinkedObjects } from "$/utils/linked_objects";
  import { clipboardKind, copyObject, copyObjectText, pasteObject, pasteText } from "$/utils/clipboard";
  import { api } from "$/services/api";
  import type { SerialConfig } from "$/types";
  import { DEFAULT_LABEL_PROPS, GRID_SIZE, OBJECT_DEFAULTS } from "$/defaults";
  import { LabelDesignerUtils } from "$/utils/label_designer_utils";
  import SavedLabelsMenu from "$/components/dialogs/SavedLabelsMenu.svelte";
  import { CustomCanvas } from "$/fabric-object/custom_canvas";
  import VectorParamsControls from "$/components/designer-controls/VectorParamsControls.svelte";
  import { CanvasUtils } from "$/utils/canvas_utils";
  import { appConfirm } from "$/stores/confirm";
  import { templateStore } from "$/services/template_store";
  import { DefaultTemplate } from "$/services/default_template";
  import { extractVariablesFromJson } from "$/utils/canvas_preprocess";
  import CsvBatchControl from "$/components/dialogs/CsvBatchControl.svelte";
  import { runPreflight, type PreflightFinding } from "$/utils/preflight";
  import { adaptContentToLabel, fitObjectsInsideLabel } from "$/utils/label_fit";
  import PreflightPanel from "$/components/dialogs/PreflightPanel.svelte";
  import AppModal from "$/components/basic/AppModal.svelte";

  type DialogName =
    | "none"
    | "preview"
    | "label_props"
    | "saved_labels"
    | "csv_props"
    | "csv_batch"
    | "quick_print"
    | "icon_picker"
    | "object_picker"
    | "preflight";

  let htmlCanvas: HTMLCanvasElement;
  let currentDialog = $state<DialogName>("none");

  // --- LabelBench template state -------------------------------------------------
  /** Server id of the template currently open, or undefined for a new one. */
  let templateId = $state<string | undefined>(undefined);
  /** Target printer model for this template. */
  let templateModel = $state<TemplateModel>("d11");
  /** Declared merge variables and their persisted CSV column bindings. */
  let templateVariables = $state<TemplateVariables>({ variables: [], csv_mapping: {} });
  /** Tags for light organisation. */
  let templateTags = $state<string[]>([]);

  let fabricCanvas = $state<CustomCanvas>();
  let labelProps = $state<LabelProps>(DEFAULT_LABEL_PROPS);
  let selectedObject = $state<fabric.FabricObject | undefined>(undefined);
  let selectedCount = $state<number>(0);
  let editRevision = $state<number>(0);
  let csvEnabled = $state<boolean>(false);
  /** What the next printed label would show for the serial variable. */
  let serialNextValue = $state<string | undefined>(undefined);
  let windowWidth = $state<number>(0);
  let undoState = $state<UndoState>({ undoDisabled: false, redoDisabled: false });
  let zoomText = $state<string>("100%");
  let hasUnsavedChanges = $state<boolean>(false);
  /** What the last preflight check found. */
  let preflightFindings = $state<PreflightFinding[]>([]);

  const undo = new UndoRedo();

  const discardSelection = () => {
    fabricCanvas!.discardActiveObject();
    fabricCanvas!.requestRenderAll();
    selectedObject = undefined;
    selectedCount = 0;
    editRevision = 0;
  };

  const loadLabelData = async (data: ExportedLabelTemplate) => {
    undo.paused = true;
    // The label's size is in pixels, so it has to arrive with the resolution
    // it was measured at. Older templates were made at 300 dpi, when the app
    // also drove a DYMO; the resolution is carried alongside the size so the
    // two can never drift apart.
    onUpdateLabelProps({ ...data.label, dpmm: data.dpmm ?? data.label.dpmm ?? DEFAULT_DPMM });
    if (data.csv) {
      $csvData = data.csv;
      csvEnabled = true;
    }
    await FileUtils.loadCanvasState(fabricCanvas!, data.canvas);
    undo.paused = false;
  };

  undo.onLabelUpdate = async (data) => {
    await loadLabelData(data);
    hasUnsavedChanges = true;
  };

  undo.onStateUpdate = (state: UndoState) => {
    undoState = state;
  };

  const deleteSelected = () => {
    LabelDesignerUtils.deleteSelection(fabricCanvas!);
    discardSelection();
  };

  const cloneSelected = () => {
    LabelDesignerUtils.cloneSelection(fabricCanvas!).then(() => undo.push(fabricCanvas!, labelProps));
  };

  const moveSelected = (direction: MoveDirection, ctrl?: boolean) => {
    LabelDesignerUtils.moveSelection(fabricCanvas!, direction, ctrl);
    undo.push(fabricCanvas!, labelProps);
    // refresh the position inputs
    editRevision++;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const key: string = e.key.toLowerCase();
    // windows and linux users are used to ctrl, mac users use cmd
    const cmdOrCtrl = e.metaKey || e.ctrlKey;

    // Esc
    if (key === "escape") {
      discardSelection();
      return;
    }

    // Ctrl + C, Ctrl + Shift + C
    //
    // Two things can be copied: the object, and the text it carries. They
    // are wanted in different places — a duplicated shape is a new shape,
    // while copied text is meant to go into a shape that already exists —
    // so Shift tells them apart.
    //
    // This is handled before the canvas's own focus check, because a text
    // object being edited holds a hidden field and the copy of the *object*
    // is still what the user means. The browser's own copy is left alone in
    // the properties panel, where the user is typing into a field.
    if (cmdOrCtrl && key === "c") {
      const field = e.target as HTMLElement | null;
      const inField =
        field !== null &&
        (field.tagName === "INPUT" ||
          field.tagName === "TEXTAREA" ||
          field.isContentEditable);

      if (!inField) {
        if (e.shiftKey) {
          if (copyObjectText(selectedObject)) {
            e.preventDefault();
            Toasts.message($tr("object.text_copied"));

            // The clipboard lives outside the properties panel, so the panel
            // has to be told that it changed — otherwise its Paste button
            // stays greyed out until something else refreshes it.
            editRevision++;
          }
          return;
        }

        if (copyObject(selectedObject)) {
          e.preventDefault();
          Toasts.message($tr("object.copied"));
          editRevision++;
        }
        return;
      }
    }

    if (LabelDesignerUtils.isAnyInputFocused(fabricCanvas!)) {
      return;
    }

    // Arrows
    if (key.startsWith("arrow")) {
      moveSelected(key.slice("arrow".length) as MoveDirection, cmdOrCtrl);
      return;
    }

    if (e.repeat) {
      return;
    }

    // Ctrl + D
    if (cmdOrCtrl && key === "d") {
      e.preventDefault();
      cloneSelected();
      return;
    }

    // Ctrl + Y, Ctrl + Shift + Z
    if ((cmdOrCtrl && key === "y") || (cmdOrCtrl && e.shiftKey && key === "z")) {
      e.preventDefault();
      if (!undoState.redoDisabled) {
        undo.redo();
      }
      return;
    }

    // Ctrl + Z
    if (cmdOrCtrl && key === "z") {
      e.preventDefault();
      if (!undoState.undoDisabled) {
        undo.undo();
      }
      return;
    }

    // Del
    if (key === "delete" || key === "backspace") {
      deleteSelected();
      return;
    }
  };

  const onUpdateLabelProps = (newProps: LabelProps) => {
    const oldSize = labelProps.size;
    const sizeChanged =
      oldSize.width !== newProps.size.width || oldSize.height !== newProps.size.height;

    labelProps = newProps;
    hasUnsavedChanges = true;
    fabricCanvas!.setDimensions(labelProps.size);
    fabricCanvas!.virtualZoom(fabricCanvas!.getVirtualZoom());

    // The canvas has a new size, so the design on it is scaled to fit the
    // new label and centred on it. A label that was turned takes its
    // content with it.
    if (sizeChanged && oldSize.width > 0 && oldSize.height > 0) {
      adaptContentToLabel(fabricCanvas!.getObjects(), oldSize, newProps.size);
      fabricCanvas!.requestRenderAll();
      editRevision++;
    }
    try {
      LocalStoragePersistence.saveLastLabelProps(labelProps);
      undo.push(fabricCanvas!, labelProps);
    } catch (e) {
      Toasts.zodErrors(e, "Label parameters save error:");
    }
  };

  const updateDimensions = (width: number, height: number) => {
    let newProps = { ...labelProps, size: { width, height } };
    onUpdateLabelProps(newProps);
  };

  const exportCurrentLabel = (): ExportedLabelTemplate => {
    const label = FileUtils.makeExportedLabel(fabricCanvas!, labelProps, csvEnabled);

    // Carry the LabelBench fields: the target printer model, the declared
    // variables and their CSV bindings, and the tags.
    label.dpmm = labelProps.dpmm;
    label.model = templateModel;
    label.variables = templateVariables;
    label.tags = templateTags;
    label.id = templateId;

    return label;
  };

  const onLoadRequested = async (label: ExportedLabelTemplate) => {
    templateId = label.id;
    templateModel = label.model ?? "d11";
    templateVariables = label.variables ?? { variables: [], csv_mapping: {} };
    templateTags = label.tags ?? [];

    await loadLabelData(label);

    undo.push(fabricCanvas!, labelProps);
    hasUnsavedChanges = false;

    // The loaded template may carry Date & time and Serial number objects;
    // show them what they would print right now.
    void refreshDynamicValues();
  };

  /**
   * Quick print (§5.5): load a template from the server and print it.
   *
   * The template is fetched from the central store, so the gallery is the
   * same on every workstation — nothing is copied between them.
   */
  const onQuickPrint = async (id: string) => {
    try {
      const label = await templateStore.load(id);
      await onLoadRequested(label);
      currentDialog = "preview";
    } catch (e) {
      Toasts.error(e);
    }
  };

  /** A template that needs data: load it and open the CSV batch dialog. */
  const onQuickBatch = async (id: string) => {
    try {
      const label = await templateStore.load(id);
      await onLoadRequested(label);
      refreshDeclaredVariables();
      currentDialog = "csv_batch";
    } catch (e) {
      Toasts.error(e);
    }
  };

  /**
   * The variables a template declares are derived from the `{placeholder}`
   * tokens in its objects, plus anything already recorded.
   */
  const refreshDeclaredVariables = () => {
    const found = extractVariablesFromJson(
      getCanvasForPreview() as { objects?: Array<{ text?: string; dynamicToken?: string }> },
      templateVariables.serial?.variable,
    );
    const known = new Map(templateVariables.variables.map((v) => [v.name, v]));

    for (const name of found) {
      if (!known.has(name)) {
        known.set(name, { name, type: "text", required: false });
      }
    }

    templateVariables = { ...templateVariables, variables: [...known.values()] };
  };

  /**
   * The template's serial sequence, created on demand.
   *
   * The serial number comes from a central counter, so the sequence belongs to
   * the template rather than to the object: every workstation that prints this
   * template continues the same run of numbers.
   */
  const ensureSerialConfig = (): SerialConfig => {
    const existing = templateVariables.serial;

    if (existing !== undefined) {
      return existing;
    }

    const config: SerialConfig = {
      variable: "serial",
      counter: "",
      prefix: "",
      suffix: "",
      start: 1,
      step: 1,
      pad: 4,
    };

    templateVariables = { ...templateVariables, serial: config };
    hasUnsavedChanges = true;

    return config;
  };

  /**
   * Show the dynamic objects what they would print right now.
   *
   * The serial number is read from the central counter *without* consuming a
   * number — a preview must not eat a value — so what is shown is the number
   * the next print would use.
   */
  const refreshDynamicValues = async () => {
    const config = templateVariables.serial;

    if (config === undefined) {
      resolveDynamicObjects(fabricCanvas!, undefined, {});
      syncLinkedObjects(fabricCanvas!);
      fabricCanvas?.requestRenderAll();
      return;
    }

    let next: string | undefined;

    try {
      const counters = await api.listSerialCounters();
      const counter = counters.find((c) => c.name === counterNameFor(config));

      next =
        counter === undefined
          ? formatSerialValue(config.start, config)
          : previewSerialValue(counter.value, config);
    } catch {
      next = undefined;
    }

    serialNextValue = next;

    resolveDynamicObjects(
      fabricCanvas!,
      config.variable,
      next === undefined ? {} : { [config.variable]: next },
    );

    // A barcode that follows the serial number object has to be re-encoded
    // from the number the counter just handed out, or it would still show
    // the previous one.
    syncLinkedObjects(fabricCanvas!);
    fabricCanvas?.requestRenderAll();
  };

  const onSerialConfigChanged = (config: SerialConfig | undefined) => {
    templateVariables = { ...templateVariables, serial: config };
    hasUnsavedChanges = true;
    void refreshDynamicValues();
  };

  const onTemplateVariablesChanged = (variables: TemplateVariables) => {
    templateVariables = variables;
    hasUnsavedChanges = true;
  };

  /**
   * Point the design at a printer.
   *
   * The two printer families take the label differently: one feeds it the
   * long way round, the other the short way. A design drawn for one is the
   * other turned a quarter, so moving a design between them turns the
   * content and transposes the canvas — which leaves the printed label
   * exactly as it was and the design drawn in the new printer's own
   * convention.
   */
  const adoptPrinter = (model: TemplateModel, direction: "left" | "top") => {
    if (labelProps.printDirection !== direction) {
      const size = turnContent(fabricCanvas!.getObjects(), labelProps.size);

      labelProps = { ...labelProps, printDirection: direction, size };
      fabricCanvas!.setDimensions(labelProps.size);
      fabricCanvas!.requestRenderAll();
      editRevision++;
    }

    if (templateModel !== model) {
      templateModel = model;
      hasUnsavedChanges = true;
    }
  };

  const onModelChanged = (model: TemplateModel) => {
    templateModel = model;
    hasUnsavedChanges = true;
  };

  const onSave = () => {
    hasUnsavedChanges = false;
  };

  const zplImageReady = async (img: Blob) => {
    await LabelDesignerObjectHelper.addImageBlob(fabricCanvas!, img);
    undo.push(fabricCanvas!, labelProps);
  };

  const pdfImageReady = async (el: HTMLCanvasElement) => {
    const img = new fabric.FabricImage(el, {
      ...OBJECT_DEFAULTS,
      left: 0,
      top: 0,
    });

    fabricCanvas!.add(img);
    fabricCanvas!.setActiveObject(img);
    undo.push(fabricCanvas!, labelProps);
  };

  const onObjectPicked = (objectType: OjectType) => {
    // A Serial number object needs a sequence to draw from. If the template
    // has none yet, give it a default one rather than dropping an object that
    // could never resolve.
    let options: { dateTimeFormat?: string; serialVariable?: string } | undefined;

    if (objectType === "serial") {
      options = { serialVariable: ensureSerialConfig().variable };
    }

    const obj = LabelDesignerObjectHelper.addObject(fabricCanvas!, objectType, options);
    if (obj !== undefined) {
      fabricCanvas!.setActiveObject(obj);
      undo.push(fabricCanvas!, labelProps);
      void refreshDynamicValues();
    }
  };

  const onIconPicked = (i: MaterialIcon) => {
    // todo: icon is not vertically centered
    LabelDesignerObjectHelper.addStaticText(fabricCanvas!, String.fromCodePoint(iconCodepoints[i]), {
      fontFamily: "Material Icons",
      fontSize: 100,
    });
    undo.push(fabricCanvas!, labelProps);
  };

  const onSvgIconPicked = (i: string) => {
    LabelDesignerObjectHelper.addSvg(fabricCanvas!, i);
    undo.push(fabricCanvas!, labelProps);
  };

  const openPreview = () => {
    currentDialog = "preview";
  };



  const controlValueUpdated = () => {
    if (selectedObject) {
      selectedObject.setCoords();
      selectedObject.dirty = true;
      undo.push(fabricCanvas!, labelProps);
    }
    fabricCanvas!.requestRenderAll();

    // trigger reactivity for controls
    editRevision++;
  };

  const getCanvasForPreview = (): FabricJson => {
    return fabricCanvas!.toJSON();
  };

  const onCsvPlaceholderPicked = (name: string) => {
    const obj = LabelDesignerObjectHelper.addText(fabricCanvas!, `{${name}}`, {
      textAlign: "left",
      originX: "left",
      originY: "top",
    });
    fabricCanvas!.setActiveObject(obj);
    undo.push(fabricCanvas!, labelProps);
  };

  const onPaste = async (event: ClipboardEvent) => {
    if (LabelDesignerUtils.isAnyInputFocused(fabricCanvas!)) {
      return;
    }

    const openedDropdowns = document.querySelectorAll(".dropdown-menu.show");
    if (openedDropdowns.length > 0) {
      return;
    }

    // The app's own clipboard comes first: an object copied here is what the
    // user means to paste, even when the system clipboard happens to hold an
    // image.
    const held = clipboardKind();

    if (held === "object") {
      event.preventDefault();

      if (pasteObject(fabricCanvas!) !== undefined) {
        controlValueUpdated();
      }

      return;
    }

    if (held === "text" && selectedObject !== undefined) {
      event.preventDefault();

      if (await pasteText(selectedObject)) {
        controlValueUpdated();
      }

      return;
    }

    if (event.clipboardData != null) {
      event.preventDefault();
      const obj = await LabelDesignerObjectHelper.addObjectFromClipboard(fabricCanvas!, event.clipboardData);

      if (obj !== undefined) {
        fabricCanvas!.setActiveObject(obj);
        undo.push(fabricCanvas!, labelProps);
      }
    }
  };

  const clearCanvas = async () => {
    const result = await appConfirm({
      title: $tr("editor.clear.confirm"),
      buttons: ["yes", "no"],
    });

    if (result === "yes") {
      undo.push(fabricCanvas!, labelProps);
      fabricCanvas!.clear();
    }
  };

  const toggleGrid = () => {
    const newVal = !$appConfig.gridEnabled;
    appConfig.update((cfg) => ({ ...cfg, gridEnabled: newVal }));
    fabricCanvas?.setGridEnabled(newVal);
  };

  const loadLabelFromUrl = async () => {
    try {
      const urlTemplate = await FileUtils.readLabelFromUrl();

      if (urlTemplate === null) {
        return false;
      }

      const confirmResult = await appConfirm({
        title: $tr("params.saved_labels.load.url.warn"),
        buttons: ["yes", "no"],
      });

      if (confirmResult === "yes") {
        onLoadRequested(urlTemplate);
        Toasts.message($tr("params.saved_labels.load.url.loaded"));
        return true;
      }
    } catch (e) {
      Toasts.error(e);
    }
    return false;
  };

  const loadDefaultLabel = async () => {
    const urlLoaded = await loadLabelFromUrl();

    if (urlLoaded) {
      return;
    }

    // The default template lives on the central server; only its id is kept
    // in the browser. Nothing is copied between machines.
    const defaultId = DefaultTemplate.id();

    if (defaultId !== undefined) {
      try {
        const defaultTemplate = await templateStore.load(defaultId);
        onLoadRequested(defaultTemplate);
        return;
      } catch (e) {
        console.warn("Could not load the default template", e);
        // It may have been deleted on another workstation.
        DefaultTemplate.set(undefined);
      }
    }

    LabelDesignerObjectHelper.addText(fabricCanvas!, $tr("editor.default_text"));
  };

  const renderOnFontsChanged = () => {
    fabricCanvas?.forEachObject((o) => {
      if (o instanceof fabric.Textbox) {
        o.dirty = true;
      }
    });
    fabricCanvas?.requestRenderAll();
  };

  onMount(async () => {
    try {
      const savedLabelProps = LocalStoragePersistence.loadLastLabelProps();
      if (savedLabelProps !== null) {
        labelProps = savedLabelProps;
      }
    } catch (e) {
      Toasts.zodErrors(e, "Label parameters load error:");
    }

    fabricCanvas = new CustomCanvas(htmlCanvas, {
      width: labelProps.size.width,
      height: labelProps.size.height,
    });
    fabricCanvas.setLabelProps(labelProps);
    fabricCanvas.onZoomChange = (z) => {
      zoomText = Math.round(z * 100) + "%";
    };
    fabricCanvas.setGridEnabled(!!$appConfig.gridEnabled);

    await loadDefaultLabel();

    window.addEventListener("hashchange", loadLabelFromUrl);
    window.addEventListener("beforeunload", warnBeforeUnload);

    undo.push(fabricCanvas, labelProps);
    hasUnsavedChanges = false;

    // force close dropdowns on touch devices
    fabricCanvas.on("mouse:down", (): void => {
      const dropdowns = document.querySelectorAll("[data-bs-toggle='dropdown']");
      dropdowns.forEach((el) => new Dropdown(el).hide());
    });

    fabricCanvas.on("object:moving", (e): void => {
      if (e.target && e.target.left !== undefined && e.target.top !== undefined) {
        // Snap to the grid only when the grid is shown; otherwise move in whole pixels.
        const step = $appConfig.gridEnabled ? GRID_SIZE : 1;
        e.target.set({
          left: Math.round(e.target.left / step) * step,
          top: Math.round(e.target.top / step) * step,
        });
      }
    });

    fabricCanvas.on("object:modified", (): void => {
      hasUnsavedChanges = true;
      undo.push(fabricCanvas!, labelProps);
    });

    fabricCanvas.on("object:added", (e): void => {
      // Every object is given an identity as it is added, so a barcode can
      // be pointed at it and the link survives a save.
      ensureObjectId(e.target);

      hasUnsavedChanges = true;
    });

    fabricCanvas.on("text:changed", () => {
      hasUnsavedChanges = true;
      editRevision++;

      // A text box that a barcode follows has just changed, so the barcode
      // is encoded again from the new text.
      syncLinkedObjects(fabricCanvas!);
    });

    fabricCanvas.on("object:removed", (): void => {
      hasUnsavedChanges = true;
      undo.push(fabricCanvas!, labelProps);
    });

    fabricCanvas.on("selection:created", (e): void => {
      selectedCount = e.selected?.length ?? 0;
      selectedObject = e.selected?.length === 1 ? e.selected[0] : undefined;
      editRevision++;
    });

    fabricCanvas.on("selection:updated", (e): void => {
      selectedCount = e.selected?.length ?? 0;
      selectedObject = e.selected?.length === 1 ? e.selected[0] : undefined;
      editRevision++;
    });

    fabricCanvas.on("selection:cleared", (): void => {
      selectedObject = undefined;
      selectedCount = 0;
      editRevision++;
    });

    fabricCanvas.on("dragover", (e): void => {
      e.e.preventDefault();
    });

    fabricCanvas.on("drop:after", async (e): Promise<void> => {
      const dragEvt = e.e as DragEvent;
      dragEvt.preventDefault();

      let dropped = false;

      if (dragEvt.dataTransfer?.files) {
        for (const file of dragEvt.dataTransfer.files) {
          try {
            await LabelDesignerObjectHelper.addImageFile(fabricCanvas!, file);
            dropped = true;
          } catch (e) {
            Toasts.error(e);
          }
        }

        if (dropped) {
          undo.push(fabricCanvas!, labelProps);
        }
      }
    });

    fabricCanvas.on("object:scaling", (e): void => {
      if (!e.target) {
        return;
      }

      CanvasUtils.fixFabricObjectScale(e.target);
    });

    if ($automation !== undefined) {
      if ($automation.startPrint !== undefined) {
        if ($automation.startPrint === "immediately") {
          openPreview();
        } else if ($automation.startPrint === "after_connect") {
          const unsubscribe = connectionState.subscribe((st) => {
            if (st === "connected") {
              tick().then(() => unsubscribe());
              openPreview();
            }
          });
        }
      }
    }
  });

  const warnBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!hasUnsavedChanges) return;
    event.preventDefault();
    event.returnValue = "";
  };

  onMount(() =>
    dimensionsUpdateRequest.subscribe((req) => {
      if (req) {
        updateDimensions(req.width, req.height);
      }
    }),
  );

  onDestroy(() => {
    fabricCanvas!.dispose();
    window.removeEventListener("hashchange", loadLabelFromUrl);
    window.removeEventListener("beforeunload", warnBeforeUnload);
  });

  $effect(() => {
    fabricCanvas?.setLabelProps(labelProps);
  });

  $effect(() => {
    if (currentDialog !== "preview") {
    }
  });

  $effect(() => {
    if ($loadedFonts) {
      renderOnFontsChanged();
    }
  });

  // --- canvas zoom ----------------------------------------------------------------
  /**
   * The scrollable area the label is drawn in.
   *
   * "Fit" measures the space the label actually has, rather than guessing
   * from the window, so it stays right when the panel is resized.
   */
  let stageBodyEl: HTMLDivElement | undefined = $state(undefined);

  const zoomBy = (factor: number) => {
    if (!fabricCanvas) return;
    fabricCanvas.virtualZoom(fabricCanvas.getVirtualZoom() * factor);
  };

  const resetZoom = () => {
    fabricCanvas?.resetVirtualZoom();
  };

  /**
   * Scale the label so it fills the space it has.
   *
   * A D11 label is 96 px across, which is a postage stamp on a modern screen:
   * far too small to place a 6 pt batch number by hand. The magnification is
   * for editing only. The printer works from the canvas pixels, not from the
   * size of the element on screen, so the printed result is unaffected.
   */
  /**
   * Check the label for everything that would make the printed result wrong.
   *
   * The checks are read-only and cheap, so this runs on demand rather than on
   * every edit. The point is to catch a mistake before a batch of five
   * hundred labels is printed, not to nag while the label is being designed.
   */
  const runPreflightCheck = () => {
    if (!fabricCanvas) return;
    preflightFindings = runPreflight(fabricCanvas, {
      labelWidth: labelProps.size.width,
      labelHeight: labelProps.size.height,
    });
    currentDialog = "preflight";
  };

  /**
   * Put the objects that run off the label back inside it.
   *
   * Most of the time the object is simply in the wrong place, and moving it
   * is enough. An object bigger than the label cannot be moved inside it, so
   * it is made smaller instead, keeping its shape.
   */
  const onPreflightFix = () => {
    if (!fabricCanvas) return;

    const result = fitObjectsInsideLabel(
      fabricCanvas.getObjects(),
      labelProps.size.width,
      labelProps.size.height,
    );

    if (result.moved === 0 && result.scaled === 0) {
      Toasts.message($tr("preflight.fixed_none"));
      return;
    }

    undo.push(fabricCanvas!, labelProps);
    fabricCanvas!.requestRenderAll();
    editRevision++;

    const parts: string[] = [];

    if (result.moved > 0) {
      parts.push($tr("preflight.fixed_moved").replace("{count}", String(result.moved)));
    }

    if (result.scaled > 0) {
      parts.push($tr("preflight.fixed_scaled").replace("{count}", String(result.scaled)));
    }

    Toasts.message(parts.join(". "));

    // The check is run again, so the panel shows what is still wrong.
    preflightFindings = runPreflight(fabricCanvas!, {
      labelWidth: labelProps.size.width,
      labelHeight: labelProps.size.height,
    });
  };

  /**
   * Select the object a finding refers to, so it can be fixed in place.
   *
   * A finding identifies its object by its position in the canvas object
   * list, which is how the checker identifies it. The lookup falls back to
   * matching fabric's own object identity, in case that ever changes.
   */
  const selectPreflightObject = (objectId: number) => {
    const objects = fabricCanvas?.getObjects() ?? [];
    const target =
      objects[objectId] ??
      objects.find(
        (obj) =>
          (obj as unknown as { canvasId?: number }).canvasId === objectId ||
          (obj as unknown as { id?: unknown }).id === objectId,
      );
    if (!target || !fabricCanvas) return;
    fabricCanvas.setActiveObject(target);
    fabricCanvas.requestRenderAll();
    selectedObject = target;
    selectedCount = 1;
    currentDialog = "none";
  };

  const fitLabelToStage = () => {
    if (!fabricCanvas || !stageBodyEl) return;
    const rect = stageBodyEl.getBoundingClientRect();
    const padding = 48;
    const availW = stageBodyEl.clientWidth - padding;
    const availH = window.innerHeight - rect.top - 170;
    if (availW <= 0 || availH <= 0) return;
    const ratio = Math.min(
      availW / fabricCanvas.getWidth(),
      availH / fabricCanvas.getHeight(),
    );
    fabricCanvas.virtualZoom(Math.min(4, Math.max(0.25, ratio)));
  };
</script>

<svelte:window bind:innerWidth={windowWidth} onkeydown={onKeyDown} onpaste={onPaste} />

<div class="image-editor">
  <div class="row mb-3">
    <div class="col">
      <!--
        The toolbar used to sit BELOW the canvas, in one flat row of thirteen
        buttons, with two of them styled as primary. It is now above the
        canvas, grouped into named clusters, with a single primary action.
      -->
      <div class="designer-toolbar">
        <div class="tool-group">
          <span class="tool-group__label">{$tr("editor.group.model")}</span>
          <div class="tool-group__buttons">
            <div class="btn-group btn-group-sm" role="group" title={$tr("templates.model")}>
              <button
                class="btn btn-outline-secondary"
                class:active={templateModel === "d11"}
                onclick={() => onModelChanged("d11")}>
                D11
              </button>
              <button
                class="btn btn-outline-secondary"
                class:active={templateModel === "b21"}
                onclick={() => onModelChanged("b21")}>
                B21
              </button>
            </div>
          </div>
        </div>

        <div class="tool-group">
          <span class="tool-group__label">{$tr("editor.group.label")}</span>
          <div class="tool-group__buttons">
            <button
              class="btn btn-sm btn-secondary"
              onclick={() => (currentDialog = "label_props")}
              title={$tr("editor.label_props")}>
              <MdIcon icon="settings" />
            </button>
            <button class="btn btn-sm btn-secondary" onclick={clearCanvas} title={$tr("editor.clear")}>
              <MdIcon icon="cancel_presentation" />
            </button>
          </div>
        </div>

        <div class="tool-group">
          <span class="tool-group__label">{$tr("editor.group.edit")}</span>
          <div class="tool-group__buttons">
            <button
              class="btn btn-sm btn-secondary"
              disabled={undoState.undoDisabled}
              onclick={() => undo.undo()}
              title={$tr("editor.undo")}>
              <MdIcon icon="undo" />
            </button>
            <button
              class="btn btn-sm btn-secondary"
              disabled={undoState.redoDisabled}
              onclick={() => undo.redo()}
              title={$tr("editor.redo")}>
              <MdIcon icon="redo" />
            </button>
            <button
              class="btn btn-sm {$appConfig.gridEnabled ? 'btn-primary' : 'btn-secondary'}"
              onclick={toggleGrid}
              title={$tr("editor.grid")}>
              <MdIcon icon="grid_on" />
            </button>
          </div>
        </div>

        <div class="tool-group">
          <span class="tool-group__label">{$tr("editor.group.add")}</span>
          <div class="tool-group__buttons">
            <button
              class="btn btn-sm btn-secondary"
              title={$tr("editor.objectpicker.title")}
              onclick={() => (currentDialog = "object_picker")}>
              <MdIcon icon="format_shapes" />
              <MdIcon icon="add" />
            </button>
            <button
              class="btn btn-sm btn-secondary"
              title={$tr("editor.iconpicker.title")}
              onclick={() => (currentDialog = "icon_picker")}>
              <MdIcon icon="emoji_emotions" />
              <MdIcon icon="add" />
            </button>
          </div>
        </div>

        <div class="tool-group">
          <span class="tool-group__label">{$tr("editor.group.templates")}</span>
          <div class="tool-group__buttons">
            <!--
              These two are how a template reaches the central server, and how
              one comes back. They were bare icons, which is why the central
              store was invisible: there was nothing on screen that said
              "templates live on the server". Now they are labelled.
            -->
            <button
              class="btn btn-sm btn-secondary"
              title={$tr("params.saved_labels.menu_title")}
              onclick={() => (currentDialog = "saved_labels")}>
              <MdIcon icon="sd_storage" />
              {$tr("editor.save_load")}
            </button>
            <button
              class="btn btn-sm btn-secondary"
              title={$tr("templates.gallery")}
              onclick={() => (currentDialog = "quick_print")}>
              <MdIcon icon="bolt" />
              {$tr("editor.gallery")}
            </button>
          </div>
        </div>

        <div class="tool-group">
          <span class="tool-group__label">{$tr("editor.group.data")}</span>
          <div class="tool-group__buttons">
            <button
              class="btn btn-sm btn-{csvEnabled ? 'warning' : 'secondary'}"
              title={$tr("params.csv.title")}
              onclick={() => (currentDialog = "csv_props")}>
              <MdIcon icon="dataset" />
            </button>
            <button
              class="btn btn-sm btn-secondary"
              title={$tr("batch.title")}
              onclick={() => {
                refreshDeclaredVariables();
                currentDialog = "csv_batch";
              }}>
              <MdIcon icon="table_view" />
              {$tr("editor.batch")}
            </button>
          </div>
        </div>

        <div class="tool-group tool-group--end">
          <span class="tool-group__label">{$tr("editor.group.output")}</span>
          <div class="tool-group__buttons">
            <button
              class="btn btn-sm btn-secondary"
              onclick={runPreflightCheck}
              title={$tr("preflight.title")}>
              <MdIcon icon="fact_check" />
              {$tr("editor.preflight")}
            </button>
            <button
              title={$tr("editor.print.hint")}
              class="btn btn-sm btn-primary"
              onclick={openPreview}>
              <MdIcon icon="print" />
              {$tr("editor.print")}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="row mb-1">
    <div class="col">
      <div class="stage">
        <div class="stage__head">
          <span class="stage__chip">
            <span class="stage__chip-dim">{labelProps.size.width} &times; {labelProps.size.height} px</span>
            <span class="stage__chip-model">{templateModel.toUpperCase()}</span>
          </span>

          <!--
            The zoom control lives on the stage, where the thing it changes
            is, rather than back in the toolbar with everything else.
          -->
          <div class="stage__zoom">
            <button
              class="btn btn-sm btn-secondary"
              onclick={() => zoomBy(1 / 1.25)}
              title={$tr("editor.zoom_out")}>
              <MdIcon icon="zoom_out" />
            </button>
            <button
              class="btn btn-sm btn-secondary stage__zoom-value"
              onclick={resetZoom}
              title={$tr("editor.zoom_reset")}>
              {zoomText}
            </button>
            <button
              class="btn btn-sm btn-secondary"
              onclick={() => zoomBy(1.25)}
              title={$tr("editor.zoom_in")}>
              <MdIcon icon="zoom_in" />
            </button>
            <button
              class="btn btn-sm btn-secondary"
              onclick={fitLabelToStage}
              title={$tr("editor.zoom_fit")}>
              <MdIcon icon="fit_screen" />
            </button>
          </div>
        </div>

        <div class="stage__body" bind:this={stageBodyEl}>
          <!--
            The red edge marks where the print starts. On a round label that
            is the circle's tangent, not the corner of the canvas, so the
            inset is passed in rather than assumed.
          -->
          <div
            class="stage__paper print-start-{labelProps.printDirection}"
            style={labelProps.shape === "circle"
              ? `--lb-print-inset: ${Math.max(
                  0,
                  (labelProps.size.width - labelProps.size.height) / 2,
                )}px`
              : ""}>
            <canvas bind:this={htmlCanvas}></canvas>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="row mb-1">
    <div class="col">
      <!--
        The controls for the selected object were a loose, centred row of
        widgets floating under the canvas, with the destructive action first
        and no indication of what they belonged to. They are now a panel with
        a heading, and the object's own actions live in that heading.
      -->
      <div class="props-panel">
        <div class="props-panel__head">
          <span class="props-panel__title">{$tr("editor.group.properties")}</span>
          {#if selectedCount > 0}
            <div class="props-panel__actions">
              <button class="btn btn-sm btn-secondary" onclick={cloneSelected} title={$tr("editor.clone")}>
                <MdIcon icon="content_copy" />
              </button>
              <button class="btn btn-sm btn-danger" onclick={deleteSelected} title={$tr("editor.delete")}>
                <MdIcon icon="delete" />
              </button>
            </div>
          {/if}
        </div>
        <div class="props-panel__body d-flex flex-wrap gap-3 align-items-end">

        {#if selectedObject && selectedCount === 1}
          <GenericObjectParamsControls {selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
          <ClipboardControls {selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
        {/if}

        {#if selectedObject}
          <VectorParamsControls {selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
        {/if}

        {#if selectedObject instanceof fabric.IText}
          <TextParamsControls selectedText={selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
        {/if}

        {#if selectedObject instanceof QRCode}
          <QrCodeParamsPanel selectedQRCode={selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
        {/if}

        {#if selectedObject instanceof ArUcoMarker}
          <ArUcoParamsPanel selectedArUco={selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
        {/if}

        {#if selectedObject instanceof Barcode}
          <BarcodeParamsPanel selectedBarcode={selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
        {/if}

        {#if selectedObject instanceof fabric.IText || selectedObject instanceof QRCode || selectedObject instanceof Barcode}
          <VariableInsertControl {selectedObject} valueUpdated={controlValueUpdated} />
        {/if}

        {#if selectedCount === 0}
          <p class="props-panel__empty">{$tr("editor.properties.empty")}</p>
        {/if}

        {#if selectedObject instanceof fabric.IText}
          <DynamicValueControls
            {selectedObject}
            serialConfig={templateVariables.serial}
            {serialNextValue}
            onSerialConfigChanged={onSerialConfigChanged}
            {editRevision}
            valueUpdated={controlValueUpdated} />
        {/if}

        </div>
      </div>
    </div>
  </div>

  {#if currentDialog === "preview"}
    <PrintPreview
      onClose={() => (currentDialog = "none")}
      canvasCallback={getCanvasForPreview}
      {labelProps}
      {csvEnabled}
      model={templateModel}
      serialConfig={templateVariables.serial}
      csvData={$csvData.data} />
  {:else if currentDialog === "label_props"}
    <LabelPropsEditor
      onClose={() => (currentDialog = "none")}
      onChange={onUpdateLabelProps}
      {labelProps}
      model={templateModel} />
  {:else if currentDialog === "saved_labels"}
    <SavedLabelsMenu
      onClose={() => (currentDialog = "none")}
      {onSave}
      canvas={fabricCanvas!}
      onRequestLabelTemplate={exportCurrentLabel}
      {onLoadRequested}
      {csvEnabled}
      {hasUnsavedChanges} />
  {:else if currentDialog === "csv_props"}
    <CsvControl
      onClose={() => (currentDialog = "none")}
      bind:enabled={csvEnabled}
      onPlaceholderPicked={onCsvPlaceholderPicked} />
  {:else if currentDialog === "csv_batch"}
    <CsvBatchControl
      onClose={() => (currentDialog = "none")}
      template={exportCurrentLabel()}
      fabricJson={getCanvasForPreview()}
      {labelProps}
      onBindingChanged={onTemplateVariablesChanged} />
  {:else if currentDialog === "quick_print"}
    <QuickPrintGallery
      onClose={() => (currentDialog = "none")}
      onPrintTemplate={onQuickPrint}
      onBatchTemplate={onQuickBatch} />
  {:else if currentDialog === "icon_picker"}
    <IconPicker onSubmit={onIconPicked} onSubmitSvg={onSvgIconPicked} onClose={() => (currentDialog = "none")} />
  {:else if currentDialog === "preflight"}
    <AppModal title={$tr("preflight.title")} onClose={() => (currentDialog = "none")}>
      <PreflightPanel
        findings={preflightFindings}
        onselect={selectPreflightObject}
        onfix={onPreflightFix}
        onclose={() => (currentDialog = "none")} />
    </AppModal>
  {:else if currentDialog === "object_picker"}
    <ObjectPicker
      onSubmit={onObjectPicked}
      onClose={() => (currentDialog = "none")}
      {labelProps}
      {zplImageReady}
      {pdfImageReady} />
  {/if}
</div>

<style>
  /* --- the designer toolbar ----------------------------------------------------- */

  .designer-toolbar {
    align-items: flex-start;
    background: var(--lb-surface);
    border: 1px solid var(--lb-border);
    border-radius: var(--lb-radius-lg);
    box-shadow: var(--lb-shadow-sm);
    display: flex;
    flex-wrap: wrap;
    gap: var(--lb-space-3) var(--lb-space-2);
    padding: var(--lb-space-3) var(--lb-space-4);
  }

  .tool-group {
    display: flex;
    flex-direction: column;
    gap: var(--lb-space-2);
    min-width: 0;
  }

  /* The output cluster sits at the right edge, so the one button that matters
     is where the eye lands last. */
  .tool-group--end {
    margin-left: auto;
  }

  .tool-group__label {
    color: var(--lb-text-faint);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.07em;
    padding-left: 2px;
    text-transform: uppercase;
  }

  .tool-group__buttons {
    align-items: center;
    display: flex;
    gap: var(--lb-space-1);
  }

  /* --- the properties panel ------------------------------------------------------ */

  .props-panel {
    background: var(--lb-surface);
    border: 1px solid var(--lb-border);
    border-radius: var(--lb-radius-lg);
    box-shadow: var(--lb-shadow-sm);
    overflow: hidden;
  }

  .props-panel__head {
    align-items: center;
    border-bottom: 1px solid var(--lb-border);
    display: flex;
    justify-content: space-between;
    padding: var(--lb-space-2) var(--lb-space-4);
  }

  .props-panel__title {
    color: var(--lb-text-faint);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }

  .props-panel__actions {
    display: flex;
    gap: var(--lb-space-1);
  }

  .props-panel__body {
    padding: var(--lb-space-4);
  }

  /* --- the stage ---------------------------------------------------------------- */

  .stage {
    background: var(--lb-surface);
    border: 1px solid var(--lb-border);
    border-radius: var(--lb-radius-lg);
    box-shadow: var(--lb-shadow);
    overflow: hidden;
  }

  .stage__head {
    align-items: center;
    border-bottom: 1px solid var(--lb-border);
    display: flex;
    justify-content: space-between;
    padding: var(--lb-space-2) var(--lb-space-3);
  }

  .stage__chip {
    align-items: center;
    color: var(--lb-text-muted);
    display: inline-flex;
    font-size: var(--lb-text-sm);
    gap: var(--lb-space-2);
  }

  .stage__chip-dim {
    font-variant-numeric: tabular-nums;
  }

  .stage__chip-model {
    background: var(--lb-accent-soft);
    border-radius: var(--lb-radius-sm);
    color: var(--lb-accent);
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    padding: 2px 6px;
  }

  .stage__zoom {
    align-items: center;
    display: flex;
    gap: var(--lb-space-1);
  }

  .stage__zoom-value {
    font-variant-numeric: tabular-nums;
    min-width: 4.25rem;
  }

  /* The label sits on a workbench: a dotted, sunken surface, with the label
     itself on a sheet of paper that casts a shadow. */
  .stage__body {
    align-items: center;
    background-color: var(--lb-surface-sunken);
    background-image: radial-gradient(var(--lb-border) 1px, transparent 1px);
    background-size: 16px 16px;
    display: flex;
    justify-content: center;
    max-height: 64vh;
    min-height: 240px;
    overflow: auto;
    padding: var(--lb-space-5);
  }

  /*
    The paper has no background of its own.

    The canvas draws the label — a rectangle, a rounded rectangle or a circle
    — so a white rectangle behind it would make a round label look square.
    The shadow is a drop-shadow rather than a box-shadow for the same reason:
    a drop-shadow follows the pixels that were actually drawn, so a round
    label casts a round shadow.
  */
  .stage__paper {
    background: transparent;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35)) drop-shadow(0 16px 36px rgba(0, 0, 0, 0.35));
    flex: 0 0 auto;
    line-height: 0;
  }

  /* The leading edge is drawn rather than bordered, so it can be placed at
     the label's own edge without moving the canvas. */
  .stage__paper {
    position: relative;
  }

  .stage__paper.print-start-left::before,
  .stage__paper.print-start-top::before {
    background: #ff4646;
    content: "";
    position: absolute;
  }

  .stage__paper.print-start-left::before {
    bottom: 0;
    left: var(--lb-print-inset, 0px);
    top: 0;
    width: 3px;
  }

  .stage__paper.print-start-top::before {
    height: 3px;
    left: 0;
    right: 0;
    top: var(--lb-print-inset, 0px);
  }
  .stage__paper canvas {
    display: block;
    image-rendering: pixelated;
  }

  /* --- the workspace ---------------------------------------------------------- */

  /*
   * Three columns: the tools on the left, the canvas in the middle, the
   * properties of the selection on the right.
   *
   * The canvas is the thing being worked on, so it gets the room and the
   * middle of the screen; everything else is a column beside it. The order
   * of the rows in the markup is already tools, canvas, properties, so the
   * grid places them without moving anything.
   */
  .image-editor {
    align-items: start;
    column-gap: var(--lb-space-3);
    display: grid;
    grid-template-columns: 13.5rem minmax(0, 1fr) 21rem;
  }

  .image-editor > .row {
    margin-bottom: 0 !important;
  }

  /* Below the width where three columns fit, they stack instead. */
  @media (max-width: 1200px) {
    .image-editor {
      grid-template-columns: 13.5rem minmax(0, 1fr);
    }

    .image-editor > .row:nth-child(3) {
      grid-column: 1 / -1;
    }
  }

  @media (max-width: 900px) {
    .image-editor {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  /* --- the rail ---------------------------------------------------------------- */

  .designer-toolbar {
    align-items: stretch;
    flex-direction: column;
    flex-wrap: nowrap;
    gap: 0;
    padding: var(--lb-space-1);
  }

  .tool-group {
    border-bottom: 1px solid var(--lb-border);
    gap: var(--lb-space-1);
    padding: var(--lb-space-2);
  }

  .tool-group:last-child {
    border-bottom: none;
  }

  /* The output cluster is no longer at the right edge of a row, so it does
     not need pushing away from the others. */
  .tool-group--end {
    margin-left: 0;
  }

  .tool-group__buttons {
    flex-wrap: wrap;
  }

  /* --- the stage ---------------------------------------------------------------- */

  .stage {
    box-shadow: var(--lb-shadow-sm);
  }

  /*
   * The zoom control sits over the canvas rather than in a bar above it:
   * it belongs to the thing it changes, and the canvas is what the eye goes
   * to.
   */
  /* The canvas is the hero: it takes the room the page has, and the label
     sits in the middle of it. */
  .stage__body {
    min-height: 58vh;
  }

  .stage {
    position: relative;
  }

  .stage__zoom {
    background: var(--lb-surface);
    border: 1px solid var(--lb-border);
    border-radius: var(--lb-radius);
    box-shadow: var(--lb-shadow);
    left: var(--lb-space-3);
    padding: var(--lb-space-1);
    position: absolute;
    top: 3.4rem;
    z-index: 5;
  }

  /* The inspector says what to do when nothing is selected, rather than
     being an empty box. */
  .props-panel__empty {
    color: var(--lb-text-faint);
    font-size: var(--lb-text-sm);
    margin: 0;
    padding: var(--lb-space-3) 0;
    width: 100%;
  }

  /* --- the inspector ------------------------------------------------------------ */

  .props-panel {
    box-shadow: var(--lb-shadow-sm);
  }
</style>
