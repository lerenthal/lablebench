# LabelBench

A self-hosted label-design web app with **browser-direct** printing to NIIMBOT
printers.

One installation on a central lab server. Any Chromium browser on the LAN opens
it, designs or opens shared label templates, and prints to a NIIMBOT printer
**physically plugged into that same workstation** — over Web Bluetooth (D11) or
Web Serial (B21/USB).

The printer moves. The templates do not: they live on the server, so every
station sees the same library and nothing is copied between machines.

```
   workstation A                          central server                workstation B
 ┌────────────────┐                      ┌─────────────┐               ┌────────────────┐
 │ Chromium       │  https://labelbench  │ SPA + REST  │               │ Chromium       │
 │  + Web Serial  │◄────────────────────►│ API         │               │  + Web Bluetooth│
 │  + Web Bluetooth│   (trusted origin)  │ SQLite      │               │                │
 │                │                      │ assets/     │               │                │
 │  ┌──────────┐  │                      └─────────────┘               │  ┌──────────┐  │
 │  │ NIIMBOT  │  │                                                    │  │ NIIMBOT  │  │
 │  │ printer  │  │                      templates + assets             │  │ printer  │  │
 │  └──────────┘  │                        shared                      │  └──────────┘  │
 └────────────────┘                                                    └────────────────┘
```

The server never touches a printer.

---

## Contents

- [What it does](#what-it-does)
- [Requirements](#requirements)
- [Install](#install)
- [Certificate setup](#certificate-setup)
- [Trusting the CA on a workstation](#trusting-the-ca-on-a-workstation)
- [Adding the printer on a new workstation](#adding-the-printer-on-a-new-workstation)
- [Designing a template](#designing-a-template)
- [Running a CSV batch](#running-a-csv-batch)
- [Backup and restore](#backup-and-restore)
- [Bare systemd deployment](#bare-systemd-deployment)
- [Development](#development)
- [Project layout](#project-layout)

---

## What it does

**Phase 1 (built):**

- Drag-and-drop label designer — text, barcode (20 1-D symbologies), QR, image,
  rectangle, line, date/time insert
- Live **1-bit** print preview — the actual rendering that reaches the print head,
  not just the on-screen design
- Central template library on the server, shared by every workstation, with tags,
  duplication and version history
- **CSV batch printing** — import a CSV, bind its columns to the template's
  variables, preview the merged rows, then print them one after another with
  progress, per-row success/failure, pause and cancel
- Quick-print gallery for templates with no variables
- Per-job copies, density, 90° rotation and dithering mode

**Not in Phase 1 (designed for, not built):** server-side printing, a database-app
"print button" API, Dymo LabelWriter 450 support, non-Chromium browsers.

---

## Requirements

**Server** — Ubuntu/Debian x86-64 (mini-PC, NUC or VM), 2 GB RAM, Docker with the
Compose plugin. `amd64`.

**Workstations** — Chromium-based browser only (Chrome or Edge). Firefox and
Safari cannot do Web Bluetooth or Web Serial. No software is installed on a
workstation; the only per-machine steps are trusting the CA once and granting
the printer once.

**Printers** — a NIIMBOT D11 (BLE, 96 px print head) or a B21 / B1 (USB CDC-ACM,
384 px print head).

---

## Install

```bash
git clone <this repo> labelbench
cd labelbench

cp .env.example .env
$EDITOR .env            # set LABELBENCH_HOST

./scripts/setup-certs.sh # creates the internal CA and the server certificate
docker compose up -d --build
```

`docker compose up` brings up:

- **app** — the LabelBench API server (Fastify + SQLite) and the SPA
- **caddy** — TLS termination on :443, proxying to the app

The whole data set is two things: `labelbench-data` (a Docker volume holding
`labelbench.db` and `assets/`) and the Caddy volumes.

Check it:

```bash
curl -k https://labelbench.local:8443/api/health
# {"status":"ok","service":"labelbench-server",...}
```

### Turning on an API key (optional)

Phase 1 runs **open on the trusted LAN** — that is the locked decision, and
no login is required. But the data access sits behind a thin service layer so
that a gate can be added later without touching the API or the editor. It is
a real gate, not a stub: flip the switch and the API rejects everything that
does not carry the key.

```bash
# .env
LABELBENCH_AUTH_MODE=apikey
LABELBENCH_API_KEY=<a long random string>
docker compose up -d
```

Then, on each workstation, click the **key** icon in the app footer and paste
the key. It is stored in that browser only. Health stays open so a probe can
check liveness without a credential.

> Do not enable this over plain HTTP on a shared network — the key would go
> out in clear text. Use it behind the HTTPS origin above.

> **HTTPS is not optional.** `navigator.bluetooth` and `navigator.serial` only
> exist in a *secure context*. Over plain HTTP the APIs are simply absent, and
> clicking through a self-signed certificate warning is not reliable enough to
> build on. A browser-trusted origin is a hard requirement.

---

## Certificate setup

The LAN is offline, so there is no domain and no ACME. Instead, `mkcert` creates
a **local root CA** and a server certificate for your hostname, and every
workstation trusts that root once.

```bash
./scripts/setup-certs.sh                      # uses LABELBENCH_HOST from .env
./scripts/setup-certs.sh labelbench.local 10.10.17.185   # or name it explicitly
```

This produces:

| File | Where | Purpose |
|---|---|---|
| `deploy/caddy/certs/labelbench.pem` | server | certificate handed to Caddy |
| `deploy/caddy/certs/labelbench-key.pem` | server | private key (keep it secret) |
| `~/.local/share/mkcert/rootCA.pem` | server | **the root CA — copy this to workstations** |

Re-run the script whenever the hostname or IP changes; it reuses the existing CA.

The hostname should be one the LAN can resolve. Options, in order of preference:

1. **mDNS** — `labelbench.local`, resolved by Chrome's built-in mDNS resolver on
   every platform. No per-machine DNS configuration at all.
2. **A hosts-file entry** on each workstation pointing `labelbench.lab.local` at
   the server's IP.
3. **The server's address directly** — `https://10.10.17.185:8443/`. The certificate
   carries the IP as a SAN and the server answers on both, so this works even
   when the name does not resolve. A browser sends no SNI for an IP address,
   which is why the Caddyfile gives the site a bare `:443` address: without it
   the TLS handshake fails with "internal error" instead of choosing a
   certificate.
4. **A real DNS record**, if the lab has one.

The certificate already carries every name you are likely to use
(`labelbench.local`, `labelbench`, the machine's own mDNS name, the LAN IP,
`localhost`), so you can decide later without reissuing.

---

## Trusting the CA on a workstation

One time per machine. The server publishes its root CA at
`https://labelbench.local:8443/rootCA.pem`, so a new workstation needs no `scp` and
no file handoff — just a download.

**Linux**

```bash
curl -k https://labelbench.local:8443/rootCA.pem -o rootCA.pem

# Check it before you trust it. It must print exactly:
#   sha256 Fingerprint=F4:E5:16:F1:25:B8:19:14:0B:96:9F:AC:A0:E8:D3:BD:1C:95:7E:DF:85:58:DA:60:64:4A:8A:78:41:13:9E:55
openssl x509 -in rootCA.pem -noout -fingerprint -sha256

sudo cp rootCA.pem /usr/local/share/ca-certificates/labelbench-rootCA.crt
sudo update-ca-certificates
```

The `-k` on the download is unavoidable — the workstation does not trust the
CA yet, that is the whole point of the step. The fingerprint check is what
makes it safe: it proves you fetched the CA you were meant to fetch. The
fingerprint above is the one in this lab's CA.

If the workstation cannot resolve `labelbench.local` (mDNS does not always
cross switches), use the server's address instead — the certificate carries
it as an IP SAN and the server answers on both:

```bash
curl -k https://10.10.17.185:8443/rootCA.pem -o rootCA.pem
```

**Windows** (PowerShell, administrator)

```powershell
curl.exe -k https://labelbench.local:8443/rootCA.pem -o rootCA.cer

# Check the CERTIFICATE's fingerprint, not the file's hash.
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 ".\rootCA.cer"
($cert.GetCertHashString("SHA256") -replace '(..)(?=.)','$1:').TrimEnd(':')
# must print exactly:
#   F4:E5:16:F1:25:B8:19:14:0B:96:9F:AC:A0:E8:D3:BD:1C:95:7E:DF:85:58:DA:60:64:4A:8A:78:41:13:9E:55

Import-Certificate -FilePath .\rootCA.cer -CertStoreLocation Cert:\LocalMachine\Root
```

> `certutil -hashfile rootCA.pem SHA256` is **not** the check you want: it
> hashes the downloaded file, which is not the certificate's fingerprint, so it
> will never match the value above even when the CA is the right one. The
> `.cer` extension matters too — the Windows certificate import dialog does
> not always recognise a `.pem` file.

**macOS**

```bash
curl -k https://labelbench.local:8443/rootCA.pem -o ~/Downloads/rootCA.pem
openssl x509 -in ~/Downloads/rootCA.pem -noout -fingerprint -sha256
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain ~/Downloads/rootCA.pem
```

> **Do not use `sudo mkcert -install` for this.** Under `sudo`, `HOME` becomes
> `/root`, so mkcert looks in a different CAROOT, finds no CA, **creates a second
> one** and installs that instead. The workstation would then trust a CA that
> never signed the server certificate, and the browser would still show a
> certificate warning. Copying `rootCA.pem` directly avoids the problem
> entirely. `scripts/setup-certs.sh` prints the correct commands.

Then open `https://labelbench.local:8443` — the lock icon should be normal, not a
warning. That matters beyond cosmetics: Web Bluetooth and Web Serial only
exist in a browser-trusted secure context, so an untrusted certificate makes
printing unavailable entirely.

### Changing the TLS configuration

Caddy runs with `--watch`, so editing `deploy/caddy/Caddyfile` and saving is
enough — it reloads itself within a second or two. No restart, no dropped
connections.

```bash
docker compose logs -f caddy     # watch it reload
```

Two things about the mount are deliberate and worth not undoing:

- **The whole `deploy/caddy` directory is mounted, not the Caddyfile alone.**
  A bind mount of a single file pins the inode the container sees. An editor
  that replaces the file rather than rewriting it in place — write to a temp
  file, then rename — gives it a new inode, and the container keeps serving
  the old configuration with no error anywhere. Mounting the directory means
  the container re-reads the directory entry and sees the replacement.
- **The certificates sit next to the Caddyfile** in `deploy/caddy/certs/`, so
  re-running `scripts/setup-certs.sh` is picked up by the same reload. The
  private key is never served — only `rootCA.pem`, the CA's public
  certificate, is reachable at `/rootCA.pem`.

---

## Opening LabelBench from another workstation

The server is reachable on the LAN and has been since it was deployed:
Caddy publishes on every interface, and the firewall allows the LAN subnet.
Nothing needs to be installed on the workstation beyond trusting the CA above.

### The ports

| Port | Purpose |
|---|---|
| **8443** | HTTPS — this is the origin the workstations open |
| **8082** | HTTP, which exists only to redirect to HTTPS |

LabelBench deliberately does **not** take 80 and 443. This host runs several
apps, and the standard web ports belong to whichever one is the front door;
a second app could not have them. Both ports are settings, so LabelBench
can be moved out of the way — or moved back — without touching the code:

```bash
# .env
LABELBENCH_HTTPS_PORT=8443
LABELBENCH_HTTP_PORT=8082
```

Check what is already taken before picking:

```bash
docker ps --format '{{.Ports}}' | grep -oE '0\.0\.0\.0:[0-9]+' | sort -u
```

A new port needs a matching firewall rule, or the workstations cannot reach
it:

```bash
sudo ufw allow from 10.10.17.0/24 to any port 8443 proto tcp comment 'LabelBench HTTPS'
sudo ufw allow from 10.10.17.0/24 to any port 8082 proto tcp comment 'LabelBench HTTP'
```

Changing the port does not change the certificate, so a workstation that
already trusts the CA keeps working — only the URL changes.

### What is actually exposed

The server has no public interface — only the LAN address and a Tailscale
address — so LabelBench is not reachable from the internet. It is reachable
from the lab network and from anything on the Tailnet.

That still leaves the app itself unauthenticated in the default phase, and
anyone who reaches the port can read and write every shared template. The
firewall narrows *who can reach the port*; it says nothing about *what they
can do* once they are there. If the templates matter, turn the key gate on:

```bash
# .env
LABELBENCH_AUTH_MODE=apikey
LABELBENCH_API_KEY=<a long random string>
```

Every `/api/*` call then needs an `x-api-key` header, and the health check
and the page itself stay open so the browser can ask for the key. The key is
held in the browser's local storage and entered once per workstation, through
the key icon in the footer.

Open `https://labelbench.local:8443` in Chrome. If the name does not resolve —
mDNS does not always cross a switch — use `https://10.10.17.185:8443/` instead;
the certificate carries the address as a SAN and the server answers on both.

> **The server is on the LAN, not on the internet.** Ports 80 and 443 are
> published on the host's interfaces and the firewall admits the LAN subnet
> only. The app has no authentication in Phase 1, so anything that can reach
> the port can read and write every template. Exposing it beyond the lab
> would need the API key switched on first — see "Turning on an API key".

### Where the printer has to be

Printing is **browser-direct**, and that is the whole design: the browser on
the workstation in front of you talks to the printer plugged into *that*
workstation over Web Bluetooth or Web Serial. The server never touches a
printer.

So the printer has to be physically connected to the machine you are sitting
at. A workstation that cannot reach the printer cannot print to it — not
because of a limitation in the app, but because the print path is USB or
Bluetooth to the local machine, by design. Templates are central; the
printer is local.

---

## Adding the printer on a new workstation

The printer moves between machines. Each workstation pairs with it once; the
grant is remembered by the browser per origin, so after that the printer
reconnects in one click.

1. Plug the printer into the workstation (USB for a B21/B1, or pair it over
   Bluetooth for a D11).
2. Open `https://labelbench.local:8443` in Chrome or Edge.
3. Click **Connect printer** and choose the transport:
   - **Web Bluetooth (USB)** — for a D11. Pick the device from the browser's
     chooser.
   - **Web Serial (USB)** — for a B21/B1. Pick the serial port from the browser's
     chooser.
4. The model is detected automatically (`D11`, `B21`, `B1`, …) and shown next to
   the connection, along with battery and paper status where the printer reports it.
5. Print a test label from the template gallery.

On Linux, the user running the browser must be able to open the serial device:

```bash
sudo usermod -aG dialout "$USER"    # log out and back in for it to take effect
```

---

## Quick printing a saved template

The **template gallery** (the lightning bolt in the designer toolbar) lists every
template on the central server as a card, with its thumbnail, target model and
label size.

- A template with **no variables** has a **Quick print** button. One click
  loads it from the server and opens the print preview.
- A template **with variables** has a **Needs data** button instead. One click
  loads it and opens the CSV batch dialog with its variable bindings already
  in place.

The gallery reads from the server, so it is identical on every workstation —
there is nothing to copy and nothing to install.

---

## Designing a template

1. Open the app and set the **label size** in millimetres (mm → px at 8 px/mm,
   i.e. 203 dpi) and the **target printer model**.
2. Drag objects onto the canvas: text, barcode, QR, image, rectangle, line.
3. To make an object's text vary per row, insert a **variable placeholder**:
   `{lot}`, `{sample_id}`, `{customer}`. The template's variable list is derived
   from these placeholders.
4. For a date or time, use the date/time insert — `{dt}`, `{dt|YYYY-MM-DD}`,
   `{dt|HH:mm}`, and relative forms like `{dt-1d}`.
5. Check **Print preview** — it shows the real 1-bit rendering.
6. **Save** puts the template on the central server. Every workstation sees it
   immediately; there is nothing to copy.

The template stores its name, target model, label size, orientation, the canvas
document, the declared variables and references to any uploaded images or fonts.

---

## Running a CSV batch

1. Click **CSV batch printing** in the designer toolbar (next to the printer
   model selector).
2. **Import CSV** (or paste the data). The columns are detected, with delimiter
   sniffing and quoted-field handling.
3. **Auto-match columns** binds each CSV column to the template variable of the
   same name (or with a common suffix stripped — `lot_code` → `lot`). Adjust any
   binding by hand; the mapping is saved with the template, so re-importing a
   CSV of the same shape "just works" next time.
4. Optionally turn on **serial auto-increment** and pick the variable that gets
   `prefix`, `start`, `step` and zero-padding.
5. Click any row to see **that row's label** rendered exactly as it will print.
6. Set **copies per row**, **density**, **dithering** and **rotation**.
7. **Print batch**. Rows print one after another with a progress bar and a
   per-row status. A row that fails is recorded with its error and the batch
   continues; you can retry just the failed rows. Pause and cancel mid-run.

> A row whose label is wider than the connected printer's print head is
> **rejected** with a clear message rather than sent to the printer.

---

## Backup and restore

Two things, and that is all of it:

```bash
# the SQLite file
docker compose exec app sh -c 'cat /data/labelbench.db' > labelbench.db

# the asset directory
docker run --rm -v labelbench_labelbench-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/assets.tgz -C /data assets
```

Restore by putting both back into the `labelbench-data` volume.

---

## Bare systemd deployment

If you would rather not run Docker:

```bash
# Build on the target machine, so the native module matches its Node.
cd web && npm ci && npm run build
cd ../app && npm ci && npm run build

sudo install -d /opt/labelbench
sudo install -d /var/lib/labelbench
sudo cp -r app/dist /opt/labelbench/
sudo cp -r web/dist /opt/labelbench/public
sudo cp deploy/systemd/labelbench.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now labelbench
```

The unit serves the SPA and the API on `:3000` and expects TLS to be terminated
in front of it. Point Caddy at `127.0.0.1:3000` with the same certificates, or
put it behind the lab's existing TLS proxy.

> **The `node_modules` must match the Node that runs the service.** The build
> is plain `tsc`, so the compiled server imports `fastify`, `@fastify/static`
> and `better-sqlite3` as bare specifiers — it needs `node_modules` present at
> runtime, not just `dist/`. `better-sqlite3` is a native module whose
> prebuilt binary is tied to one Node ABI, so build and run it with the same
> interpreter:
>
> ```bash
> cd app
> node /path/to/npm/bin/npm-cli.js rebuild better-sqlite3
> ```
>
> Run the service under the same Node you built with — `ExecStart` in the unit
> points at `/usr/bin/node`; change it if yours lives elsewhere.

### The systemd unit

`deploy/systemd/labelbench.service` runs the app as an unprivileged
`labelbench` user with `ProtectSystem=strict`, `PrivateTmp` and
`NoNewPrivileges`. The only writable path is `/var/lib/labelbench`, which
holds the SQLite file and the asset directory — the same two things the
Docker deployment backs up.

The unit references `LABELBENCH_AUTH_MODE` and `LABELBENCH_API_KEY` as
commented-out lines. They work; see the API key section above.

---

## Development

```bash
# API server
cd app
npm ci
npm run dev            # tsx watch, http://localhost:3000

# SPA
cd web
npm ci
npm run dev            # vite dev server
npm run sv-check       # the typechecker contract — must be 0 errors
npm run build
npm run check-limits   # the print-head width rules
```

The API test suite:

```bash
cd app && npm test
```

> The test script runs through `tsx`, not Node's own type stripping. The app's
> source uses the TypeScript ESM convention (`import ... from "./server.js"`
> pointing at a `.ts` file), which only a loader like `tsx` can resolve.

> **Pin the Node version when a native module is involved.** `better-sqlite3`
> ships prebuilt binaries per Node ABI. If `npm rebuild` runs under a different
> Node than the one that starts the server, the binary loads with
> `ERR_DLOPEN_FAILED … NODE_MODULE_VERSION`. Build and run with the same
> interpreter.

---

## Project layout

```
LabelBench/
├── app/                 Fastify + SQLite API server (TypeScript)
│   └── src/
│       ├── db/          schema + migrations
│       ├── domain/      shared template model
│       ├── services/    template + asset service layer (the auth seam)
│       └── routes/      the REST API
├── web/                 the vendored niimblue fork (Svelte 5 + Vite)
│   ├── UPSTREAM.md     provenance + what we changed
│   └── src/
│       ├── services/    API client, template store, asset store
│       └── utils/       render pipeline, CSV engine, batch runner
├── deploy/
│   ├── caddy/           Caddyfile + certificates
│   └── systemd/         bare-metal unit
├── scripts/             setup-certs.sh
├── docs/
│   ├── AUDIT-niimblue.md    the fork-vs-rebuild decision
│   └── M0-viability-report.md
├── tools/bin/           mkcert + caddy binaries (no root needed)
└── docker-compose.yml
```

**Design records live in `docs/`**, not only in chat — a future session inherits
them instead of re-deriving the audit.
