<script lang="ts">
  import Dropdown from "bootstrap/js/dist/dropdown";
  import * as fabric from "fabric";
  import { onDestroy, onMount, tick } from "svelte";
  import { ArUcoMarker } from "$/fabric-object/aruco";
  import { Barcode } from "$/fabric-object/barcode";
  import { QRCode } from "$/fabric-object/qrcode";
  import { iconCodepoints, type MaterialIcon } from "$/styles/mdi_icons";
  import { appConfig, automation, connectionState, csvData, dimensionsUpdateRequest, loadedFonts } from "$/stores/app";
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
  import { tr } from "$/utils/i18n";
  import { LabelDesignerObjectHelper } from "$/utils/label_designer_object_helper";
  import { LocalStoragePersistence } from "$/utils/persistence";
  import { Toasts } from "$/utils/toasts";
  import { UndoRedo, type UndoState } from "$/utils/undo_redo";
  import BarcodeParamsPanel from "$/components/designer-controls/BarcodeParamsControls.svelte";
  import CsvControl from "$/components/dialogs/CsvControl.svelte";
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
  import SerialConfigControls from "$/components/designer-controls/SerialConfigControls.svelte";
  import {
    counterNameFor,
    formatSerialValue,
    previewSerialValue,
    resolveDynamicObjects,
  } from "$/utils/dynamic_values";
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

  type DialogName =
    | "none"
    | "preview"
    | "label_props"
    | "saved_labels"
    | "csv_props"
    | "csv_batch"
    | "quick_print"
    | "icon_picker"
    | "object_picker";

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
  let printNow = $state<boolean>(false);
  let csvEnabled = $state<boolean>(false);
  /** What the next printed label would show for the serial variable. */
  let serialNextValue = $state<string | undefined>(undefined);
  let windowWidth = $state<number>(0);
  let undoState = $state<UndoState>({ undoDisabled: false, redoDisabled: false });
  let zoomText = $state<string>("100%");
  let hasUnsavedChanges = $state<boolean>(false);

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
    onUpdateLabelProps(data.label);
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
    labelProps = newProps;
    hasUnsavedChanges = true;
    fabricCanvas!.setDimensions(labelProps.size);
    fabricCanvas!.virtualZoom(fabricCanvas!.getVirtualZoom());
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
      printNow = true;
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
    printNow = false;
    currentDialog = "preview";
  };

  const openPreviewAndPrint = () => {
    printNow = true;
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

    fabricCanvas.on("object:added", (): void => {
      hasUnsavedChanges = true;
    });

    fabricCanvas.on("text:changed", () => {
      hasUnsavedChanges = true;
      editRevision++;
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
              openPreviewAndPrint();
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
      printNow = false;
    }
  });

  $effect(() => {
    if ($loadedFonts) {
      renderOnFontsChanged();
    }
  });
</script>

<svelte:window bind:innerWidth={windowWidth} onkeydown={onKeyDown} onpaste={onPaste} />

<div class="image-editor">
  <div class="row mb-3">
    <div class="col d-flex justify-content-center">
      <div class="canvas-wrapper print-start-{labelProps.printDirection}">
        <canvas bind:this={htmlCanvas}></canvas>
      </div>
    </div>
  </div>

  <div class="row mb-1">
    <div class="col d-flex justify-content-center">
      <div class="toolbar d-flex flex-wrap gap-1 justify-content-center align-items-center">
        <button class="btn btn-sm btn-secondary" onclick={() => (currentDialog = "label_props")}>
          <MdIcon icon="settings" />
        </button>

        <button class="btn btn-sm btn-secondary" onclick={clearCanvas} title={$tr("editor.clear")}>
          <MdIcon icon="cancel_presentation" />
        </button>

        <!--
          These two are how a template reaches the central server, and how one
          comes back. They were bare icons, which is why the central store was
          invisible: there was nothing on screen that said "templates live on
          the server". Now they are labelled.
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
          {$tr("templates.gallery")}
        </button>

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

        <button class="btn btn-sm btn-secondary" onclick={() => fabricCanvas?.resetVirtualZoom()} title="Reset zoom">
          {zoomText}
        </button>

        <button
          class="btn btn-sm btn-{csvEnabled ? 'warning' : 'secondary'}"
          title={$tr("params.csv.title")}
          onclick={() => (currentDialog = "csv_props")}>
          <MdIcon icon="dataset" />
        </button>

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

        <button
          class="btn btn-sm btn-primary"
          title={$tr("batch.title")}
          onclick={() => {
            refreshDeclaredVariables();
            currentDialog = "csv_batch";
          }}>
          <MdIcon icon="print" />
          {$tr("batch.title")}
        </button>

        <button
          class="btn btn-sm btn-secondary"
          title={$tr("editor.iconpicker.title")}
          onclick={() => (currentDialog = "icon_picker")}>
          <MdIcon icon="emoji_emotions" />
          <MdIcon icon="add" />
        </button>

        <button
          class="btn btn-sm btn-secondary"
          title={$tr("editor.objectpicker.title")}
          onclick={() => (currentDialog = "object_picker")}>
          <MdIcon icon="format_shapes" />
          <MdIcon icon="add" />
        </button>

        <button class="btn btn-sm btn-primary ms-1" onclick={openPreview}>
          <MdIcon icon="visibility" />
          {$tr("editor.preview")}
        </button>
        <button
          title="Print with default or saved parameters"
          class="btn btn-sm btn-primary ms-1"
          onclick={openPreviewAndPrint}
          disabled={$connectionState !== "connected"}><MdIcon icon="print" /> {$tr("editor.print")}</button>
      </div>
    </div>
  </div>

  <div class="row mb-1">
    <div class="col d-flex justify-content-center">
      <div class="toolbar d-flex flex-wrap gap-1 justify-content-center align-items-center">
        {#if selectedCount > 0}
          <button class="btn btn-sm btn-danger me-1" onclick={deleteSelected} title={$tr("editor.delete")}>
            <MdIcon icon="delete" />
          </button>
        {/if}

        {#if selectedCount > 0}
          <button class="btn btn-sm btn-secondary me-1" onclick={cloneSelected} title={$tr("editor.clone")}>
            <MdIcon icon="content_copy" />
          </button>
        {/if}

        {#if selectedObject && selectedCount === 1}
          <GenericObjectParamsControls {selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
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

        {#if selectedObject instanceof fabric.IText}
          <DynamicValueControls
            {selectedObject}
            serialConfig={templateVariables.serial}
            {serialNextValue}
            {editRevision}
            valueUpdated={controlValueUpdated} />
        {/if}

        <SerialConfigControls
          serialConfig={templateVariables.serial}
          onChange={onSerialConfigChanged} />
      </div>
    </div>
  </div>

  {#if currentDialog === "preview"}
    <PrintPreview
      onClose={() => (currentDialog = "none")}
      canvasCallback={getCanvasForPreview}
      {labelProps}
      {printNow}
      {csvEnabled}
      model={templateModel}
      serialConfig={templateVariables.serial}
      csvData={$csvData.data} />
  {:else if currentDialog === "label_props"}
    <LabelPropsEditor onClose={() => (currentDialog = "none")} onChange={onUpdateLabelProps} {labelProps} />
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
  .canvas-wrapper {
    border: 1px solid var(--lb-border);
    background-color: var(--lb-surface-sunken);
    border-radius: var(--lb-radius);
    box-shadow: var(--lb-shadow);
    max-width: 100%;
    max-height: 70vh;
    overflow: auto;
    padding: var(--lb-space-3);
  }
  .canvas-wrapper.print-start-left {
    border-left: 2px solid #ff4646;
  }
  .canvas-wrapper.print-start-top {
    border-top: 2px solid #ff4646;
  }
  .canvas-wrapper canvas {
    image-rendering: pixelated;
    display: block;
  }
</style>
