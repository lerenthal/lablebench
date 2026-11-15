/**
 * Working out which serial port a printer is on.
 *
 * A NIIMBOT on USB appears as a serial port, but so do the machine's own
 * ports — `ttyS0` and `ttyS1` are the motherboard's RS-232 connectors, and
 * they show up in the browser's port picker alongside the printer. Picking
 * the wrong one gives an error that says nothing about which port was the
 * right one.
 *
 * A printer answers the connection handshake, so it can be recognised: the
 * port that answers is the printer, and the handshake carries the model.
 * The ports that stay silent are not printers.
 */

import { NiimbotSerialClient, getPrinterMetaById } from "@mmote/niimbluelib";
import type { GrantedDevice } from "$/services/device_grants";

export interface PortIdentity {
  /** The port's key, as the grant list uses it. */
  key: string;
  /** What the port is: a printer model, or that it is not a printer. */
  label: string;
  /** Whether a printer answered on this port. */
  isPrinter: boolean;
}

/**
 * Ask each granted port whether a printer is on it.
 *
 * Each port is opened, asked to identify itself, and closed again. A port
 * that is not a printer simply does not answer, so it is reported as such
 * rather than as a failure.
 */
export const identifySerialPorts = async (
  ports: GrantedDevice[],
): Promise<PortIdentity[]> => {
  const results: PortIdentity[] = [];

  for (const port of ports) {
    const handle = port.handle as SerialPort;

    try {
      const client = new NiimbotSerialClient();
      await client.connect({ authorizedPort: handle });

      const info = await client.fetchPrinterInfo();
      // The model library knows the printers by their numeric id.
      const model =
        info.modelId !== undefined
          ? (getPrinterMetaById(info.modelId)?.model ?? `printer ${info.modelId}`)
          : "printer";

      results.push({
        key: port.key,
        label: `${model} — serial ${info.serial ?? "?"}`,
        isPrinter: true,
      });

      await client.disconnect();
    } catch {
      results.push({
        key: port.key,
        label: "not a printer",
        isPrinter: false,
      });
    }
  }

  return results;
};

/**
 * What to say when the chosen port turned out not to have a printer on it.
 *
 * The useful part is which of the other ports does, so the user is not left
 * guessing through the picker again.
 */
export const describeWrongPort = (identities: PortIdentity[]): string | undefined => {
  const printers = identities.filter((identity) => identity.isPrinter);

  if (printers.length === 0) {
    return undefined;
  }

  return `The printer is on ${printers.map((printer) => printer.label).join(", ")}.`;
};
