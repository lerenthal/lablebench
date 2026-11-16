/**
 * Remembering the printer across visits.
 *
 * Web Bluetooth and Web Serial grants are per-origin and per-machine. Once the
 * user has paired a printer, the browser keeps the grant and will hand the
 * device back **without** showing a picker again:
 *
 *   navigator.bluetooth.getDevices()   → previously authorised BluetoothDevices
 *   navigator.serial.getPorts()        → previously authorised SerialPorts
 *
 * That is what makes a one-click reconnect possible: the printer moves between
 * workstations, and each workstation reconnects to the device it has already
 * been granted, with no install and no re-pairing.
 *
 * This module lists those granted devices and remembers which one was last
 * used, so the UI can offer it first.
 *
 * The pointer is per-workstation and stays in the browser. A printer is a
 * workstation-scoped thing, not a shared record, so it never goes to the
 * server — the same rule the default-template pointer follows.
 */

export type GrantTransport = "bluetooth" | "serial" | "usb";

export interface GrantedDevice {
  /** Stable identity, used to match a remembered pointer back to a device. */
  key: string;
  /** Display name, e.g. "NIIMBOT B1". */
  name: string;
  transport: GrantTransport;
  /** The underlying browser object. Kept out of any serialised form. */
  handle: BluetoothDevice | SerialPort | USBDevice;
}

const LAST_DEVICE_KEY = "labelbench_last_device";

interface RememberedDevice {
  transport: GrantTransport;
  key: string;
  name: string;
}

const readRemembered = (): RememberedDevice | undefined => {
  try {
    const raw = localStorage.getItem(LAST_DEVICE_KEY);
    if (raw === null) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as RememberedDevice;
    if (
      parsed?.transport !== "bluetooth" &&
      parsed?.transport !== "serial" &&
      parsed?.transport !== "usb"
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
};

const writeRemembered = (device: RememberedDevice | undefined) => {
  try {
    if (device === undefined) {
      localStorage.removeItem(LAST_DEVICE_KEY);
    } else {
      localStorage.setItem(LAST_DEVICE_KEY, JSON.stringify(device));
    }
  } catch (e) {
    console.warn("Could not store the last-used printer", e);
  }
};

/**
 * A serial port has no id of its own. The USB ids are stable for a given
 * printer, and the index disambiguates when a machine has two identical
 * printers attached.
 */
const serialKey = (port: SerialPort, index: number): string => {
  try {
    const info = port.getInfo();
    const vid = info.usbVendorId?.toString(16) ?? "?";
    const pid = info.usbProductId?.toString(16) ?? "?";
    return `serial:${vid}:${pid}:${index}`;
  } catch {
    return `serial:unknown:${index}`;
  }
};

/**
 * A USB device's identity.
 *
 * The serial number is the only part that tells two identical printers apart,
 * and not every device reports one, so the index stands in for it.
 */
const usbKey = (device: USBDevice, index: number): string => {
  const vid = device.vendorId.toString(16).padStart(4, "0");
  const pid = device.productId.toString(16).padStart(4, "0");
  return `usb:${vid}:${pid}:${device.serialNumber ?? index}`;
};

const describeUsbDevice = (device: USBDevice): string => {
  const vid = device.vendorId.toString(16).padStart(4, "0");
  const pid = device.productId.toString(16).padStart(4, "0");
  const name = device.productName;

  return name !== undefined && name !== ""
    ? `${name} (${vid}:${pid})`
    : `USB device ${vid}:${pid}`;
};

/**
 * Every device this machine is already allowed to use.
 *
 * Returns an empty list when the transport is unavailable or the browser has
 * no grants — never throws, because a missing API is a normal state, not an
 * error.
 */
export const listGrantedDevices = async (transport: GrantTransport): Promise<GrantedDevice[]> => {
  try {
    if (transport === "bluetooth") {
      if (typeof navigator === "undefined" || navigator.bluetooth === undefined) {
        return [];
      }

      const devices = await navigator.bluetooth.getDevices();

      return devices.map((device) => ({
        key: `bt:${device.id}`,
        name: device.name ?? "Bluetooth device",
        transport,
        handle: device,
      }));
    }

    if (transport === "usb") {
      if (typeof navigator === "undefined" || navigator.usb === undefined) {
        return [];
      }

      // The browser only hands back devices this origin has been granted.
      // It cannot list devices it has not been granted — that is the point
      // of the picker — so this is the list of printers already paired with
      // this workstation, not a scan of the bus.
      const devices = await navigator.usb.getDevices();

      return devices.map((device, index) => ({
        key: usbKey(device, index),
        name: describeUsbDevice(device),
        transport,
        handle: device,
      }));
    }

    if (typeof navigator === "undefined" || navigator.serial === undefined) {
      return [];
    }

    const ports = await navigator.serial.getPorts();

    return ports.map((port, index) => ({
      key: serialKey(port, index),
      name: describeSerialPort(port, index),
      transport,
      handle: port,
    }));
  } catch (e) {
    console.warn(`Could not list granted ${transport} devices`, e);
    return [];
  }
};

const describeSerialPort = (port: SerialPort, index: number): string => {
  try {
    const info = port.getInfo();
    if (info.usbVendorId !== undefined && info.usbProductId !== undefined) {
      return `USB device ${info.usbVendorId.toString(16)}:${info.usbProductId.toString(16)}`;
    }
    if (info.usbVendorId !== undefined) {
      return `USB device ${info.usbVendorId.toString(16)}`;
    }
  } catch {
    // Some browsers throw on getInfo() for a port that has gone away.
  }
  return `USB device ${index + 1}`;
};

/**
 * Find the device that was just connected, so it can be offered first next
 * time.
 *
 * For Bluetooth the connected GATT server identifies it directly. For serial
 * there is no such signal, so the ports present before and after the picker
 * are compared: the one that is new is the one the user just granted.
 */
export const detectConnectedDevice = async (
  transport: GrantTransport,
  portsBefore: GrantedDevice[] = [],
): Promise<GrantedDevice | undefined> => {
  const granted = await listGrantedDevices(transport);

  if (transport === "bluetooth") {
    const connected = granted.find((device) => {
      const handle = device.handle as BluetoothDevice;
      return handle.gatt?.connected === true;
    });
    return connected ?? granted[0];
  }

  const known = new Set(portsBefore.map((device) => device.key));
  const fresh = granted.find((device) => !known.has(device.key));
  return fresh ?? granted[0];
};

/** Remember which printer was used last, so the UI can offer it first. */
export const rememberDevice = (device: GrantedDevice | undefined) => {
  if (device === undefined) {
    writeRemembered(undefined);
    return;
  }
  writeRemembered({ transport: device.transport, key: device.key, name: device.name });
};

/** The printer used last on this machine, if it is still granted. */
export const lastUsedDevice = async (transport: GrantTransport): Promise<GrantedDevice | undefined> => {
  const remembered = readRemembered();

  if (remembered === undefined || remembered.transport !== transport) {
    return undefined;
  }

  const granted = await listGrantedDevices(transport);
  return granted.find((device) => device.key === remembered.key);
};

/**
 * The granted devices, most-recently-used first.
 *
 * This is what the connector offers as one-click targets.
 */
export const reconnectCandidates = async (transport: GrantTransport): Promise<GrantedDevice[]> => {
  const granted = await listGrantedDevices(transport);
  const remembered = readRemembered();

  if (remembered === undefined || remembered.transport !== transport) {
    return granted;
  }

  return [...granted].sort((a, b) => {
    if (a.key === remembered.key) {
      return -1;
    }
    if (b.key === remembered.key) {
      return 1;
    }
    return 0;
  });
};
