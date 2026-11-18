<script lang="ts">
  /**
   * Saved templates — backed by the central server (§5.3).
   *
   * Nothing is kept in the browser: the list and the templates themselves live
   * on the server, so every workstation sees the same library and nothing is
   * ever copied between machines. The only per-workstation artefact is the id
   * of the default template — a pointer, not a template.
   */
  import { tr } from "$/utils/i18n";
  import { onMount } from "svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import SavedLabelsBrowser from "$/components/designer-controls/SavedLabelsBrowser.svelte";
  import { ExportedLabelTemplateSchema, type ExportedLabelTemplate, type TemplateListItem } from "$/types";
  import { Toasts } from "$/utils/toasts";
  import { FileUtils } from "$/utils/file_utils";
  import * as fabric from "fabric";
  import { Utils } from "@mmote/niimbluelib";
  import { z } from "zod";
  import AppModal from "$/components/basic/AppModal.svelte";
  import { appConfirm } from "$/stores/confirm";
  import { appConfig } from "$/stores/app";
  import { templateStore } from "$/services/template_store";
  import { DefaultTemplate } from "$/services/default_template";

  interface Props {
    onRequestLabelTemplate: () => ExportedLabelTemplate;
    onLoadRequested: (label: ExportedLabelTemplate) => void;
    onClose?: () => void;
    onSave?: () => void;
    canvas: fabric.Canvas;
    hasUnsavedChanges: boolean;
  }

  let { onRequestLabelTemplate, onLoadRequested, canvas, onClose, onSave, hasUnsavedChanges }: Props =
    $props();

  let savedLabels = $state<TemplateListItem[]>([]);
  let selectedIndex = $state<number>(-1);
  let title = $state<string>("");
  let busy = $state<boolean>(false);
  let customDefaultTemplate = $state<boolean>(false);
  let isStandalone = Utils.getAvailableTransports().capacitorBle;
  let modalRef: AppModal;
  let sortMode = $derived($appConfig.savedLabelsSortMode ?? "date_asc");

  const sortAndAssign = (labels: TemplateListItem[]) => {
    if (sortMode === "title_asc") {
      savedLabels = [...labels].sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortMode === "title_desc") {
      savedLabels = [...labels].sort((a, b) => b.title.localeCompare(a.title));
    } else if (sortMode === "date_asc") {
      savedLabels = [...labels].sort((a, b) => a.timestamp - b.timestamp);
    } else {
      savedLabels = [...labels].sort((a, b) => b.timestamp - a.timestamp);
    }
  };

  const refresh = async () => {
    busy = true;
    try {
      sortAndAssign(await templateStore.listItems());
      customDefaultTemplate = DefaultTemplate.id() !== undefined;
    } catch (e) {
      Toasts.error(e);
      savedLabels = [];
    } finally {
      busy = false;
    }
  };

  const toggleSortType = () => {
    let newMode = sortMode;

    if (sortMode.startsWith("date")) {
      newMode = sortMode === "date_desc" ? "title_desc" : "title_asc";
    } else {
      newMode = sortMode === "title_desc" ? "date_desc" : "date_asc";
    }

    $appConfig.savedLabelsSortMode = newMode;

    sortAndAssign(savedLabels);
    selectedIndex = -1;
    title = "";
  };

  const toggleSortDirection = () => {
    let newMode = sortMode;

    if (sortMode === "date_desc") {
      newMode = "date_asc";
    } else if (sortMode === "date_asc") {
      newMode = "date_desc";
    } else if (sortMode === "title_asc") {
      newMode = "title_desc";
    } else if (sortMode === "title_desc") {
      newMode = "title_asc";
    }

    $appConfig.savedLabelsSortMode = newMode;

    sortAndAssign(savedLabels);
    selectedIndex = -1;
    title = "";
  };

  const onLabelSelected = (index: number) => {
    selectedIndex = index;
    title = savedLabels[index]?.title ?? "";
  };

  const onLabelExport = async (idx: number) => {
    const item = savedLabels[idx];
    if (item === undefined) {
      return;
    }

    try {
      const full = await templateStore.load(item.id);
      FileUtils.saveLabelAsJson(full);
    } catch (e) {
      Toasts.zodErrors(e, "Canvas save error:");
    }
  };

  const onLabelDelete = async (idx: number) => {
    const item = savedLabels[idx];
    if (item === undefined) {
      return;
    }

    busy = true;
    try {
      await templateStore.delete(item.id);

      // If the deleted template was the default, clear the pointer too.
      if (DefaultTemplate.id() === item.id) {
        DefaultTemplate.set(undefined);
      }

      selectedIndex = -1;
      title = "";
      await refresh();
      Toasts.message($tr("templates.deleted"));
    } catch (e) {
      Toasts.error(e);
    } finally {
      busy = false;
    }
  };

  const saveTemplate = async (template: ExportedLabelTemplate): Promise<boolean> => {
    try {
      await templateStore.save(template);
      await refresh();
      return true;
    } catch (e) {
      Toasts.error(e);
      return false;
    }
  };

  const onSaveReplaceClicked = async () => {
    if (selectedIndex === -1) {
      return;
    }

    const confirmResult = await appConfirm({
      title: $tr("editor.warning.save"),
      buttons: ["yes", "no"],
    });

    if (confirmResult !== "yes") {
      return;
    }

    const existing = savedLabels[selectedIndex];
    if (existing === undefined) {
      return;
    }

    const label = onRequestLabelTemplate();
    label.title = title;
    label.id = existing.id;

    busy = true;
    try {
      if (await saveTemplate(label)) {
        Toasts.message($tr("templates.saved"));
        onSave?.();
      }
    } finally {
      busy = false;
    }
  };

  const onMakeDefaultClicked = () => {
    const item = savedLabels[selectedIndex];
    if (item === undefined) {
      return;
    }

    DefaultTemplate.set(item.id);
    customDefaultTemplate = true;
    onSave?.();
  };

  const onRemoveDefaultClicked = () => {
    DefaultTemplate.set(undefined);
    customDefaultTemplate = false;
  };

  const onSaveClicked = async () => {
    const label = onRequestLabelTemplate();
    label.title = title;

    // "Save" always creates a new template. Replacing the open one is the
    // separate "Replace" action, so the id is cleared here.
    label.id = undefined;

    busy = true;
    try {
      if (await saveTemplate(label)) {
        Toasts.message($tr("templates.saved"));
        onSave?.();
      }
    } finally {
      busy = false;
    }
  };

  const onLoadClicked = async () => {
    if (selectedIndex === -1) {
      return;
    }

    const item = savedLabels[selectedIndex];
    if (item === undefined) {
      return;
    }

    let message = "";

    if (hasUnsavedChanges) {
      message = $tr("editor.warning.load");
    }

    if (message) {
      const confirmResult = await appConfirm({
        title: message,
        buttons: ["yes", "no"],
      });

      if (confirmResult !== "yes") {
        return;
      }
    }

    busy = true;
    try {
      const label = await templateStore.load(item.id);
      onLoadRequested(label);
      modalRef.hide();
    } catch (e) {
      Toasts.error(e);
    } finally {
      busy = false;
    }
  };

  const onImportClicked = async () => {
    try {
      const contents = await FileUtils.pickAndReadSingleTextFile("json");
      const rawData = JSON.parse(contents);
      const imported = FileUtils.parseSingleOrList(rawData, ExportedLabelTemplateSchema);
      const items = imported.kind === "single" ? [imported.item] : imported.items;

      if (items.length === 0) {
        return;
      }

      busy = true;
      let saved = 0;

      for (const item of items) {
        // An imported document has no server id — it always becomes a new one.
        const { id: _ignored, ...rest } = item;
        if (await saveTemplate(rest as ExportedLabelTemplate)) {
          saved++;
        }
      }

      Toasts.message(
        saved === 1
          ? $tr("params.saved_labels.import.added_one")
          : $tr("params.saved_labels.import.added_many").replace("{count}", String(saved)),
      );

      // The imported template is opened, so it can be printed straight away
      // rather than hunted for in the gallery.
      if (items.length > 0) {
        const { id: _ignored, ...rest } = items[0];
        onLoadRequested(rest as ExportedLabelTemplate);
        modalRef.hide();
      }
    } catch (e) {
      if (e instanceof z.ZodError) {
        Toasts.zodErrors(e, "Label import error:");
      } else {
        Toasts.error(e);
      }
    } finally {
      busy = false;
    }
  };

  const onExportClicked = () => {
    try {
      const label = onRequestLabelTemplate();
      if (title) {
        label.title = title.replaceAll(/[\\/:*?"<>|]/g, "_");
      }
      FileUtils.saveLabelAsJson(label);
      onSave?.();
    } catch (e) {
      Toasts.zodErrors(e, "Canvas save error:");
    }
  };

  const onExportAllClicked = async () => {
    try {
      const items = await Promise.all(savedLabels.map((item) => templateStore.load(item.id)));
      FileUtils.saveLabelsAsJson(items);
      onSave?.();
    } catch (e) {
      if (e instanceof z.ZodError) {
        Toasts.zodErrors(e, "Labels export error:");
      } else {
        Toasts.error(e);
      }
    }
  };

  const onExportPngClicked = () => {
    try {
      FileUtils.saveCanvasAsPng(canvas);
    } catch (e) {
      Toasts.zodErrors(e, "Canvas save error:");
    }
  };

  const onExportUrlClicked = async () => {
    try {
      const label = onRequestLabelTemplate();
      const url = await FileUtils.makeLabelUrl(label);

      if (url.length > 2000) {
        const confirmResult = await appConfirm({
          title: $tr("params.saved_labels.save.url.warn"),
          buttons: ["yes", "no"],
        });

        if (confirmResult !== "yes") {
          return;
        }
      }

      navigator.clipboard.writeText(url);
      Toasts.message($tr("params.saved_labels.save.url.copied"));
      onSave?.();
    } catch (e) {
      Toasts.error(e);
    }
  };

  onMount(() => {
    refresh();
  });
</script>

<AppModal title={$tr("params.saved_labels.menu_title")} {onClose} bind:this={modalRef} size="lg">
  <div class="mb-1">
    {#if busy}
      <span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
      {$tr("templates.server")}
    {:else}
      {$tr("templates.list")}: <strong>{savedLabels.length}</strong>
    {/if}
  </div>

  <div class="mb-1 d-flex align-items-center gap-1">
    <button class="btn btn-sm btn-outline-secondary" onclick={onImportClicked} disabled={busy}>
      <MdIcon icon="data_object" />
      {$tr("params.saved_labels.load.json")}
    </button>
    <div class="btn-group btn-group-sm">
      <button
        type="button"
        class="btn btn-outline-secondary dropdown-toggle"
        data-bs-toggle="dropdown"
        aria-expanded="false">
        <MdIcon icon="data_object" />
        {$tr("params.saved_labels.save.json")}
      </button>
      <ul class="dropdown-menu">
        <li><h6 class="dropdown-header">{$tr("params.saved_labels.export.current")}</h6></li>
        <li>
          <button class="dropdown-item" onclick={onExportClicked}>
            {$tr("params.saved_labels.export.json")}
          </button>
        </li>
        <li>
          <button class="dropdown-item" onclick={onExportPngClicked}>
            {$tr("params.saved_labels.export.png")}
          </button>
        </li>
        {#if !isStandalone}
          <li>
            <button class="dropdown-item" onclick={onExportUrlClicked}>
              {$tr("params.saved_labels.save.url")}
            </button>
          </li>
        {/if}
        <li><hr class="dropdown-divider" /></li>
        <li><h6 class="dropdown-header">{$tr("params.saved_labels.export.all")}</h6></li>
        <li>
          <button class="dropdown-item" onclick={onExportAllClicked}>
            {$tr("params.saved_labels.export.json")}
          </button>
        </li>
      </ul>
    </div>

    <div class="btn-group btn-group-sm ms-auto">
      <button class="btn btn-outline-secondary" onclick={toggleSortType}>
        <MdIcon icon={sortMode.startsWith("date") ? "schedule" : "sort_by_alpha"} />
      </button>
      <button class="btn btn-outline-secondary" onclick={toggleSortDirection}>
        <MdIcon icon={["date_desc", "title_desc"].includes(sortMode) ? "arrow_downward" : "arrow_upward"} />
      </button>
    </div>
  </div>

  <SavedLabelsBrowser
    class="mb-1"
    {selectedIndex}
    labels={savedLabels}
    onItemClicked={onLabelSelected}
    onItemDelete={onLabelDelete}
    onItemExport={onLabelExport} />

  <div class="input-group flex-nowrap input-group-sm">
    <span class="input-group-text">{$tr("params.saved_labels.label_title")}</span>
    <input
      class="form-control"
      type="text"
      placeholder={$tr("params.saved_labels.label_title.placeholder")}
      bind:value={title} />
  </div>

  {#snippet footer()}
    <div class="btn-group btn-group-sm make-default">
      <button class="btn text-secondary" onclick={onMakeDefaultClicked} disabled={selectedIndex === -1}>
        {$tr("templates.make_default")}
      </button>
      {#if customDefaultTemplate}
        <button class="btn text-secondary" onclick={onRemoveDefaultClicked}>
          <MdIcon icon="close" />
        </button>
      {/if}
    </div>

    <button class="btn btn-sm btn-secondary" onclick={onSaveClicked} disabled={busy}>
      <MdIcon icon="save" />
      {$tr("params.saved_labels.save.browser")}
    </button>

    {#if selectedIndex !== -1}
      <button class="btn btn-sm btn-secondary" onclick={onSaveReplaceClicked} disabled={busy}>
        <MdIcon icon="edit_note" />
        {$tr("params.saved_labels.save.browser.replace")}
      </button>

      <button class="btn btn-sm btn-primary" onclick={onLoadClicked} disabled={busy}>
        <MdIcon icon="folder" />
        {$tr("params.saved_labels.load.browser")}
      </button>
    {/if}
  {/snippet}
</AppModal>

<style>
  .make-default {
    margin-right: auto;
  }
</style>
