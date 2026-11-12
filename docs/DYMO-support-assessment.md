# DYMO support in LabelBench — assessment

## The recommendation

**Build it. The lab's LabelWriter 450 over USB is the good case, and it is now
built.**

The transport turned out to be the easy part. There is a maintained,
MIT-licensed, TypeScript driver suite with a **browser WebUSB** package, and
it needs exactly the environment LabelBench already has — Chrome or Edge,
and a page served over HTTPS. That is the same requirement as Web Bluetooth
and Web Serial, which the app already depends on. No vendor driver, no
native helper, no cloud call.

The 450 is the right model in the driver suite: it has **no NFC media lock**
(unlike the 550 and 5XL), so ordinary DYMO rolls print, and it is a plain
USB device. The one thing to know is that the driver lists the 450 as
*expected* rather than *verified* — which is exactly what the bench test
below settles.

### What was built

The LabelWriter path is implemented and deployed:

- **A `dymo450` model** beside D11 and B21, with the head width (672 dots
  at 300 dpi, which is 456 pixels at the app's native 8 px/mm).
- **The label sizes, taken from the driver's own media registry** — 20 of
  them, from "19×10mm Price Tag (2-up)" to "102×57mm Name Badge". Nothing is
  typed in by hand: the registry knows the length of every roll in dots, and
  the app works out the printable size from it.
- **A WebUSB connection** in the printer connector. The browser's USB picker
  opens from a button, the way the Bluetooth and serial connections do.
- **A print path** that renders the label at the LabelWriter's own 300 dpi
  and composes it into the bitmap the driver asks for: the full width of the
  print head, the printable length of the media, the label centred across
  the head.

### The resolution question, answered

The question was whether 300 dpi was wanted. It turns out it does **not**
require a change to the template format, and this was the finding that
changed the estimate.

The label stays in canvas pixels at 203 dpi. At print time it is *re-rendered*
at the head's resolution — the text is laid out and rasterised afresh at 300
dpi, not enlarged from a 203 dpi bitmap — and then composed into the bitmap
the driver expects. So the NIIMBOT keeps its 203 dpi exactly as it was, and
the LabelWriter gets the resolution it is capable of, without a migration
and without changing a single stored template.

### What is not done, and what the bench test has to settle

1. **The CSV batch runner still prints through the NIIMBOT path.** The
   manual print path is the LabelWriter's; the batch runner is not yet
   wired to it. A batch on a LabelWriter needs the same treatment the
   manual path has had.
2. **The geometry has never run against hardware.** Two numbers are
   derived from the driver's registry rather than measured: the 6 mm
   leading dead zone at the start of the media, and the fact that a label
   narrower than the head is centred across it. Both are in one place —
   `web/src/utils/dymo.ts` — so a correction is a one-line change. The
   first print is expected to be off by a few millimetres in the feed
   direction, and the test below says what to look at.
3. **The 450 is listed as *expected*, not *verified*, by the driver.** The
   bench test is what promotes it.

### The bench test

One session at the bench with the 450 plugged into a workstation:

1. Open the app, pick **Dymo 450** as the model, and choose the media that
   matches the roll in the printer — the sizes are named after the roll.
2. Connect the printer: **LabelWriter** in the app bar, then pick the device
   in the browser's USB dialog.
3. Design something small — a batch number and a date, at a readable size.
4. **Print preview** first, to see the raster, then **Print** one copy.
5. Look at the label: is it the right size, is it centred across the head,
   and is it the right distance from the leading edge? If it is offset along
   the roll, the dead zone in `dymo.ts` is the number to change.

The full path — the USB picker, the connection, the model, the sizes — is
already in place, so the test is about the geometry, not about plumbing.

---

## 1. Which DYMO printers are worth supporting

| Model | Print head | Resolution | Colour | Notes |
|---|---|---|---|---|
| LabelWriter 450 series | 57 mm, 672 dots | 300 dpi across the head, 300 or 600 dpi in travel | monochrome | Vendor tech reference |
| LabelWriter 550 / 550 Turbo | 672 dots | 300 dpi | monochrome | NFC-locked media |
| LabelWriter 5XL | not verified here | not verified here | monochrome | USB + TCP |
| LabelWriter 400 series | not verified here | not verified here | monochrome | verified in the driver suite |
| LabelWriter Wireless | not verified here | not verified here | monochrome | USB + TCP |

**LabelWriter 450 series** — the vendor's own technical reference says the
"57 mm wide thermal print head uses 672 individually addressable dots to form
individual raster lines of data at 300 dots per inch across the print head
and either 300 or 600 dots per inch in the travel direction". It is a
raster-based printer: the host sends image rows, not a label language. The
same document is explicitly written as "a reference to knowledgeable
developers wishing to communicate directly with the LabelWriter printer
without the use of printer drivers", and it documents the USB vendor and
product IDs.
Source: <https://download.dymo.com/dymo/technical-data-sheets/LW%20450%20Series%20Technical%20Reference.pdf>

**LabelWriter 550** — the driver's hardware page records "672 dots @ 300 dpi",
USB VID `0x0922` / PID `0x0028`, and media "Pre-cut die-cut labels —
NFC-locked DYMO-genuine media required".
Source: <https://thermal-label.github.io/hardware/labelwriter/lw-550>

**Colour** — not one of the models above is a colour printer. DYMO's own
product comparison lists only monochrome LabelWriter features, and the
LabelWriter 450 technical reference describes a thermal head that
"blackens the thermally sensitive label material". All are 1-bit output,
which is the same as NIIMBOT and therefore good news for the raster path.

**Not verified:** the head width and resolution of the 5XL, the 400 series
and the Wireless. The 5XL has no public technical reference that was
reachable; it would have to be read off the hardware.

### The important negative finding

The maintained driver suite lists 22 devices. It contains the LabelWriter
4XL, 5XL, 300, 310, 330, 330 Turbo, 400, 400 Turbo, 450, 450 Duo, 450
Turbo, 450 Twin Turbo, 550, 550 Turbo, Duo-96, Duo-128, EL40, EL60, SE450,
Turbo, Twin Turbo and Wireless.

It does **not** contain the **LabelWriter Connect** or the **LabelWriter
5S** — the two consumer-oriented models most likely to be in a lab.
Source: <https://github.com/thermal-label/labelwriter>

---

## 2. The browser printing paths, and what each one demands

### Path A — WebUSB via an open-source driver suite (the viable one)

`thermal-label/labelwriter` is a "TypeScript-first DYMO LabelWriter label
printer driver suite — Node.js USB/TCP, browser WebUSB, and CLI", MIT
licensed, with commits as recent as October 2026. It publishes two packages
that matter here:

- `@thermal-label/labelwriter-core` — protocol encoding, device and media
  registries, runs in browser and Node
- `@thermal-label/labelwriter-web` — the **browser WebUSB transport**

Its own requirements line reads: "Browsers: Chrome / Edge 89+, secure
context (`https://` or `localhost`)". The browser example is three lines:

```js
import { requestPrinter } from '@thermal-label/labelwriter-web';
import { MEDIA } from '@thermal-label/labelwriter-core';
const printer = await requestPrinter(); // call from a user gesture
await printer.print(image, MEDIA.ADDRESS_STANDARD);
```

**Hard requirements:** Chrome or Edge 89+, a secure context, and the printer
plugged into the workstation. **No driver, no native helper, no account, no
internet.** This is the same shape as the NIIMBOT path LabelBench already
uses — Web Bluetooth and Web Serial — so it fits the existing architecture
rather than bending it.

One caveat from the suite's own README: "LabelWriter 550 / 5XL users: These
models enforce an NFC label lock — only genuine DYMO labels will print. This
is a hardware restriction that cannot be bypassed."

Source: <https://github.com/thermal-label/labelwriter>

### Path B — the vendor's DYMO Connect Framework (blocked)

`DYMO.Connect.Framework` is the vendor's own JavaScript SDK. Its README
begins with the blocker: it requires **DYMO Connect Software installed** —
there are Windows and Mac installers linked at the top of the page — and the
SDK talks to that local service.

**Hard requirement:** the DYMO Connect desktop application installed and
running on every workstation that prints. For a lab that wants to open a URL
on a shared server, that is a per-machine install and a per-machine
process, and it is exactly the coupling LabelBench was built to avoid.

Source: <https://github.com/dymosoftware/dymo-connect-framework>

### Path C — the DYMO Web Service (cloud)

There is a "DYMO Web Service" that the vendor's SDKs target, and at least
one TypeScript client for it exists (`apenab/dymo-print-suite`, described as
a "TypeScript-first toolkit to interact with DYMO LabelWriter printers via
the DYMO Web Service").

**Hard requirements:** a developer account and API credentials, and an
internet round trip to dymo.com for every label. Two problems for this
app: the lab's design runs on a LAN with no external dependency, and label
content — sample IDs, batch numbers, expiry dates — would leave the
building on every print. In a GMP facility that is a data-residency
question, not a technical one.

Source: <https://github.com/apenab/dymo-print-suite>

### Path D — the vendor's own SDKs

The vendor's developer page offers the "DYMO Label v8 Software Developer's
Kit" as a **Windows installer**. There is no Linux build, and the page's own
framing — "resolutions, margins, custom page sizes, and all the other
complexities of printing" — is about laying out a label document, which is
what LabelBench already does better.

Source: <https://www.dymo.com/support?cfid=online-support-sdk>

### Summary of blockers

| Path | Driver needed | Native helper | Account | Internet | Viable for LabelBench |
|---|---|---|---|---|---|
| A. WebUSB + open driver | no | no | no | no | **yes** |
| B. DYMO Connect Framework | no | **yes** | no | no | no |
| C. DYMO Web Service | no | no | **yes** | **yes** | no |
| D. Vendor SDK | **yes** | yes | no | no | no |

---

## 3. The rendering path — where the real work is

The driver takes a raster, not a label language:

```js
// image is RawImageData — { width, height, data } where data is RGBA bytes.
await printer.print(image, MEDIA.ADDRESS_STANDARD);
```

So the transport is not where DYMO differs from NIIMBOT. The **resolution**
is.

### The dpi mismatch, stated precisely

LabelBench's label canvas is in **device pixels at 203 dpi** — 8 px/mm. A
57 mm-wide label on the 450 series is therefore 456 canvas pixels wide.

The 450 and 550 print heads are 672 dots wide at 300 dpi, which is also
57 mm. The same physical label is therefore **672 dots** on the DYMO and
**456 canvas pixels** in LabelBench. The ratio is 300 ÷ 203 = **1.478**.

Two ways to bridge it, and one of them is wrong:

- **Scale the raster up by 1.478.** Simple, and it produces a visibly
  softer label: the canvas was rendered at 203 dpi with hinting and font
  rasterisation at that size, and enlarging the pixels cannot put back the
  detail a 300 dpi print head could have carried. For 6 pt batch numbers
  this is the difference between legible and not.
- **Re-render the label at the printer's native resolution.** The canvas is
  created at a size, so it can be created at 672 × N instead of 456 × N,
  with the design scaled and the text rendered afresh at 300 dpi. This is
  correct, and it is also the change with teeth.

### What that change actually touches

The label's pixel size is not only a canvas property. It is stored in the
template:

- `LabelProps.size` is `{ width, height }` in canvas pixels, and the
  template carries it.
- Object positions, font sizes and `strokeWidth` are all in canvas pixels.
- `print_limits.ts` compares the raster width against the print head width
  **in pixels** — 96 px for the D11, 384 px for the B21.

So a DYMO printer at 300 dpi cannot simply be added as another entry in a
model table: the whole design would have to be expressed in **physical units
(millimetres)** and rasterised per printer, with the canvas pixel size
derived from the printer's dpi.

That is a change to the template format and to the preview and export paths.
It is a good change — a template stored in millimetres would be printer-
agnostic — but it is a migration, and it is the largest single piece of work
in this assessment. It would also fix a latent awkwardness in the current
app: today a template is tied to a dpi because the pixels are baked in.

### Media, and the NFC lock

The driver takes a **media** argument (`MEDIA.ADDRESS_STANDARD` and
others), and the LW 550 hardware page lists specific genuine media with
their article numbers. The printer auto-detects the loaded media, and on
NFC-locked models "the NFC-defined length is authoritative — host claims to
print at a different length are silently overridden". That is worth knowing
before writing the batch path: the app must not assume the requested length
is what will be printed.

---

## 4. A staged plan

**Stage 1 — prove the transport (a hardware spike).**
Add `@thermal-label/labelwriter-web` to a throwaway page served from
LabelBench's existing HTTPS origin. Call `requestPrinter()`, print a
generated raster with the lot number on it. Success is one label out of the
printer.
*Uncertain:* whether the browser in this lab's workstation has WebUSB
enabled and whether the printer enumerates over USB without a driver.
*Needs:* a DYMO plugged into a workstation with Chrome.
*Cost:* half a day, and it de-risks everything else.

**Stage 2 — the raster path.**
Render the fabric.js canvas to `RawImageData` at the printer's dpi. This
turns on stage 4's decision: if the label stays in pixels at 203 dpi, stage
2 is a one-hour scaling job and the output is soft. If the label moves to
millimetres, stage 2 is the migration and it is the bulk of the work.
*Uncertain:* how much text legibility suffers at each.

**Stage 3 — media, head limits and status.**
Map the DYMO media registry into the app's media selection; port the
print-head width checks into `print_limits.ts` so a DYMO raster wider than
672 dots is refused the same way an over-wide NIIMBOT raster is; surface the
NFC length override so the app does not claim a length it did not get.
*Uncertain:* how many media types the lab actually uses.

**Stage 4 — the model selection in the UI.**
Add the DYMO models beside D11 and B21, with their own sizes, their own dpi
and their own media. This is the same work as the NIIMBOT model selection,
and it should reuse `MODEL_LABEL_PRESETS` rather than add a second list.

Stages 1 and 3 are each a day's work. **Stage 2 is the one that decides the
project**, and it should not start before stage 1 has proved the transport.

---

## 5. What to check before deciding

One question settles most of it:

> **Which DYMO is in the lab, and how is it connected?**

- **LabelWriter 450 / 550 / 5XL / Wireless, over USB** → path A works, and
  the work is worth doing after the NIIMBOT path is proven. For the 550 and
  5XL, add "we must buy genuine NFC-locked media" to the budget.
- **LabelWriter Connect or 5S** → there is no browser path in the driver
  suite, and the alternatives need either the DYMO Connect desktop software
  on every workstation or a cloud round trip that sends label content off
  site. **The honest answer is that DYMO support is not feasible for that
  hardware**, and the effort is better spent on the NIIMBOT machines the lab
  already has.
- **No DYMO at all yet** → do not build it. Find out whether the lab is
  about to buy one, and if so, buy the USB-connected desktop models, which
  are the ones with a browser path.

A second question, worth asking at the same time: **is 300 dpi actually
wanted?** The NIIMBOT B21 prints at 203 dpi and produces perfectly legible
labels. If the DYMO is wanted for its connectivity rather than its
resolution, the resolution mismatch — the expensive part — may not need
solving at all.

> **Answered.** 300 dpi is not wanted, and it does not need to be bought: the
> label is re-rendered for whichever head is going to burn it, so the
> NIIMBOT stays at 203 dpi and the LabelWriter gets 300 dpi, with no
> migration in between.

---

## Sources

- <https://download.dymo.com/dymo/technical-data-sheets/LW%20450%20Series%20Technical%20Reference.pdf>
- <https://github.com/thermal-label/labelwriter>
- <https://thermal-label.github.io/hardware/labelwriter/lw-550>
- <https://github.com/dymosoftware/dymo-connect-framework>
- <https://github.com/apenab/dymo-print-suite>
- <https://www.dymo.com/support?cfid=online-support-sdk>
- <https://dymo.com/labelwriter.html>
