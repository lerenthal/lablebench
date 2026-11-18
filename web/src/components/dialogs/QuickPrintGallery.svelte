<script lang="ts">
  /**
   * Quick print — the shared template gallery (§5.5).
   *
   * Fast repeat labels: every template on the central server, as a card, with
   * a print button. A template with no variables prints in one click. A
   * template with variables needs data, so its button opens the CSV batch
   * dialog instead of pretending it can print on its own.
   *
   * The list comes from the server, so the gallery is the same on every
   * workstation and nothing is copied between them.
   */
  import { onMount } from "svelte";
  import AppModal from "$/components/basic/AppModal.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { templateStore } from "$/services/template_store";
  import { tr } from "$/utils/i18n";
  import { Toasts } from "$/utils/toasts";
  import type { TemplateListItem } from "$/types";
  import { libraryModelFor } from "$/utils/printer_profile";

  /**
   * The printer a template was drawn for, as a person reads it.
   *
   * This used to be a translated string, one key per model. There are 77
   * models, so that list was never going to be kept up, and a model id is a
   * product name rather than a word to translate. The old `d11` and `b21`
   * come back as the models they stood for.
   */
  const modelLabel = (model: string): string => libraryModelFor(model) ?? model;

  interface Props {
    onClose?: () => void;
    /** Print a template: load it and open the print preview. */
    onPrintTemplate: (id: string) => void;
    /** A template that needs data: open the batch dialog with it. */
    onBatchTemplate: (id: string) => void;
  }

  let { onClose, onPrintTemplate, onBatchTemplate }: Props = $props();

  let templates = $state<TemplateListItem[]>([]);
  let busy = $state<boolean>(false);
  let filter = $state<string>("");
  let modalRef: AppModal;

  const visible = $derived(
    filter.trim() === ""
      ? templates
      : templates.filter((t) => t.title.toLowerCase().includes(filter.trim().toLowerCase())),
  );

  const refresh = async () => {
    busy = true;
    try {
      templates = await templateStore.listItems();
    } catch (e) {
      Toasts.error(e);
      templates = [];
    } finally {
      busy = false;
    }
  };

  const sizeText = (item: TemplateListItem): string =>
    `${Math.round(item.label.size.width / 8)}x${Math.round(item.label.size.height / 8)}mm`;

  onMount(() => {
    refresh();
  });
</script>

<AppModal title={$tr("templates.gallery")} {onClose} bind:this={modalRef} size="lg">
  <div class="d-flex align-items-center gap-2 mb-2">
    <input
      class="form-control form-control-sm"
      type="search"
      placeholder={$tr("templates.gallery.filter")}
      bind:value={filter} />
    <span class="text-secondary small text-nowrap">
      {visible.length} / {templates.length}
    </span>
  </div>

  {#if busy}
    <div class="text-center py-4">
      <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
    </div>
  {:else if templates.length === 0}
    <div class="text-center text-secondary py-4">
      {$tr("templates.empty")}
    </div>
  {:else if visible.length === 0}
    <div class="text-center text-secondary py-4">
      {$tr("templates.gallery.no_match")}
    </div>
  {:else}
    <div class="row g-2">
      {#each visible as item (item.id)}
        <div class="col-6 col-md-4 col-lg-3">
          <div class="card h-100">
            <div class="card-body d-flex flex-column p-2">
              <div class="thumbnail-frame mb-1">
                {#if item.thumbnailBase64}
                  <img src={item.thumbnailBase64} alt={item.title} />
                {:else}
                  <div class="thumbnail-placeholder">
                    <MdIcon icon="label" />
                  </div>
                {/if}
              </div>

              <div class="fw-semibold small text-truncate" title={item.title}>{item.title}</div>

              <div class="text-secondary small">
                {modelLabel(item.model)} · {sizeText(item)}
              </div>

              {#if item.variable_names.length > 0}
                <div class="small text-warning">
                  <MdIcon icon="dataset" />
                  {item.variable_names.length}
                  {$tr("templates.variables")}
                </div>
              {/if}

              <div class="mt-auto pt-1">
                {#if item.variable_names.length === 0}
                  <button
                    class="btn btn-sm btn-primary w-100"
                    onclick={() => onPrintTemplate(item.id)}>
                    <MdIcon icon="print" />
                    {$tr("templates.quick_print")}
                  </button>
                {:else}
                  <button
                    class="btn btn-sm btn-outline-secondary w-100"
                    onclick={() => onBatchTemplate(item.id)}>
                    <MdIcon icon="dataset" />
                    {$tr("templates.gallery.needs_data")}
                  </button>
                {/if}
              </div>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</AppModal>

<style>
  .thumbnail-frame {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bs-body-bg);
    border: 1px solid var(--bs-border-color);
    border-radius: 0.25rem;
    overflow: hidden;
    aspect-ratio: 3 / 2;
  }

  .thumbnail-frame img {
    max-width: 100%;
    max-height: 100%;
    image-rendering: pixelated;
  }

  .thumbnail-placeholder {
    color: var(--bs-secondary-color);
    opacity: 0.4;
  }
</style>
