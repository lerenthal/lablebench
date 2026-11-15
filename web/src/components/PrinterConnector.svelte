<script lang="ts">
  import {
    AutoShutdownTime,
    LabelType,
    NiimbotBluetoothClient,
    NiimbotCapacitorBleClient,
    NiimbotSerialClient,
    ResolutionClass,
    SoundSettingsItemType,
    Utils,
    type AvailableTransports,
  } from "@mmote/niimbluelib";
  import {
    printerClient,
    printerKind,
    dymoConnection,
    connectedPrinterName,
    connectionState,
    initClient,
    heartbeatData,
    printerInfo,
    printerMeta,
    heartbeatFails,
    automation,
    rfidInfo,
    dimensionsUpdateRequest,
  } from "$/stores/app";
  import { connectDymo, connectDymoDevice, describeDymoError, disconnectDymo } from "$/utils/dymo";
  import { describeWrongPort, identifySerialPorts } from "$/utils/serial_identify";
  import { logError, logInfo, logWarn } from "$/utils/app_log";
  import type { ConnectionType } from "$/types";
  import { tr, type TranslationKey } from "$/utils/i18n";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { Toasts } from "$/utils/toasts";
  import { onMount } from "svelte";
  import { LocalStoragePersistence } from "$/utils/persistence";
  import type { MaterialIcon } from "material-icons";
  import FirmwareUpdater from "$/components/basic/FirmwareUpdater.svelte";
  import PrinterVerboseInfo from "$/components/dialogs/PrinterVerboseInfo.svelte";
  import {
    detectConnectedDevice,
    listGrantedDevices,
    reconnectCandidates,
    rememberDevice,
    type GrantedDevice,
    type GrantTransport,
  } from "$/services/device_grants";

  let connectionType = $state<ConnectionType>("bluetooth");
  let featureSupport = $state<AvailableTransports>({ webBluetooth: false, webSerial: false, capacitorBle: false });
  /** WebUSB, which is how a DYMO LabelWriter is reached. */
  let webUsbSupported = $state<boolean>(false);
  /**
   * Which family of printer the user has picked.
   *
   * The buttons pick a printer; the button beside them connects it. The
   * LabelWriter used to connect the moment it was picked, while the
   * NIIMBOT transports only selected — so the same gesture did two different
   * things.
   */
  let selectedFamily = $state<"niim" | "dymo">("niim");
  let verboseInfoShow = $state<boolean>(false);
  /** Printers this machine is already allowed to use — the one-click targets. */
  let reconnectTargets = $state<GrantedDevice[]>([]);

  /** Capacitor BLE is a native plugin, so it has no browser grant concept. */
  const transportFor = (type: ConnectionType): GrantTransport | undefined => {
    if (type === "bluetooth") {
      return "bluetooth";
    }
    if (type === "serial") {
      return "serial";
    }
    return undefined;
  };

  /**
   * The printers this machine is already allowed to use.
   *
   * The LabelWriter is a USB device, so it is listed whenever that family is
   * selected — the browser's picker is the only way to get a grant, but a
   * granted device comes back without it.
   */
  const refreshReconnectTargets = async () => {
    const transport = transportFor(connectionType);
    const granted = transport === undefined ? [] : await reconnectCandidates(transport);

    if (selectedFamily !== "dymo") {
      reconnectTargets = granted;
      return;
    }

    const usb = await reconnectCandidates("usb");
    reconnectTargets = [...usb, ...granted.filter((device) => device.transport === "usb")];
  };

  const percentage = (cur?: number, total?: number) => {
    if (cur === undefined || total === undefined) {
      return 0;
    }
    const usage = Math.floor((cur / total) * 100);
    return Math.min(Math.max(usage, 0), 100);
  };

  const onConnectClicked = async () => {
    const transport = transportFor(connectionType);
    // The ports present before the picker opens, so the newly granted one can
    // be identified afterwards.
    const before = transport === undefined ? [] : await listGrantedDevices(transport);

    initClient(connectionType);
    connectionState.set("connecting");
    logInfo("printer", `Connecting over ${connectionType}`);

    try {
      if ($printerClient instanceof NiimbotCapacitorBleClient && $automation?.autoConnectDeviceId !== undefined) {
        await $printerClient.connect({ deviceId: $automation.autoConnectDeviceId });
      } else {
        await $printerClient.connect();
      }

      if (transport !== undefined) {
        rememberDevice(await detectConnectedDevice(transport, before));
      }

      logInfo("printer", `Connected over ${connectionType}`);
    } catch (e) {
      connectionState.set("disconnected");
      logError("printer", `Could not connect over ${connectionType}`, e);

      // A machine has serial ports of its own, so the wrong one can be
      // picked. When that happens, the ports that were granted are asked
      // which of them has a printer on it.
      if (transport === "serial") {
        const identities = await identifySerialPorts(await listGrantedDevices("serial"));
        const hint = describeWrongPort(identities);

        if (hint !== undefined) {
          logWarn("printer", `The chosen port had no printer on it. ${hint}`);
          Toasts.error(`${e instanceof Error ? e.message : String(e)}\n\n${hint}`);
          await refreshReconnectTargets();
          return;
        }
      }

      Toasts.error(e);
    }

    await refreshReconnectTargets();
  };

  /**
   * Reconnect to a printer this machine is already allowed to use.
   *
   * The browser keeps the grant, so no picker appears and no permission is
   * re-asked — this is the "the printer moved here" path, in one click.
   */
  const onReconnectClicked = async (device: GrantedDevice) => {
    if (device.transport === "usb") {
      await onDymoDeviceClicked(device);
      return;
    }

    initClient(device.transport === "bluetooth" ? "bluetooth" : "serial");
    connectionState.set("connecting");

    try {
      if (device.transport === "bluetooth" && $printerClient instanceof NiimbotBluetoothClient) {
        await $printerClient.connect({ authorizedDevice: device.handle as BluetoothDevice });
      } else if (device.transport === "serial" && $printerClient instanceof NiimbotSerialClient) {
        await $printerClient.connect({ authorizedPort: device.handle as SerialPort });
      } else {
        throw new Error("The printer transport changed. Please pick the device again.");
      }

      rememberDevice(device);
    } catch (e) {
      connectionState.set("disconnected");
      Toasts.error(e);
    }
  };

  /**
   * Connect a DYMO LabelWriter over USB.
   *
   * The browser's USB picker has to be opened from a user gesture, so this
   * is wired straight to the button. WebUSB needs a secure context, which
   * is why the app is served from a trusted certificate.
   */
  const onDymoConnectClicked = async () => {
    connectionState.set("connecting");

    try {
      const connection = await connectDymo();
      dymoConnection.set(connection);
      printerKind.set("dymo");
      connectedPrinterName.set(connection.model);
      connectionState.set("connected");
    } catch (e) {
      console.error(e);
      connectionState.set("disconnected");
      Toasts.error(describeDymoError(e));
    }
  };

  /**
   * Connect to a LabelWriter the browser has already been granted.
   *
   * A printer that has been plugged into this workstation before needs no
   * picker again, so it is offered as a one-click target.
   */
  const onDymoDeviceClicked = async (device: GrantedDevice) => {
    connectionState.set("connecting");

    try {
      const connection = await connectDymoDevice(device.handle as USBDevice);
      dymoConnection.set(connection);
      printerKind.set("dymo");
      connectedPrinterName.set(connection.model);
      connectionState.set("connected");
      rememberDevice(device);
    } catch (e) {
      console.error(e);
      connectionState.set("disconnected");
      Toasts.error(describeDymoError(e));
    }
  };

  const onDymoDisconnectClicked = async () => {
    const connection = $dymoConnection;

    if (connection !== undefined) {
      await disconnectDymo(connection);
    }

    dymoConnection.set(undefined);
    printerKind.set("niim");
    connectedPrinterName.set("");
    connectionState.set("disconnected");
  };

  const onDisconnectClicked = () => {
    $printerClient.disconnect();
  };

  const startHeartbeat = async () => {
    $printerClient.startHeartbeat();
  };

  const stopHeartbeat = async () => {
    $printerClient.stopHeartbeat();
  };

  const reset = async () => {
    await $printerClient.protocol.printerReset();
  };

  const switchConnectionType = (c: ConnectionType) => {
    LocalStoragePersistence.saveLastConnectionType(c);
    connectionType = c;
    refreshReconnectTargets();
  };

  const batteryIcon = (value: number): MaterialIcon => {
    if (value >= 90) return "battery_full";
    if (value >= 65) return "battery_5_bar";
    if (value >= 40) return "battery_3_bar";
    if (value >= 15) return "battery_2_bar";
    return "battery_0_bar";
  };

  const applyDimensionsClicked = () => {
    const paper = $rfidInfo.paperInfo;
    let dpmm = 8;

    if ($printerInfo.resolutionClass !== undefined) {
      dpmm = $printerInfo.resolutionClass === ResolutionClass.DPI300 ? 11.81 : 0;
    } else if ($printerInfo.capabilities?.printheadDpi !== undefined) {
      dpmm = $printerInfo.capabilities?.printheadDpi === 300 ? 11.81 : 0;
    }

    if (paper?.paperWidth !== undefined && paper?.paperHeight !== undefined) {
      let width = Math.floor(paper.paperWidth * dpmm);
      let height = Math.floor(paper.paperHeight * dpmm);

      if ($printerInfo.printheadWidth !== undefined && width > $printerInfo.printheadWidth) {
        width = $printerInfo.printheadWidth;
      }

      width -= width % 8;

      dimensionsUpdateRequest.set({ width, height }); // todo: print direction?
    }
  };

  onMount(() => {
    featureSupport = Utils.getAvailableTransports();
    webUsbSupported = typeof navigator !== "undefined" && "usb" in navigator;

    connectionType = LocalStoragePersistence.loadLastConnectionType() ?? "bluetooth";

    if (!featureSupport.capacitorBle && connectionType === "capacitor-ble") {
      connectionType = "bluetooth";
    }
    if (!featureSupport.webSerial && connectionType === "serial") {
      connectionType = "bluetooth";
    }
    if (!featureSupport.webBluetooth && connectionType === "bluetooth" && featureSupport.capacitorBle) {
      connectionType = "capacitor-ble";
    }

    if ($automation !== undefined && $automation.autoConnect && connectionType === "capacitor-ble") {
      onConnectClicked();
    }

    // The browser already knows which printers this machine may use. Offer
    // them for one-click reconnect as soon as the connector is shown.
    refreshReconnectTargets();
  });
</script>

<div class="input-group w-auto input-group-sm flex-nowrap justify-content-end">
  {#if $connectionState === "connected"}
    <button class="btn btn-secondary" data-bs-toggle="dropdown" data-bs-auto-close="false">
      <MdIcon icon="settings" />
    </button>

    <div class="dropdown-menu p-3">
      {#if $printerKind === "dymo"}
        <div class="text-secondary">{$tr("connector.dymo")}</div>
        <div class="mb-2">{$connectedPrinterName}</div>
        <button class="btn btn-sm btn-secondary" onclick={onDymoDisconnectClicked}>
          {$tr("connector.disconnect")}
        </button>
      {:else}
      {#if $printerInfo}
        <div class="text-secondary">{$tr("connector.device_version")}</div>

        <div class="d-flex border rounded">
          <div class="px-1 bg-light-subtle border-end">HW</div>
          <div class="px-1 flex-grow-1 border-end text-center">{$printerInfo.hardwareVersion}</div>
          <div class="px-1 flex-grow-1 border-end text-center">{$printerInfo.softwareVersion}</div>
          <div class="px-1 bg-body-secondary">FW</div>
        </div>
      {/if}

      <div class="text-secondary mt-2">
        {$tr("connector.rfid.paper")}
        <button class="btn btn-sm p-0" onclick={() => $printerClient.fetchRfidInfo()}><MdIcon icon="loop" /></button>
      </div>

      {#if $rfidInfo.labelRfidInfo?.tagPresent}
        <div class="d-flex border rounded mt-1">
          <div class="px-1 bg-light-subtle border-end">{$tr("connector.rfid.usage")}</div>
          <div class="px-1 flex-grow-1 d-flex align-items-center gap-1">
            <div class="progress flex-grow-1" role="progressbar" style:height="0.6rem">
              <div
                class="progress-bar"
                style:width={`${percentage($rfidInfo.labelRfidInfo.usedPaper, $rfidInfo.labelRfidInfo.allPaper)}%`}>
              </div>
            </div>
            <div class="fs-08">
              {$rfidInfo.labelRfidInfo?.usedPaper} / {$rfidInfo.labelRfidInfo?.allPaper}
            </div>
          </div>
        </div>

        <div class="d-flex border rounded mt-1">
          <div class="px-1 bg-light-subtle border-end">{$tr("connector.rfid.type")}</div>
          <div class="px-1 flex-grow-1 text-center">
            {$tr(`preview.label_type.${LabelType[$rfidInfo.labelRfidInfo?.consumablesType]}` as TranslationKey)} ({$rfidInfo
              .labelRfidInfo?.consumablesType})
          </div>
        </div>

        {#if $rfidInfo.paperInfo?.paperWidth !== undefined && $rfidInfo.paperInfo?.paperHeight !== undefined}
          <div class="d-flex border rounded mt-1">
            <div class="px-1 bg-light-subtle border-end">{$tr("connector.rfid.dimensions")}</div>
            <div class="px-1 flex-grow-1 text-center">
              {$rfidInfo.paperInfo.paperWidth}x{$rfidInfo.paperInfo.paperHeight}mm
              <button class="btn text-info set-dim-button" onclick={applyDimensionsClicked}>
                <MdIcon icon="aspect_ratio" />
              </button>
            </div>
          </div>
        {/if}
      {:else}
        {$tr("connector.rfid.no_tag")}
      {/if}

      {#if $rfidInfo.ribbonRfidInfo?.tagPresent}
        <div class="text-secondary mt-2">
          {$tr("connector.rfid.ribbon")}
          <button class="btn btn-sm p-0" onclick={() => $printerClient.fetchRfidInfo()}><MdIcon icon="loop" /></button>
        </div>

        <div class="d-flex border rounded mt-1">
          <div class="px-1 bg-light-subtle border-end">{$tr("connector.rfid.usage")}</div>
          <div class="px-1 flex-grow-1 d-flex align-items-center gap-1">
            <div class="progress flex-grow-1" role="progressbar" style:height="0.6rem">
              <div
                class="progress-bar"
                style:width={`${percentage($rfidInfo.ribbonRfidInfo.usedPaper, $rfidInfo.ribbonRfidInfo.allPaper)}%`}>
              </div>
            </div>
            <div class="fs-08">
              {$rfidInfo.ribbonRfidInfo?.usedPaper} / {$rfidInfo.ribbonRfidInfo?.allPaper}
            </div>
          </div>
        </div>
      {/if}

      <div class="text-secondary mt-2">{$tr("connector.settings")}</div>

      <div class="form-check form-switch">
        <input
          class="form-check-input"
          type="checkbox"
          role="switch"
          id="power-sound-switch"
          checked={$printerInfo.settings.powerSound}
          onchange={() =>
            $printerClient.setSoundEnabled(SoundSettingsItemType.PowerSound, !$printerInfo.settings.powerSound)} />
        <label class="form-check-label" for="power-sound-switch">{$tr("connector.settings.power_sound")}</label>
      </div>

      <div class="form-check form-switch">
        <input
          class="form-check-input"
          type="checkbox"
          role="switch"
          id="connection-sound-switch"
          checked={$printerInfo.settings.connectionSound}
          onchange={() =>
            $printerClient.setSoundEnabled(
              SoundSettingsItemType.BluetoothConnectionSound,
              !$printerInfo.settings.connectionSound,
            )} />
        <label class="form-check-label" for="connection-sound-switch"
          >{$tr("connector.settings.connection_sound")}</label>
      </div>

      <div class="input-group input-group-sm mt-1">
        <span class="input-group-text ">{$tr("connector.settings.auto_shutdown")}</span>
        <select class="form-select form-select-sm" value={ $printerInfo.settings.autoShutdownTime} onchange={(e) =>
            $printerClient.setAutoShutdownTime(Number(e.currentTarget.value))}>
          <option value={AutoShutdownTime.ShutdownTime1}>15 {$tr("connector.settings.auto_shutdown.min")}</option>
          <option value={AutoShutdownTime.ShutdownTime2}>30 {$tr("connector.settings.auto_shutdown.min")}</option>
          <option value={AutoShutdownTime.ShutdownTime3}>45 / 60 {$tr("connector.settings.auto_shutdown.min")}</option>
          <option value={AutoShutdownTime.ShutdownTime4}>60 / ∞ {$tr("connector.settings.auto_shutdown.min")}</option>
        </select>
      </div>


      <button class="btn btn-sm btn-outline-secondary w-100 mt-3" onclick={() => (verboseInfoShow = true)}
        >{$tr("connector.open_verbose")}</button>

      <button
        class="btn btn-sm btn-outline-secondary d-block w-100 mt-1"
        type="button"
        data-bs-toggle="collapse"
        data-bs-target="#firmware_flashing">
        {$tr("connector.firmware_flashing")}
        <MdIcon icon="expand_more" />
      </button>

      <div class="collapse" id="firmware_flashing">
        <FirmwareUpdater />
      </div>

      <button
        class="btn btn-sm btn-outline-secondary d-block w-100 mt-1"
        type="button"
        data-bs-toggle="collapse"
        data-bs-target="#tests">
        {$tr("debug.title")} <MdIcon icon="expand_more" />
      </button>

      <div class="collapse" id="tests">
        <div class="d-flex flex-wrap gap-1 mt-1">
          <button class="btn btn-sm btn-primary" onclick={startHeartbeat}>Heartbeat on</button>
          <button class="btn btn-sm btn-primary" onclick={stopHeartbeat}>Heartbeat off</button>
          <button class="btn btn-sm btn-primary" onclick={reset}>Reset</button>
        </div>
      </div>
      {/if}
    </div>

    <span class="input-group-text">
      {#if connectionType === "serial"}
        <MdIcon icon="usb" />
      {:else}
        <MdIcon icon="bluetooth" />
      {/if}
    </span>
    <span class="input-group-text {$heartbeatFails > 0 ? 'text-warning' : ''}">
      {$printerMeta?.model ?? $connectedPrinterName}
    </span>
    <span class="input-group-text">
      <MdIcon icon={batteryIcon($heartbeatData?.batteryPercents ?? $printerInfo?.batteryPercents ?? 0)} class="r-90"
      ></MdIcon>
    </span>
  {:else}
    {#if featureSupport.webBluetooth}
      <button
        disabled={$connectionState === "connecting"}
        class="btn text-nowrap {connectionType === 'bluetooth' ? 'btn-light' : 'btn-outline-secondary'}"
        onclick={() => {
          selectedFamily = "niim";
          switchConnectionType("bluetooth");
        }}>
        <MdIcon icon="bluetooth" />
        {$tr("connector.bluetooth")}
      </button>
    {/if}
    {#if featureSupport.webSerial}
      <button
        disabled={$connectionState === "connecting"}
        class="btn text-nowrap {connectionType === 'serial' ? 'btn-light' : 'btn-outline-secondary'}"
        onclick={() => {
          selectedFamily = "niim";
          switchConnectionType((connectionType = "serial"));
        }}>
        <MdIcon icon="usb" />
        {$tr("connector.serial")}
      </button>
    {/if}
    {#if featureSupport.capacitorBle}
      <button
        disabled={$connectionState === "connecting"}
        class="btn text-nowrap {connectionType === 'capacitor-ble' ? 'btn-light' : 'btn-outline-secondary'}"
        onclick={() => {
          selectedFamily = "niim";
          switchConnectionType((connectionType = "capacitor-ble"));
        }}>
        <MdIcon icon="usb" />
        Capacitor BLE
      </button>
    {/if}

    {#if webUsbSupported}
      <button
        disabled={$connectionState === "connecting"}
        class="btn text-nowrap {selectedFamily === 'dymo' ? 'btn-light' : 'btn-outline-secondary'}"
        onclick={() => {
          selectedFamily = "dymo";
          void refreshReconnectTargets();
        }}
        title={$tr("connector.dymo.hint")}>
        <MdIcon icon="usb" />
        {$tr("connector.dymo")}
      </button>
    {/if}

    {#if reconnectTargets.length > 0}
      <div class="btn-group btn-group-sm">
        <button
          type="button"
          class="btn btn-outline-success dropdown-toggle"
          data-bs-toggle="dropdown"
          aria-expanded="false"
          title={$tr("connector.reconnect")}>
          <MdIcon icon="link" />
          {reconnectTargets[0]!.name}
        </button>
        <ul class="dropdown-menu">
          {#each reconnectTargets as device (device.key)}
            <li>
              <button class="dropdown-item" onclick={() => onReconnectClicked(device)}>
                <MdIcon icon={device.transport === "bluetooth" ? "bluetooth" : "usb"} />
                {device.name}
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  {/if}

  {#if $connectionState !== "connected"}
    <button
      class="btn btn-primary"
      disabled={$connectionState === "connecting" ||
        (selectedFamily === "dymo"
          ? !webUsbSupported
          : !featureSupport.capacitorBle && !featureSupport.webBluetooth && !featureSupport.webSerial)}
      onclick={() => (selectedFamily === "dymo" ? onDymoConnectClicked() : onConnectClicked())}
      title={selectedFamily === "dymo" ? $tr("connector.dymo.hint") : $tr("connector.connect")}>
      <MdIcon icon="power" />
    </button>
  {/if}

  {#if $connectionState === "connected"}
    <button class="btn btn-danger" onclick={onDisconnectClicked}>
      <MdIcon icon="power_off" />
    </button>
  {/if}

  {#if verboseInfoShow}
    <PrinterVerboseInfo bind:show={verboseInfoShow} />
  {/if}
</div>

<style>
  .dropdown-menu {
    width: 100vw;
    max-width: 300px;
  }

  .set-dim-button {
    padding: 0 0.3rem;
    font-size: 0.875rem;
    line-height: 1.2;
  }
</style>
