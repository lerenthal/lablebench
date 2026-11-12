<script lang="ts">
  import { tr } from "$/utils/i18n";
  import { api } from "$/services/api";
  import { counterNameFor, formatSerialValue } from "$/utils/dynamic_values";
  import type { SerialConfig } from "$/types";

  interface Props {
    serialConfig: SerialConfig | undefined;
    onChange: (config: SerialConfig | undefined) => void;
  }

  let { serialConfig, onChange }: Props = $props();

  let counterValue = $state<number | undefined>(undefined);
  let counterReachable = $state(true);

  const loadCounter = async (name: string): Promise<void> => {
    if (name === "") {
      counterValue = undefined;
      counterReachable = true;
      return;
    }

    try {
      const counters = await api.listSerialCounters();
      counterValue = counters.find((c) => c.name === name)?.value;
      counterReachable = true;
    } catch {
      counterValue = undefined;
      counterReachable = false;
    }
  };

  $effect(() => {
    const name = serialConfig ? counterNameFor(serialConfig) : "";
    void loadCounter(name);
  });

  const addSerial = () => {
    onChange({
      variable: "serial",
      counter: "",
      prefix: "",
      suffix: "",
      start: 1,
      step: 1,
      pad: 4,
    });
  };

  const update = (patch: Partial<SerialConfig>) => {
    if (serialConfig === undefined) {
      return;
    }

    onChange({ ...serialConfig, ...patch });
  };

  const resetCounter = async () => {
    const name = serialConfig ? counterNameFor(serialConfig) : "";

    if (name === "") {
      return;
    }

    try {
      await api.resetSerialCounter(name, 0);
      await loadCounter(name);
    } catch {
      counterReachable = false;
    }
  };
</script>

<div class="mb-3">
  <h6 class="small text-uppercase">{$tr("params.serial.title")}</h6>

  {#if serialConfig === undefined}
    <button class="btn btn-sm btn-outline-secondary" onclick={addSerial}>
      {$tr("params.serial.add")}
    </button>
  {:else}
  <div class="input-group input-group-sm mb-1">
    <span class="input-group-text">{$tr("params.serial.variable")}</span>
    <input
      class="form-control"
      type="text"
      value={serialConfig?.variable ?? ""}
      onchange={(e) => update({ variable: e.currentTarget.value })} />
  </div>

  <div class="input-group input-group-sm mb-1">
    <span class="input-group-text">{$tr("params.serial.counter")}</span>
    <input
      class="form-control"
      type="text"
      placeholder={serialConfig?.variable ?? ""}
      value={serialConfig?.counter ?? ""}
      onchange={(e) => update({ counter: e.currentTarget.value })} />
  </div>

  <div class="input-group input-group-sm mb-1">
    <span class="input-group-text">{$tr("params.serial.prefix")}</span>
    <input
      class="form-control"
      type="text"
      value={serialConfig?.prefix ?? ""}
      onchange={(e) => update({ prefix: e.currentTarget.value })} />
  </div>

  <div class="input-group input-group-sm mb-1">
    <span class="input-group-text">{$tr("params.serial.suffix")}</span>
    <input
      class="form-control"
      type="text"
      value={serialConfig?.suffix ?? ""}
      onchange={(e) => update({ suffix: e.currentTarget.value })} />
  </div>

  <div class="input-group input-group-sm mb-1">
    <span class="input-group-text">{$tr("params.serial.start")}</span>
    <input
      class="form-control"
      type="number"
      value={serialConfig?.start ?? 1}
      onchange={(e) => update({ start: Number(e.currentTarget.value) })} />
  </div>

  <div class="input-group input-group-sm mb-1">
    <span class="input-group-text">{$tr("params.serial.step")}</span>
    <input
      class="form-control"
      type="number"
      value={serialConfig?.step ?? 1}
      onchange={(e) => update({ step: Number(e.currentTarget.value) })} />
  </div>

  <div class="input-group input-group-sm mb-2">
    <span class="input-group-text">{$tr("params.serial.pad")}</span>
    <input
      class="form-control"
      type="number"
      min="0"
      max="20"
      value={serialConfig?.pad ?? 0}
      onchange={(e) => update({ pad: Number(e.currentTarget.value) })} />
  </div>

  {#if serialConfig !== undefined}
    <div class="small text-muted">
      {$tr("params.serial.last")}: <code>{counterReachable ? (counterValue ?? 0) : "?"}</code>
      {#if counterValue !== undefined}
        &middot; {$tr("params.serial.next")}:
        <code>{formatSerialValue(counterValue + serialConfig.step, serialConfig)}</code>
      {/if}
    </div>

    {#if !counterReachable}
      <div class="small text-danger mt-1">{$tr("params.serial.unreachable")}</div>
    {/if}

    <button class="btn btn-sm btn-outline-secondary mt-2" onclick={resetCounter}>
      {$tr("params.serial.reset")}
    </button>
  {/if}
{/if}
</div>
