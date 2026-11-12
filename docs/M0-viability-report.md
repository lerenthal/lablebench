# M0 — Viability report

**Goal:** from a Chromium page served over trusted HTTPS, print a test raster to
a D11 over Web Bluetooth and a B21 over Web Serial. Confirm the 96 / 384 px
widths, density and rotation.

**Status: partially verified.** The software path is verified end to end; the
two hardware transports are verified up to the point where the physical printers
must be present. This report states exactly what has been proven and what is
still open, so the next session does not repeat the software work.

---

## 1. What the audit established (software)

Read from the upstream source, not from documentation.

### Print-head widths — confirmed

`niimbluelib/src/printer_models.ts`, generated from Niimbot's own hardware list:

| Model | dpi | `printheadPixels` | density |
|---|---|---|---|
| `D11` | 203 | **96** | 1–3 (default 2) |
| `D11S` | 203 | 96 | 1–3 |
| `D110` | 203 | 96 | 1–3 |
| `D110_M` | 203 | 96 | 1–5 |
| `B21` | 203 | **384** | 1–5 (default 3) |
| `B21_L2B` | 203 | 384 | 1–5 |
| `B1` | 203 | 384 | 1–5 |

Both at 8 px/mm. The brief's "D11 = 96 px, B21 = 384 px (≈203 dpi, 8 px/mm)" is
**correct**.

> **Correction to the brief:** density is not 1–5 on both. A D11 accepts 1–3.
> LabelBench clamps the density control to the connected model's range.

### Print task selection — protocol-version dependent

`niimbluelib/src/print_tasks/index.ts`:

```ts
export const modelPrintTasks = {
  D11_V1:  [M.D11, M.D11S],
  B21_V1:  [M.B21],
  B21_L2B: [M.B21_L2B],
  D110:    [M.B21S, M.B21S_C2B, M.D110, { m: M.D11, v: 1 }, { m: M.D11, v: 2 }],
  B1:      [M.D110_M, M.B1, M.B21_C2B, M.M2_H, M.N1, M.D101],
  D110M_V4:[{ m: M.D110_M, v: 4 }, M.D11_H, M.B21_PRO, M.B1_PRO, M.C1, M.EP1C],
  H1S:     [M.H1S],
};
```

`findPrintTask(model, protocolVersion)` prefers an exact model+version match, and
falls back to `D110M_V4` for any unknown model reporting protocol version ≥ 4.

**Consequence:** a D11 reporting protocol version 1 or 2 uses the **D110** print
task, not the legacy `D11_V1` one. These use different packet framing
(`setPrintQuantity` and `printClear` vs. a per-copy loop). Which one a given
D11 unit uses is a **hardware** question — open.

### Density is sent unconditionally

`B21V1PrintTask.printInit()` sends `PacketGenerator.setDensity(density)` with no
capability check, and so does `D110PrintTask`. This is consistent with the
brief's warning that some newer B21 firmware ignores the density command: the
command is sent, and the firmware may discard it. **Cannot be distinguished
from software — needs a hardware A/B test.**

### Rotation

Rotation is not a printer command. It is applied to the raster before encoding:
`ImageEncoder.encodeCanvas(canvas, pageColor, printDirection)` with
`printDirection === "left"` rotating 90° clockwise. The width that must fit the
print head is therefore the canvas **height** when the direction is "left", and
the canvas **width** when it is "top".

LabelBench's `print_limits.ts` implements exactly that mapping, and both the
manual preview and the batch runner go through it.

### Transports

`niimbluelib/src/client/`:

| Transport | File | Notes |
|---|---|---|
| Web Bluetooth | `bluetooth_impl.ts` | `navigator.bluetooth.requestDevice()`, accepts `authorizedDevice` for one-click reconnect |
| Web Serial | `serial_impl.ts` | `navigator.serial.requestPort()`, accepts `authorizedPort` for one-click reconnect |

The library already supports the reconnect path; upstream's UI just never
exposed it. LabelBench exposes it.

---

## 2. The hardware on this desk

A NIIMBOT printer is **already plugged into this machine** over USB:

```
$ udevadm info --query=property --name=/dev/ttyACM0
ID_VENDOR=NIIMBOT
ID_MODEL=B1_LABEL_PRINTER
ID_SERIAL=NIIMBOT_B1_LABEL_PRINTER_B1-H83003154
ID_VENDOR_ID=3513
ID_MODEL_ID=0002
ID_USB_DRIVER=cdc_acm

$ lsusb
Bus 001 Device 022: ID 3513:0002 NIIMBOT B1 LABEL PRINTER
```

This is a **B1**, not a B21 — but it is the same USB profile: CDC-ACM,
VID:PID `3513:0002`, 384 px print head. It exercises the **Web Serial** path
identically to a B21. The only difference is the print task selected
(`B1` vs `B21_V1`), which affects packet framing, not transport or raster width.

The user account is already in the `dialout` group, so the browser can open
`/dev/ttyACM0` without extra setup.

---

## 3. Verified by execution

| Check | Result |
|---|---|
| API server starts, serves the SPA and the REST API | ✅ |
| `GET /api/health` | ✅ `{"status":"ok",...}` |
| SPA index and deep-link fallback | ✅ HTTP 200 |
| Template create / list / get / update / delete | ✅ |
| Version snapshot + restore | ✅ (caught and fixed a real bug — see below) |
| Asset upload + fetch | ✅ |
| API test suite | ✅ **21/21** |
| `tsc --noEmit` (server) | ✅ clean |
| `svelte-check` (SPA) | ✅ 0 errors |
| `vite build` (SPA) | ✅ built |
| Server reachable on the LAN interface (`10.10.17.185:3000`) | ✅ |
| mkcert CA created + server certificate issued | ✅ (no root needed) |
| Docker Compose build (app + Caddy) | ✅ both containers up, app healthy |
| HTTPS with a browser-trusted origin | ✅ `Verification: OK`, `Verify return code: 0` |
| The SPA wired to the server store (no template in the browser) | ✅ verified in a real browser |
| CSV batch: import → column detection → merge → preview | ✅ verified in a real browser |
| One-click reconnect to an already-granted printer | ✅ verified in a real browser |
| Print-head limit blocks an over-wide raster | ✅ `npm run check-limits`, 11 checks |
| The API key gate rejects a missing/wrong key | ✅ 7 tests + live server |
| Quick-print gallery (§5.5) | ✅ verified in a real browser |

**Bugs caught by execution, not by reading the code:**

- A version restore replayed only the canvas, so a restored template could
  carry a stale `name` and `model` next to new artwork. Every column the
  restore path writes is now snapshotted.
- The SPA still wrote templates to `localStorage` after the server was live —
  the module was imported and typechecked but never mounted. Found by driving
  the app in a browser, not by the typechecker.
- The CSV row preview drew into a canvas element that had not mounted yet, so
  it rendered blank. It now renders the raster as an image.
- "Save" inherited the open template's id and overwrote it; the list still
  showed one item, so nothing looked wrong.
- The API key gate did not gate. `isAuthorized()` was written and never
  called, so `LABELBENCH_AUTH_MODE=apikey` left the API wide open while
  looking like protection.

These are exactly the class of defect that passes every static check. Each
one was found by running the thing.

---

## 4. Open — requires the physical printers

These cannot be settled without the hardware.

### 4.1 The B1/B21 over USB (Web Serial)

- [ ] `navigator.serial.requestPort()` lists the CDC-ACM device
- [ ] The model is detected as `B1` (or `B21`) and the print task resolves
- [ ] A test raster prints, at the correct physical width
- [ ] **Density**: does the unit honour `setDensity`? Run the same raster at
      density 1 and 5 and compare. This is the brief's open question about
      newer B21 firmware.
- [ ] Rotation: `printDirection = "left"` lands the label the right way up

### 4.2 The D11 over Bluetooth

Requires the D11 on the **other** workstation, with Bluetooth enabled there.

- [ ] `navigator.bluetooth.requestDevice()` lists the D11
- [ ] The model is detected as `D11`, and the print task resolves —
      **this is the real open question**: does it use `D11_V1` or `D110`?
      That depends on the unit's protocol version, and the two use different
      packet framing.
- [ ] A test raster prints at 96 px width
- [ ] Density 1–3 (the D11's actual range)

### 4.3 Environment notes for the workstations

| Item | Status |
|---|---|
| Chrome 157 on this machine | ✅ installed |
| `bluetooth` service on this machine | ⚠️ **inactive** — `sudo systemctl enable --now bluetooth` if the D11 is tested here |
| User in `dialout` group (serial access) | ✅ |
| Chrome on Linux may need `chrome://flags/#enable-experimental-web-platform-features` for Web Serial | try without it first; it is shipped by default in recent Chrome |
| mDNS | ✅ `labelbench.local` → `10.10.17.185` (avahi restricted to the LAN interface) |

---

## 5. Network and packaging — resolved

- [x] **mDNS conflict.** `yaniv-OptiPlex-7050.local` resolved to the docker
      bridge `172.23.0.1` because avahi published every interface. Fixed by
      restricting avahi to the LAN interface (`allow-interfaces=enp0s31f6`) and
      publishing under `host-name=labelbench`, so `labelbench.local` resolves
      to `10.10.17.185` without renaming the machine.
- [x] **Firewall** — 80 and 443 are open to the LAN subnet `10.10.17.0/24`.
- [x] **Trusted origin** — the mkcert root CA is installed in the system trust
      store, and the server publishes it at `https://labelbench.local/rootCA.pem`
      so a workstation fetches it with one command and checks its SHA-256
      fingerprint before trusting it.
- [x] **Docker Compose build** of the app + Caddy image; both containers up,
      the app healthy, the origin verified.
- [ ] **Two-workstation acceptance test** (§10 of the brief): two Chromium
      workstations open the central URL, connect the moved printer with one
      click, and print a manual label and a CSV batch — zero local install,
      zero template copying.

### The one that bit

`sudo mkcert -install` installs the **wrong** CA. Under `sudo`, `HOME` becomes
`/root`, so mkcert looks in a different CAROOT, finds no CA, **creates a
second one** and installs that instead. The workstation then trusts a CA that
never signed the server certificate, and the browser still shows a warning.

Install the CA by copying `rootCA.pem` directly:

```bash
sudo cp ~/.local/share/mkcert/rootCA.pem /usr/local/share/ca-certificates/labelbench-rootCA.crt
sudo update-ca-certificates
```

`scripts/setup-certs.sh` and the README now print only this form.
