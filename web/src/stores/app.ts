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
import { heartbeatSaysNewMedia } from "$/utils/printer_roll";

export const fontCache = writable<string[]>([OBJECT_DEFAULTS_TEXT.fontFamily]);
export const appConfig = writablePersisted<AppConfig>("config", AppConfigSchema, APP_CONFIG_DEFAULTS);
export const userIcons = writablePersisted<UserIcon[]>("user_icons", z.array(UserIconSchema), []);
export const userFonts = writablePersisted<UserFont[]>("user_fonts", z.array(UserFontSchema), []);
export const loadedFonts = writable<FontFace[]>([]);

export const connectionState = writable<ConnectionState>("disconnected");
export const connectedPrinterName = writable<string>("");
export const printerClient = writable<NiimbotAbstractClient>();
export const heartbeatData = writable<HeartbeatData | undefined>(undefined);
export const printerInfo = writable<PrinterInfo>();
export const rfidInfo = writable<CombinedRfidInfo>({});
/**
 * When the roll was last read, as epoch milliseconds.
 *
 * A panel showing a reading without saying how old it is will quietly show
 * yesterday's roll. `undefined` means nothing has been read this connection.
 */
export const rfidReadAt = writable<number | undefined>(undefined);
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

        // The roll goes with the printer. Keeping the last reading would
        // leave the panel describing media that is no longer in the room,
        // and the designer sizing a canvas from it.
        rfidInfo.set({});
        rfidReadAt.set(undefined);
        heartbeatData.set(undefined);
      });

      newClient.on("heartbeat", (e) => {
        heartbeatFails.set(0);

        // The heartbeat is the only thing that tells the app a roll has been
        // changed. It carries whether the lid is shut and whether the printer
        // can feel paper, roughly every two seconds, so the app can re-read
        // the tag at the moment the operator closes the lid instead of
        // waiting to be told. The manual refresh stays for printers that
        // report neither field.
        const previous = get(heartbeatData);
        heartbeatData.set(e.data);

        if (heartbeatSaysNewMedia(previous, e.data)) {
          newClient.fetchRfidInfo().catch((err: unknown) => {
            console.warn("Could not re-read the roll after it was changed", err);
          });
        }
      });

      newClient.on("rfidinfofetched", (e) => {
        rfidInfo.set(e.info);
        rfidReadAt.set(Date.now());
      });

      newClient.on("heartbeatfailed", (e) => {
        heartbeatFails.set(e.failedAttempts);
        console.warn(`Heartbeat failed ${e.failedAttempts}/${newClient.getHeartbeatMaxFails()}`);
      });
    }

    return newClient;
  });
};
