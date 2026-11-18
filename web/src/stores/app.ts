import { derived, get, readable, writable } from "svelte/store";
import {
  AppConfigSchema,
  UserFontSchema,
  UserIconSchema,
  type UserFont,
  type UserIcon,
  type AppConfig,
  type AutomationProps,
  type ConnectionState,
  type ConnectionType,
} from "$/types";
import {
  CombinedRfidInfo,
  RequestCommandId,
  ResponseCommandId,
  Utils,
  instantiateClient,
  type HeartbeatData,
  type NiimbotAbstractClient,
  type PrinterInfo,
  type PrinterModelMeta,
  createPrinterInfo,
} from "@mmote/niimbluelib";
import { LocalStoragePersistence, writablePersisted } from "$/utils/persistence";
import { APP_CONFIG_DEFAULTS, OBJECT_DEFAULTS_TEXT } from "$/defaults";
import z from "zod";
import { FileUtils } from "$/utils/file_utils";
import { connectedPrinterFor } from "$/utils/printer_profile";

export const fontCache = writable<string[]>([OBJECT_DEFAULTS_TEXT.fontFamily]);
export const appConfig = writablePersisted<AppConfig>("config", AppConfigSchema, APP_CONFIG_DEFAULTS);
export const userIcons = writablePersisted<UserIcon[]>("user_icons", z.array(UserIconSchema), []);
export const userFonts = writablePersisted<UserFont[]>("user_fonts", z.array(UserFontSchema), []);
export const loadedFonts = writable<FontFace[]>([]);

export const connectionState = writable<ConnectionState>("disconnected");
export const connectedPrinterName = writable<string>("");
export const printerClient = writable<NiimbotAbstractClient>();
export const heartbeatData = writable<HeartbeatData>();
export const printerInfo = writable<PrinterInfo>();
export const rfidInfo = writable<CombinedRfidInfo>({});
export const printerMeta = writable<PrinterModelMeta | undefined>();

/**
 * What the connected printer is and what it can do.
 *
 * Derived from the printer's own model id, so the app knows which printer it
 * is talking to without being told.
 */
export const printerProfile = derived(printerMeta, ($printerMeta) => connectedPrinterFor($printerMeta));
export const heartbeatFails = writable<number>(0);
/**
 * Who is at this workstation.
 *
 * Persisted per browser, because that is all it can honestly be: the app has
 * no users to authenticate, so this is a name the lab types once on the
 * machine beside the printer. It reaches the label as `{operator}`.
 */
export const operatorName = writablePersisted<string>("operator_name", z.string().max(64), "");

// The design-time CSV textarea used to persist its contents here, and the
// print preview ran its own batch from them. Both are gone: one CSV is
// loaded into `csvSource` and every path reads that. The key is cleared so a
// stale spreadsheet from before the change cannot sit in localStorage
// forever with nothing able to show it.
try {
  localStorage.removeItem("csv_params");
} catch {
  // A browser with storage blocked has nothing to clear.
}
export const dimensionsUpdateRequest = writable<{width: number, height: number} | null>(null);

userFonts.subscribe(FileUtils.loadFonts);

export const automation = readable<AutomationProps | undefined>(
  (() => {
    try {
      return LocalStoragePersistence.loadAutomation() ?? undefined;
    } catch (e) {
      console.error(e);
    }
    return undefined;
  })(),
);

export const initClient = (connectionType: ConnectionType) => {
  printerClient.update((prevClient: NiimbotAbstractClient) => {
    let newClient: NiimbotAbstractClient = prevClient;

    if (connectionType !== prevClient?.getType()) {
      if (prevClient !== undefined) {
        prevClient.disconnect();
      }

      newClient = instantiateClient(connectionType);

      const conf = get(appConfig);

      if (conf.packetIntervalMs !== undefined) {
        newClient.setPacketInterval(conf.packetIntervalMs);
      }

      newClient.on("packetsent", (e) => {
        console.log(`>> ${Utils.bufToHex(e.packet.toBytes())} (${RequestCommandId[e.packet.command]})`);
      });

      newClient.on("packetreceived", (e) => {
        console.log(`<< ${Utils.bufToHex(e.packet.toBytes())} (${ResponseCommandId[e.packet.command]})`);
      });

      newClient.on("connect", (e) => {
        heartbeatFails.set(0);
        connectionState.set("connected");
        connectedPrinterName.set(e.info.deviceName ?? "unknown");
      });

      newClient.on("printerinfofetched", (e) => {
        printerInfo.set(e.info);
        printerMeta.set(newClient.getModelMetadata());
      });

      newClient.on("disconnect", () => {
        connectionState.set("disconnected");
        connectedPrinterName.set("");
        printerInfo.set(createPrinterInfo());
        printerMeta.set(undefined);
      });

      newClient.on("heartbeat", (e) => {
        heartbeatFails.set(0);
        heartbeatData.set(e.data);
      });

      newClient.on("rfidinfofetched", (e) => {
        rfidInfo.set(e.info);
      });

      newClient.on("heartbeatfailed", (e) => {
        heartbeatFails.set(e.failedAttempts);
        console.warn(`Heartbeat failed ${e.failedAttempts}/${newClient.getHeartbeatMaxFails()}`);
      });
    }

    return newClient;
  });
};
