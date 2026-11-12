<script lang="ts">
  import { Utils } from "@mmote/niimbluelib";
  import BrowserWarning from "$/components/basic/BrowserWarning.svelte";
  import LabelDesigner from "$/components/LabelDesigner.svelte";
  import PrinterConnector from "$/components/PrinterConnector.svelte";
  import { locale, locales, tr } from "$/utils/i18n";
  import DebugStuff from "$/components/dialogs/DebugStuff.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import AppPrompt from "$/components/dialogs/AppPrompt.svelte";
  import AppConfirm from "./dialogs/AppConfirm.svelte";
  import HelpDialog from "$/components/dialogs/HelpDialog.svelte";
  import { appPrompt } from "$/stores/prompt";
  import { apiKeyStore } from "$/services/api";

  // eslint-disable-next-line no-undef
  const appCommit = __APP_COMMIT__;
  // eslint-disable-next-line no-undef
  const appVersion = __APP_VERSION__;
  // eslint-disable-next-line no-undef
  const buildDate = __BUILD_DATE__;

  let isStandalone = Utils.getAvailableTransports().capacitorBle || "__TAURI__" in window;

  let debugStuffShow = $state<boolean>(false);
  let helpShow = $state<boolean>(false);

  /**
   * Set the shared API key.
   *
   * Phase 1 runs with no auth, so the server accepts everything. When the
   * gate is switched on, the key goes here and every request carries it —
   * the editor itself needs no change.
   */
  const setApiKey = async () => {
    const value = await appPrompt({
      title: $tr("main.api_key"),
      message: $tr("main.api_key.hint"),
      defaultValue: apiKeyStore.get(),
    });

    if (value !== null) {
      apiKeyStore.set(value.trim());
    }
  };
</script>

<div class="page-wrapper d-flex flex-column min-vh-100">
  <header class="app-bar">
    <div class="app-bar__brand">
      <span class="app-bar__mark" aria-hidden="true">
        <MdIcon icon="sell" />
      </span>
      <span>
        <span class="app-bar__name">LabelBench</span>
        <span class="app-bar__tag d-block">
          {#if isStandalone}
            {$tr("main.standalone")}
          {:else}
            {$tr("main.tagline")}
          {/if}
        </span>
      </span>
    </div>

    <div class="app-bar__status">
      <button
        class="app-bar__help"
        onclick={() => (helpShow = true)}
        title={$tr("help.title")}>
        <MdIcon icon="help_outline" />
      </button>
      <PrinterConnector />
    </div>
  </header>

  <div class="container my-4 flex-grow-1">
    <div class="row">
      <div class="col">
        <BrowserWarning />
      </div>
    </div>

    <div class="row">
      <div class="col">
        <div class="work-panel">
          <LabelDesigner />
        </div>
      </div>
    </div>
  </div>

  <footer class="app-footer">
    <div class="d-flex align-items-center gap-2">
      <select
        class="form-select form-select-sm w-auto"
        style="max-width: 12rem"
        bind:value={$locale}
        aria-label={$tr("main.language")}>
        {#each Object.entries(locales) as [key, name] (key)}
          <option value={key}>{name}</option>
        {/each}
      </select>
    </div>

    <div class="d-flex align-items-center gap-3">
      {#if appVersion}
        <a href="https://github.com/MultiMote/niimblue/releases/tag/{appVersion}">{appVersion}</a>
      {:else if appCommit}
        <a href="https://github.com/MultiMote/niimblue/commit/{appCommit}">{appCommit.slice(0, 6)}</a>
      {/if}
      <span>{$tr("main.built")} {buildDate}</span>
    </div>

    <div class="d-flex align-items-center gap-2">
      <a href="https://github.com/MultiMote/niimblue">{$tr("main.code")}</a>
      <button class="btn btn-link btn-sm p-0" onclick={setApiKey} title={$tr("main.api_key")}>
        <MdIcon icon="key" />
      </button>
      <button
        class="btn btn-link btn-sm p-0"
        onclick={() => debugStuffShow = true}
        title={$tr("main.debug")}>
        <MdIcon icon="bug_report" />
      </button>
    </div>
  </footer>
</div>

{#if debugStuffShow}
  <DebugStuff bind:show={debugStuffShow} />
{/if}

{#if helpShow}
  <HelpDialog onClose={() => (helpShow = false)} />
{/if}

<AppPrompt />

<AppConfirm />
