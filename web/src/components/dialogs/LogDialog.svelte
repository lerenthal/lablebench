<script lang="ts">
  import { tr } from "$/utils/i18n";
  import AppModal from "$/components/basic/AppModal.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import {
    clearLog,
    logEntries,
    logReport,
    sortedEntries,
    type LogEntry,
    type LogLevel,
  } from "$/utils/app_log";
  import { Toasts } from "$/utils/toasts";

  interface Props {
    onClose?: () => void;
  }

  let { onClose }: Props = $props();

  let filter = $state<LogLevel | "all">("all");
  let showFallback = $state(false);

  const shown = $derived(
    sortedEntries($logEntries).filter((entry) => filter === "all" || entry.level === filter),
  );

  const counts = $derived({
    all: $logEntries.length,
    error: $logEntries.filter((entry) => entry.level === "error").length,
    warn: $logEntries.filter((entry) => entry.level === "warn").length,
    info: $logEntries.filter((entry) => entry.level === "info").length,
  });

  /**
   * Copy the whole log as one block of text.
   *
   * The clipboard is the point: the log is meant to be read by someone else
   * — the lab's IT, whoever wrote the app — and a screenshot of a scrolling
   * list is the worst way to hand it over.
   */
  const copy = async () => {
    const report = logReport();

    try {
      await navigator.clipboard.writeText(report);
      Toasts.message($tr("log.copied"));
    } catch {
      // The clipboard can be refused, so fall back to a selectable box.
      showFallback = true;
    }
  };

  const time = (entry: LogEntry) => {
    const date = new Date(entry.at);
    return `${date.toLocaleTimeString()} ${date.toLocaleDateString()}`;
  };
</script>

<AppModal title={$tr("log.title")} onClose={onClose} size="lg">
  <div class="log">
    <div class="log__bar">
      <div class="btn-group btn-group-sm" role="group" aria-label={$tr("log.filter")}>
        <button
          class="btn btn-sm {filter === 'all' ? 'btn-primary' : 'btn-outline-secondary'}"
          onclick={() => (filter = "all")}>
          {$tr("log.filter.all")} ({counts.all})
        </button>
        <button
          class="btn btn-sm {filter === 'error' ? 'btn-primary' : 'btn-outline-secondary'}"
          onclick={() => (filter = "error")}>
          {$tr("log.filter.error")} ({counts.error})
        </button>
        <button
          class="btn btn-sm {filter === 'warn' ? 'btn-primary' : 'btn-outline-secondary'}"
          onclick={() => (filter = "warn")}>
          {$tr("log.filter.warn")} ({counts.warn})
        </button>
        <button
          class="btn btn-sm {filter === 'info' ? 'btn-primary' : 'btn-outline-secondary'}"
          onclick={() => (filter = "info")}>
          {$tr("log.filter.info")} ({counts.info})
        </button>
      </div>

      <div class="d-flex gap-2">
        <button class="btn btn-sm btn-secondary" onclick={copy}>
          <MdIcon icon="content_copy" />
          {$tr("log.copy")}
        </button>
        <button
          class="btn btn-sm btn-outline-danger"
          onclick={() => {
            clearLog();
            Toasts.message($tr("log.cleared"));
          }}>
          <MdIcon icon="delete" />
          {$tr("log.clear")}
        </button>
      </div>
    </div>

    {#if shown.length === 0}
      <p class="log__empty">{$tr("log.empty")}</p>
    {:else}
      <ul class="log__list">
        {#each shown as entry (entry.at + entry.message)}
          <li class="log__entry log__entry--{entry.level}">
            <span class="log__time">{time(entry)}</span>
            <span class="log__level">{entry.level}</span>
            <span class="log__category">{entry.category}</span>
            <span class="log__message">
              {entry.message}
              {#if entry.detail}
                <span class="log__detail">{entry.detail}</span>
              {/if}
            </span>
          </li>
        {/each}
      </ul>
    {/if}

    {#if showFallback}
      <div class="log__fallback">
        <p>{$tr("log.fallback")}</p>
        <textarea class="form-control font-monospace" rows="10" readonly
          value={logReport()}></textarea>
      </div>
    {/if}
  </div>
</AppModal>

<style>
  .log {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .log__bar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    justify-content: space-between;
  }

  .log__list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 22rem;
    overflow-y: auto;
    border: 1px solid var(--lb-border);
    border-radius: 0.375rem;
  }

  .log__entry {
    display: grid;
    grid-template-columns: 9.5rem 4rem 6rem 1fr;
    gap: 0.5rem;
    padding: 0.35rem 0.6rem;
    border-bottom: 1px solid var(--lb-border);
    font-size: 0.8rem;
    line-height: 1.35;
  }

  .log__entry:last-child {
    border-bottom: none;
  }

  .log__time {
    color: var(--lb-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .log__level {
    text-transform: uppercase;
    font-size: 0.68rem;
    letter-spacing: 0.04em;
    align-self: center;
  }

  .log__entry--error .log__level {
    color: var(--lb-danger);
  }

  .log__entry--warn .log__level {
    color: var(--lb-accent);
  }

  .log__entry--info .log__level {
    color: var(--lb-text-muted);
  }

  .log__category {
    color: var(--lb-text-muted);
    align-self: center;
  }

  .log__message {
    word-break: break-word;
  }

  .log__detail {
    display: block;
    color: var(--lb-text-muted);
    font-family: var(--lb-font-mono);
    font-size: 0.74rem;
    white-space: pre-wrap;
  }

  .log__empty {
    color: var(--lb-text-muted);
    margin: 0;
    padding: 1.5rem 0;
    text-align: center;
  }
</style>
