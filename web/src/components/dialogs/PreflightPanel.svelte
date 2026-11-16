<script lang="ts">
  import { tr } from "$/utils/i18n";
  import { interpolate } from "$/utils/interpolate";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import {
    summarizeFindings,
    type PreflightFinding,
    type PreflightSeverity,
  } from "$/utils/preflight";
  import type { TranslationKey } from "$/locale";

  interface Props {
    findings?: PreflightFinding[];
    onselect?: (id: number) => void;
    onclose?: () => void;
    /**
     * Put the objects that run off the label back inside it.
     *
     * Only offered when there is something to put back, so the button never
     * appears for a check it cannot help with.
     */
    onfix?: () => void;
  }

  let {
    findings = [],
    onselect = () => {},
    onclose = () => {},
    onfix = () => {},
  }: Props = $props();

  /** Whether anything runs off the label, which is what the fix addresses. */
  const canFix = $derived(
    findings.some((finding) => finding.code === "outside-label"),
  );

  /** Errors first, then warnings, then info. */
  const severityOrder: PreflightSeverity[] = ["error", "warning", "info"];

  const summary = $derived(summarizeFindings(findings));

  const groups = $derived(
    severityOrder
      .map((severity) => ({
        severity,
        items: findings.filter((finding) => finding.severity === severity),
      }))
      .filter((group) => group.items.length > 0),
  );

  const severityLabel = (severity: PreflightSeverity): string => {
    switch (severity) {
      case "error":
        return $tr("preflight.error");
      case "warning":
        return $tr("preflight.warning");
      case "info":
        return $tr("preflight.info");
    }
  };

  /** The translated sentence with the finding's values substituted in. */
  const message = (finding: PreflightFinding): string =>
    interpolate($tr(finding.messageKey as TranslationKey), finding.params);

  const countLabel = (count: number): string =>
    interpolate($tr("preflight.findings"), { count });
</script>

<div class="preflight">
  <!--
    The panel is shown inside the app's shared modal, which owns the title and
    the close button, so there is no header of its own here.
  -->
  <p class="preflight-subtitle">{$tr("preflight.subtitle")}</p>

  <div class="preflight-summary">
    <span class="preflight-total">{countLabel(findings.length)}</span>
    <span class="preflight-stats">
      <span class="stat" data-severity="error">
        <strong>{summary.errors}</strong>
        {$tr("preflight.error")}
      </span>
      <span class="stat" data-severity="warning">
        <strong>{summary.warnings}</strong>
        {$tr("preflight.warning")}
      </span>
      <span class="stat" data-severity="info">
        <strong>{summary.infos}</strong>
        {$tr("preflight.info")}
      </span>
    </span>
  </div>

  {#if findings.length === 0}
    <div class="preflight-ok">
      <div class="preflight-ok-mark" aria-hidden="true">✓</div>
      <h3 class="preflight-ok-title">{$tr("preflight.ok_title")}</h3>
      <p class="preflight-ok-body">{$tr("preflight.ok_body")}</p>
    </div>
  {:else}
    <div class="preflight-groups">
      {#each groups as group (group.severity)}
        <section class="preflight-group" data-severity={group.severity}>
          <h3 class="preflight-group-title">
            <span class="preflight-group-name">{severityLabel(group.severity)}</span>
            <span class="preflight-group-count">{group.items.length}</span>
          </h3>
          <ul class="preflight-list">
            {#each group.items as finding (finding.id)}
              <li>
                <button
                  type="button"
                  class="preflight-row"
                  disabled={finding.objectId === undefined}
                  onclick={() => {
                    if (finding.objectId !== undefined) onselect(finding.objectId);
                  }}>
                  <span class="preflight-chip" data-severity={finding.severity}>
                    {severityLabel(finding.severity)}
                  </span>
                  <span class="preflight-message">{message(finding)}</span>
                  {#if finding.objectLabel}
                    <span class="preflight-object">{finding.objectLabel}</span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/if}

  <footer class="preflight-footer">
    {#if canFix}
      <button
        type="button"
        class="btn btn-sm btn-outline-primary"
        onclick={onfix}
        title={$tr("preflight.auto_fix.hint")}>
        <MdIcon icon="build" />
        {$tr("preflight.auto_fix")}
      </button>
    {/if}
    <button type="button" class="preflight-done" onclick={onclose}>
      {$tr("preflight.close")}
    </button>
  </footer>
</div>

<style>
  .preflight {
    display: flex;
    flex-direction: column;
    gap: var(--lb-space-3);
    color: var(--lb-text);
  }

  .preflight-subtitle {
    margin: 0 0 var(--lb-space-1);
    font-size: 0.85rem;
    color: var(--lb-text-muted);
  }

  .preflight-summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--lb-space-2);
    padding: var(--lb-space-2) var(--lb-space-3);
    background: var(--lb-surface-raised);
    border: 1px solid var(--lb-border);
    border-radius: var(--lb-radius);
  }

  .preflight-total {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--lb-text);
  }

  .preflight-stats {
    display: flex;
    flex-wrap: wrap;
    gap: var(--lb-space-2);
  }

  .stat {
    display: inline-flex;
    align-items: center;
    gap: var(--lb-space-1);
    padding: 0.1rem var(--lb-space-2);
    font-size: 0.75rem;
    color: var(--lb-text-muted);
    background: var(--lb-surface-sunken);
    border-radius: var(--lb-radius-sm);
  }

  .stat strong {
    color: var(--lb-text);
  }

  .stat[data-severity="error"] strong {
    color: var(--lb-danger);
  }

  .stat[data-severity="warning"] strong {
    color: #f5a524;
  }

  .stat[data-severity="info"] strong {
    color: var(--lb-accent);
  }

  /* --- the good news ------------------------------------------------------------ */

  .preflight-ok {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--lb-space-2);
    padding: var(--lb-space-6) var(--lb-space-4);
    text-align: center;
    background: var(--lb-surface-raised);
    border: 1px solid var(--lb-border);
    border-radius: var(--lb-radius);
  }

  .preflight-ok-mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3rem;
    height: 3rem;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--lb-success);
    background: var(--lb-surface-sunken);
    border: 2px solid var(--lb-success);
    border-radius: 50%;
  }

  .preflight-ok-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--lb-text);
  }

  .preflight-ok-body {
    margin: 0;
    max-width: 28rem;
    font-size: 0.85rem;
    color: var(--lb-text-muted);
  }

  /* --- the findings ------------------------------------------------------------- */

  .preflight-groups {
    display: flex;
    flex-direction: column;
    gap: var(--lb-space-4);
  }

  .preflight-group {
    display: flex;
    flex-direction: column;
    gap: var(--lb-space-2);
  }

  .preflight-group-title {
    display: flex;
    align-items: center;
    gap: var(--lb-space-2);
    margin: 0;
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--lb-text-faint);
  }

  .preflight-group-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.25rem;
    padding: 0 0.35rem;
    font-size: 0.7rem;
    color: var(--lb-text-muted);
    background: var(--lb-surface-sunken);
    border-radius: var(--lb-radius-sm);
  }

  .preflight-list {
    display: flex;
    flex-direction: column;
    gap: var(--lb-space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .preflight-row {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: baseline;
    gap: var(--lb-space-1) var(--lb-space-2);
    width: 100%;
    padding: var(--lb-space-2) var(--lb-space-3);
    font: inherit;
    text-align: left;
    color: var(--lb-text);
    background: var(--lb-surface-raised);
    border: 1px solid var(--lb-border);
    border-radius: var(--lb-radius);
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background-color 0.15s ease;
  }

  .preflight-row:hover:not(:disabled) {
    background: var(--lb-surface-sunken);
    border-color: var(--lb-border-strong);
  }

  .preflight-row:disabled {
    cursor: default;
  }

  .preflight-chip {
    display: inline-flex;
    align-items: center;
    padding: 0.05rem var(--lb-space-2);
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #ffffff;
    border-radius: var(--lb-radius-sm);
    white-space: nowrap;
  }

  .preflight-chip[data-severity="error"] {
    background: var(--lb-danger);
  }

  .preflight-chip[data-severity="warning"] {
    background: #f5a524;
    color: #241a00;
  }

  .preflight-chip[data-severity="info"] {
    background: var(--lb-accent);
  }

  .preflight-message {
    font-size: 0.85rem;
    color: var(--lb-text);
    overflow-wrap: anywhere;
  }

  .preflight-object {
    grid-column: 2;
    font-size: 0.75rem;
    font-family: var(--lb-font-mono, monospace);
    color: var(--lb-text-faint);
    overflow-wrap: anywhere;
  }

  .preflight-footer {
    display: flex;
    justify-content: flex-end;
    padding-top: var(--lb-space-1);
    border-top: 1px solid var(--lb-border);
  }

  .preflight-done {
    padding: var(--lb-space-2) var(--lb-space-4);
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--lb-text);
    background: var(--lb-surface-raised);
    border: 1px solid var(--lb-border-strong);
    border-radius: var(--lb-radius);
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .preflight-done:hover {
    background: var(--lb-surface-sunken);
  }
</style>
