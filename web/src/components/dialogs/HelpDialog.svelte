<script lang="ts">
  import { tr } from "$/utils/i18n";
  import AppModal from "$/components/basic/AppModal.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { type MaterialIcon } from "$/styles/mdi_icons";

  interface Props {
    onClose?: () => void;
  }

  let { onClose }: Props = $props();
  let modalRef: AppModal;

  /**
   * The sections of the guide.
   *
   * The keys are written out rather than built from a string, because the
   * translation keys are a typed union: a key that is not in the dictionary
   * has to be a compile error, not a blank line in the help.
   */
  type HelpSectionKey =
    | "help.toolbar"
    | "help.canvas"
    | "help.shape"
    | "help.preflight"
    | "help.templates"
    | "help.printers"
    | "help.printing"
    | "help.batch"
    | "help.serial"
    | "help.objects";

  const groups: { icon: MaterialIcon; key: HelpSectionKey }[] = [
    { icon: "select_all", key: "help.toolbar" },
    { icon: "crop_free", key: "help.canvas" },
    { icon: "radio_button_unchecked", key: "help.shape" },
    { icon: "fact_check", key: "help.preflight" },
    { icon: "sd_storage", key: "help.templates" },
    { icon: "usb", key: "help.printers" },
    { icon: "print", key: "help.printing" },
    { icon: "dataset", key: "help.batch" },
    { icon: "pin", key: "help.serial" },
    { icon: "category", key: "help.objects" },
  ];
</script>

<AppModal title={$tr("help.title")} {onClose} bind:this={modalRef} size="lg">
  <p class="help-intro">{$tr("help.intro")}</p>

  <h3 class="help-heading">{$tr("help.workflow_title")}</h3>
  <ol class="help-steps">
    <li>{$tr("help.step.model")}</li>
    <li>{$tr("help.step.objects")}</li>
    <li>{$tr("help.step.variables")}</li>
    <li>{$tr("help.step.check")}</li>
    <li>{$tr("help.step.save")}</li>
    <li>{$tr("help.step.print")}</li>
  </ol>

  <div class="help-sections">
    {#each groups as group (group.key)}
      <section class="help-section">
        <h3 class="help-heading">
          <MdIcon icon={group.icon} />
          {$tr(`${group.key}_title`)}
        </h3>
        <p class="help-body">{$tr(`${group.key}_body`)}</p>

        {#if group.key === "help.toolbar"}
          <dl class="help-list">
            <dt>{$tr("help.toolbar_model")}</dt>
            <dd>{$tr("help.toolbar_model_desc")}</dd>
            <dt>{$tr("help.toolbar_label")}</dt>
            <dd>{$tr("help.toolbar_label_desc")}</dd>
            <dt>{$tr("help.toolbar_edit")}</dt>
            <dd>{$tr("help.toolbar_edit_desc")}</dd>
            <dt>{$tr("help.toolbar_add")}</dt>
            <dd>{$tr("help.toolbar_add_desc")}</dd>
            <dt>{$tr("help.toolbar_templates")}</dt>
            <dd>{$tr("help.toolbar_templates_desc")}</dd>
            <dt>{$tr("help.toolbar_data")}</dt>
            <dd>{$tr("help.toolbar_data_desc")}</dd>
            <dt>{$tr("help.toolbar_output")}</dt>
            <dd>{$tr("help.toolbar_output_desc")}</dd>
          </dl>
        {/if}

        {#if group.key === "help.objects"}
          <dl class="help-list">
            <dt>{$tr("help.objects_link")}</dt>
            <dd>{$tr("help.objects_link_desc")}</dd>
            <dt>{$tr("help.objects_rotate")}</dt>
            <dd>{$tr("help.objects_rotate_desc")}</dd>
            <dt>{$tr("help.objects_copy")}</dt>
            <dd>{$tr("help.objects_copy_desc")}</dd>
            <dt>{$tr("help.objects_resize")}</dt>
            <dd>{$tr("help.objects_resize_desc")}</dd>
          </dl>
        {/if}
      </section>
    {/each}
  </div>

  {#snippet footer()}
    <button class="btn btn-sm btn-primary" onclick={() => modalRef.hide()}>
      {$tr("help.close")}
    </button>
  {/snippet}
</AppModal>

<style>
  .help-intro {
    color: var(--lb-text-muted);
    font-size: 0.95rem;
    margin: 0 0 var(--lb-space-4);
  }

  .help-heading {
    align-items: center;
    color: var(--lb-text);
    display: flex;
    font-size: 0.95rem;
    font-weight: 650;
    gap: var(--lb-space-2);
    margin: 0 0 var(--lb-space-2);
  }

  .help-heading :global(.mdi) {
    color: var(--lb-accent);
    font-size: 1rem;
  }

  .help-steps {
    color: var(--lb-text);
    font-size: 0.9rem;
    margin: 0 0 var(--lb-space-5);
    padding-left: 1.3rem;
  }

  .help-steps li {
    margin-bottom: var(--lb-space-1);
  }

  .help-sections {
    display: grid;
    gap: var(--lb-space-5);
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
  }

  .help-body {
    color: var(--lb-text-muted);
    font-size: 0.875rem;
    line-height: 1.55;
    margin: 0;
  }

  .help-list {
    display: grid;
    gap: var(--lb-space-1) var(--lb-space-3);
    grid-template-columns: auto 1fr;
    margin: var(--lb-space-3) 0 0;
  }

  .help-list dt {
    color: var(--lb-text);
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .help-list dd {
    color: var(--lb-text-muted);
    font-size: 0.8rem;
    margin: 0;
  }
</style>
