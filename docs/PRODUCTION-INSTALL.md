# LabelBench — production installation and operations guide

For the person who has to install this on a clean server and then keep it
running. Every command is shown in full. Nothing here assumes you have seen
the repository before.

---

## Contents

1. [What you are installing](#1-what-you-are-installing)
2. [Requirements](#2-requirements)
3. [Getting the code](#3-getting-the-code)
4. [The internal certificate authority](#4-the-internal-certificate-authority)
5. [Configuration](#5-configuration)
6. [Starting it](#6-starting-it)
7. [Using it from a workstation](#7-using-it-from-a-workstation)
8. [Backup and restore](#8-backup-and-restore)
9. [Upgrading](#9-upgrading)
10. [Troubleshooting](#10-troubleshooting)
11. [Known gaps](#11-known-gaps)

---

## 1. What you are installing

LabelBench is a self-hosted web app for designing labels and printing them to
NIIMBOT thermal printers. One installation sits on a central lab server: it
serves the editor, the shared template library and the uploaded images and
fonts, and it terminates TLS in front of itself. **Printing is browser-direct** —
the browser on a workstation talks to the printer plugged into *that*
workstation over Web Serial or Web Bluetooth; the server never touches a
printer.

What you need before you start:

- **A server on the lab LAN** — Debian or Ubuntu, x86-64, 2 GB RAM, with a
  static LAN address. It must be reachable from every workstation that will
  use the app.
- **A workstation running Chrome or Edge** (Chromium-based). Firefox and
  Safari cannot do Web Serial or Web Bluetooth. Nothing is installed on the
  workstation except one certificate and, once, one printer pairing.
- **The printer plugged into the workstation whose browser you will print
  from.** The printer moves between workstations; the templates do not.

The browser APIs are the reason the whole thing is HTTPS-only. Web Serial and
Web Bluetooth exist **only in a secure context**. Over plain HTTP the APIs are
simply absent and printing cannot work at all. A browser-trusted HTTPS origin
is a hard requirement, not a nice-to-have — this is why the guide spends a
whole section on certificates.

---

## 2. Requirements

### Docker Engine and the Compose plugin

The deployment is Docker Compose. Both the API server and the TLS terminator
run as containers.

Check what you have:

```bash
docker --version
docker compose version
```

If either command fails, install both from Docker's apt repository. Do not
use the `docker.io` package from the distribution — it is older and does not
ship the Compose v2 plugin.

**Debian / Ubuntu — install Docker Engine + Compose plugin:**

```bash
# Docker's official repository.
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Use "debian" instead of "ubuntu" on Debian, and the right codename:
#   Debian 12 -> bookworm, Debian 13 -> trixie
#   Ubuntu 22.04 -> jammy, Ubuntu 24.04 -> noble
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo systemctl enable --now docker
sudo docker run --rm hello-world
```

`deploy/prepare-host.sh` (shipped with the repository) performs exactly this
step, plus the certificate work in section 4, and is safe to run twice. See
[section 4](#4-the-internal-certificate-authority) for how the two fit
together.

The operator account needs to be in the `docker` group to run `docker compose`
without `sudo`:

```bash
sudo usermod -aG docker "$USER"
```

Log out and back in — group membership is only applied at a new login.

### Other packages

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl openssl libnss3-tools iproute2
```

`libnss3-tools` provides `certutil`, which is what Chrome on Linux uses to
read a trust store. `iproute2` provides `ip`, used to detect the server's LAN
address when issuing the certificate.

### Ports

| Port | Purpose |
|---|---|
| **8443** | HTTPS — the origin the workstations open |
| **8082** | HTTP, exists only to redirect to HTTPS |

**80 and 443 are deliberately not used.** This host runs several applications,
and the standard web ports belong to whichever one is the front door. A
second application cannot have them. Both LabelBench ports are settings in
`.env`, so the app can be moved out of the way without touching the code.

Before picking a port, check what is already taken:

```bash
docker ps --format '{{.Ports}}' | grep -oE '0\.0\.0\.0:[0-9]+' | sort -u
```

If you change a port you also need a matching firewall rule:

```bash
sudo ufw allow from 10.10.17.0/24 to any port 8443 proto tcp comment 'LabelBench HTTPS'
sudo ufw allow from 10.10.17.0/24 to any port 8082 proto tcp comment 'LabelBench HTTP'
```

> **Not verified on this host:** the `ufw` rules above are the ones the
> repository's README documents for the lab's `10.10.17.0/24` subnet. This
> machine does not use `ufw` as its firewall, so the exact rule set on the
> production server is not confirmed here. After changing a port, confirm from
> a workstation that the new port answers (`curl -k https://host:NEWPORT/api/health`).

### Disk

| Item | Size | Note |
|---|---|---|
| `labelbench/app:1.0.0` image | **311 MB** | measured on the reference host |
| `caddy:2.10-alpine` image | **59 MB** | measured on the reference host |
| Build cache | ~1–2 GB expected | **not verified** for a clean build; the reference host shows 16.6 GB of BuildKit cache but that covers several unrelated projects |
| Data volume (DB + assets) | **252 KB today** | measured, with one template saved; grows slowly, assets are the driver |
| Assets | up to 25 MB per upload | hard limit in the app |

Budget **at least 10 GB free** on the filesystem that holds `/var/lib/docker`,
plus whatever the assets directory will grow into. Assets and the database
live in the same Docker volume, so they are on the Docker filesystem.

---

## 3. Getting the code

The repository is expected to live at **`/opt/labelbench`**. Every command
below assumes that path.

```bash
sudo install -d -o "$USER" -g "$USER" /opt/labelbench
cd /opt/labelbench
git clone <this repo> .
cd /opt/labelbench
ls -la
```

> **Not verified:** the exact clone URL. This checkout has no git remote
> configured (`git remote -v` returns nothing), so there is nothing to copy
> from. Substitute your internal Git server, or copy the tree across from the
> development machine:
>
> ```bash
> # on the development machine
> tar czf labelbench-src.tar.gz --exclude=node_modules --exclude=.git -C /path/to/LabelBench .
> scp labelbench-src.tar.gz ops@<server>:/tmp/
> # on the server
> sudo tar xzf /tmp/labelbench-src.tar.gz -C /opt/labelbench
> ```

**If you put the checkout somewhere else**, every path in this guide changes
with it. The three that matter:

- the compose file — you run `docker compose` from that directory, so the
  relative paths in `docker-compose.yml` resolve correctly;
- `deploy/caddy/` — bind-mounted into the Caddy container, so the
  certificates must sit next to the `Caddyfile`;
- `deploy/caddy/certs/` — where the server certificate is written.

The compose project name is derived from the directory name, so the Docker
volume is named `<directory>_labelbench-data`. At `/opt/labelbench` that is
`labelbench_labelbench-data`. Section 8 uses a lookup command so you never
have to hardcode it.

**Build from a clean checkout.** The repository has no root `.dockerignore`,
and the image's `COPY web/ ./` runs *after* `npm ci` — so if the build machine
has a `web/node_modules` directory, it overwrites the one the image just
installed. Clone fresh and build there; do not build from a working
directory where you have run `npm install`.

---

## 4. The internal certificate authority

### Why there is one

The lab LAN has no domain name and no route to a public certificate authority,
so there is no ACME and no Let's Encrypt. Instead `mkcert` creates a **local
root CA** and a server certificate signed by it. Every workstation that will
open the app trusts that root, once. The CA's **private key never leaves the
server**.

The CA must be trusted by the *browser*, not just by `curl`. That distinction
matters on Linux, where Chrome reads the NSS shared database rather than the
system trust store — see [section 7](#7-using-it-from-a-workstation).

### What `prepare-host.sh` does

`deploy/prepare-host.sh` does the whole of this section in one run:

```bash
cd /opt/labelbench
sudo ./deploy/prepare-host.sh --host labelbench.local --ip 10.10.17.185
```

It is **idempotent** — running it twice changes nothing the second time. It
will not overwrite an existing CA or an existing certificate. It does not
start, stop or reconfigure any container, and it does not need the app to be
running. It:

1. installs Docker Engine and the Compose plugin if they are missing;
2. installs `mkcert` if it is missing;
3. creates `/opt/labelbench` with a private `pki/` directory and a
   `backups/` directory;
4. creates the root CA in `/opt/labelbench/pki` **only if there is not one
   already**, and installs it into the host trust store;
5. issues the server certificate into `deploy/caddy/certs/` **only if there is
   not one already**, with the hostname, the bare label, `localhost`,
   `127.0.0.1` and the LAN IP as subject alternative names;
6. prints the CA's SHA-256 fingerprint and the exact commands to run on each
   workstation.

It refuses to run as anything other than root, and it prints what it is about
to do before it does it.

### Doing it by hand instead

If you would rather not use the script, or you are on a system where `mkcert`
is already installed, this is the equivalent. `CAROOT` is pinned explicitly
so the CA lives in a known place and is never accidentally created twice:

```bash
export CAROOT=/opt/labelbench/pki
sudo mkdir -p "$CAROOT"
sudo chmod 700 "$CAROOT"

# Create the CA and install it in the host trust store.
sudo -E TRUST_STORES=system mkcert -install

# Issue the server certificate.
sudo -E mkdir -p /opt/labelbench/deploy/caddy/certs
sudo -E mkcert \
  -cert-file /opt/labelbench/deploy/caddy/certs/labelbench.pem \
  -key-file  /opt/labelbench/deploy/caddy/certs/labelbench-key.pem \
  labelbench.local labelbench localhost 127.0.0.1 10.10.17.185

# Publish the CA's public certificate next to the server certificate so Caddy
# can serve it at /rootCA.pem.
sudo cp "$CAROOT/rootCA.pem" /opt/labelbench/deploy/caddy/certs/rootCA.pem
sudo chmod 644 /opt/labelbench/deploy/caddy/certs/rootCA.pem
```

> **Pin `CAROOT` every time.** The repository's `scripts/setup-certs.sh` uses
> `~/.local/share/mkcert` by default. If you create the CA in one place and
> later run `setup-certs.sh` without `CAROOT` set, `mkcert` finds no CA there,
> **creates a second one**, and re-signs the server certificate with it. Every
> workstation is then trusting a CA that did not sign the certificate, and the
> browser warning comes back for no visible reason. Always run
> `CAROOT=/opt/labelbench/pki` with `setup-certs.sh`.

### Never trust the CA before checking it

The server publishes its CA's public certificate at
`https://labelbench.local:8443/rootCA.pem`, so a workstation needs no `scp`
and no file handoff. On the server, print the fingerprint:

```bash
openssl x509 -in /opt/labelbench/pki/rootCA.pem -noout -fingerprint -sha256
```

It prints one line:

```
sha256 Fingerprint=F4:E5:16:F1:25:B8:19:14:0B:96:9F:AC:A0:E8:D3:BD:1C:95:7E:DF:85:58:DA:60:64:4A:8A:78:41:13:9E:55
```

The value after the `=` is what the operator compares on every workstation.
`prepare-host.sh` prints it at the end of its run. **This fingerprint is
unique to your CA** — the value above is the one on the reference host, so on a
fresh install it will be different. Compare against the value your server
printed.

### The certificate does not change when the port changes

A certificate names hosts and addresses; it carries no port. Changing
`LABELBENCH_HTTPS_PORT` from 8443 to something else changes the URL and
nothing else — a workstation that already trusts the CA keeps working. You do
**not** need to reissue the certificate, and you do not need to re-trust
anything.

What *does* require a new certificate is a change of hostname or IP address.
Reissue in that case:

```bash
cd /opt/labelbench
sudo CAROOT=/opt/labelbench/pki mkcert \
  -cert-file deploy/caddy/certs/labelbench.pem \
  -key-file  deploy/caddy/certs/labelbench-key.pem \
  labelbench.local labelbench localhost 127.0.0.1 <new-ip>
sudo cp /opt/labelbench/pki/rootCA.pem deploy/caddy/certs/rootCA.pem
```

Caddy runs with `--watch` and the whole `deploy/caddy` directory is mounted
read-only into the container, so it picks the new files up within a second or
two, with no restart. Watch it happen:

```bash
docker compose logs -f caddy
```

---

## 5. Configuration

Configuration lives in `/opt/labelbench/.env`. It is not tracked in git;
`.env.example` is the template.

```bash
cd /opt/labelbench
cp .env.example .env
nano .env        # or: sudoedit .env
```

### Variables in `.env.example`

| Variable | Default | What it does | When it must change |
|---|---|---|---|
| `LABELBENCH_HOST` | `labelbench.local` | The hostname workstations open. Must match a SAN in the server certificate. | Always — set it to the name the lab will actually use. `labelbench.local` is recommended because it resolves over mDNS with no per-machine DNS setup. |
| `LABELBENCH_IP` | `10.10.17.185` | The server's LAN address, served in addition to the hostname. The certificate carries this IP as a SAN. | Always — this is the reference host's address. Set it to your server's actual address, and use the same value in the certificate. |
| `LABELBENCH_HTTPS_PORT` | `8443` | The external HTTPS port. Also the port the HTTP listener redirects to. | Only if 8443 is taken. A change needs a matching firewall rule. Does **not** require a new certificate. |
| `LABELBENCH_HTTP_PORT` | `8082` | The external HTTP port, which only redirects to HTTPS. | Only if 8082 is taken. |
| `LABELBENCH_DATA_DIR` | `./data` | Data root. **Ignored by the Docker deployment** — compose hard-codes `/data`. | Only for the bare systemd deployment (see section 11). |
| `LABELBENCH_DB_PATH` | `./data/labelbench.db` | SQLite file path. **Ignored by the Docker deployment** — compose hard-codes `/data/labelbench.db`. | Only for the bare systemd deployment. |
| `LABELBENCH_ASSET_DIR` | `./data/assets` | Uploaded images and fonts. **Ignored by the Docker deployment** — compose hard-codes `/data/assets`. | Only for the bare systemd deployment. |
| `LABELBENCH_AUTH_MODE` | `none` | `none` or `apikey`. With `apikey`, every `/api/*` call must carry the `x-api-key` header. | **Set this to `apikey` in a regulated facility** — see below. |
| `LABELBENCH_API_KEY` | *(empty)* | The shared secret used when `LABELBENCH_AUTH_MODE=apikey`. | Same as above. Generate one with `openssl rand -hex 32`. |
| `LOG_LEVEL` | `info` | Log level for the API server (`debug`, `info`, `warn`, `error`). | Rarely. `debug` is useful when diagnosing a template that will not save. |

The three `LABELBENCH_*_DIR` / `_PATH` entries look like they configure the
data location, and under Docker they do not. `docker-compose.yml` sets the
container paths literally, so the database is at `/data/labelbench.db` inside
the container regardless of what `.env` says. This is confirmed by
`docker compose config`. The `.env` values matter only for the bare systemd
deployment.

### Variables the app reads but `.env.example` does not list

These are read by the server (`app/src/config.ts`) but are **not** passed
through by `docker-compose.yml`, so they cannot be set from `.env` in the
Docker deployment without editing the compose file:

| Variable | Default | Notes |
|---|---|---|
| `LABELBENCH_MAX_ASSET_BYTES` | `26214400` (25 MB) | Maximum asset upload size. Uploads over it are rejected with HTTP 413 `too_large`. |
| `LABELBENCH_STATIC_DIR` | `./web/dist` | Where the built SPA is served from. Compose hard-codes `/app/public`. |
| `LABELBENCH_PORT` | `3000` | Internal listen port. Compose hard-codes `3000`. |
| `LABELBENCH_FORCE_START` | unset | Set to `1` to force the server to start. Diagnostics only. |

### The API key gate — read this before you leave it off

With the default `LABELBENCH_AUTH_MODE=none`, **every template on the server
is readable and writable by anything that can reach the port.** No login, no
password, no session. Anyone on the lab LAN who can open
`https://labelbench.local:8443` can read the entire template library, upload
content, overwrite a template and delete it. The firewall decides *who can
reach the port*; it says nothing about *what they can do once they are
there*.

In a regulated facility that is usually not acceptable. Turn the gate on:

```bash
# .env
LABELBENCH_AUTH_MODE=apikey
LABELBENCH_API_KEY=<a long random string>
```

Generate a good key:

```bash
openssl rand -hex 32
```

Then apply it:

```bash
cd /opt/labelbench
docker compose up -d
```

Every `/api/*` call then needs the `x-api-key` header. Two things stay open on
purpose: `/api/health` (so a liveness probe needs no credential) and the page
itself (so the browser can ask for the key).

On each workstation, click the **key** icon in the app footer and paste the
key. It is kept in that browser's local storage under `labelbench_api_key`
and sent as `X-API-Key` on every request. It is entered once per browser,
not once per person — **there are no user accounts and no per-person
identity**. Anyone who has the key can use it, and there is no audit trail of
who did what.

**Never enable this over plain HTTP on a shared network** — the key would go
out in clear text. Use it behind the HTTPS origin above.

---

## 6. Starting it

```bash
cd /opt/labelbench
docker compose up -d --build
```

The build takes a while the first time (it compiles the API server and builds
the SPA). It prints a fair amount of output; that is normal.

Two containers come up:

- **app** — the API server (Fastify + SQLite) *and* the built SPA. It has a
  health check that polls `/api/health` every 30 s.
- **caddy** — TLS termination, proxying to the app. It waits for the app to
  report healthy before it starts.

Check that it is up:

```bash
docker compose ps
```

`app` should show `healthy` and `caddy` should show `running`.

```bash
curl -k https://labelbench.local:8443/api/health
```

```json
{"status":"ok","service":"labelbench-server","version":1,"time":"2026-11-12T23:25:15.582Z"}
```

`-k` skips certificate verification, which is what you want *before* the
workstations trust the CA. Once the CA is in the host trust store you can
drop it:

```bash
curl https://labelbench.local:8443/api/health
```

Read the logs:

```bash
docker compose logs -f app      # the API server
docker compose logs -f caddy    # TLS, redirects, request log
```

### Telling that the certificate is actually being served

```bash
openssl s_client -connect labelbench.local:8443 -servername labelbench.local </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
```

The `subject` must be `mkcert development certificate` and the `issuer` must
be `mkcert development CA`. If you get nothing back, Caddy is not serving TLS
— check `docker compose logs caddy`.

From a browser or a client that already trusts the CA, the connection details
show `SSL certificate verify ok`.

### The CA is published for workstations to fetch

```bash
curl -k https://labelbench.local:8443/rootCA.pem | openssl x509 -noout -fingerprint -sha256
```

The fingerprint must match the one printed in
[section 4](#4-the-internal-certificate-authority). Only the CA's *public*
certificate is served — its private key stays in `/opt/labelbench/pki`.

---

## 7. Using it from a workstation

### By IP and port, with no DNS at all

A server on a lab network does not need a name. The app is reached at
`https://<server-ip>:<port>/`, and the server's address is the only thing a
workstation has to know. This is the recommended arrangement when the server
is installed on someone else's machine, or when the network does not resolve
names.

Set the address in `.env` before the first start:

```bash
LABELBENCH_HOST=10.10.17.185     # the address the workstations open
LABELBENCH_IP=10.10.17.185       # the address on the certificate
LABELBENCH_HTTPS_PORT=8443
LABELBENCH_HTTP_PORT=8082
```

The certificate must carry that address as an IP SAN, or the browser will
refuse the connection however the CA is installed. Generate it with the
address as well as the name:

```bash
./scripts/setup-certs.sh 10.10.17.185
```

Both forms then work side by side: a workstation that opens the address gets
a valid certificate, and the plain-HTTP port on the same address serves the
setup page that tells it how to trust the CA. The name is optional — if
`LABELBENCH_HOST` is left empty, only the address is published, and nothing
depends on name resolution working across the network.

**The address and the name are separate origins.** A Bluetooth or serial
grant made at `https://10.10.17.185:8443` does not carry to
`https://labelbench.local:8443` or to a different port. A workstation that
switches between them has to grant the printer again — which is why the
address should be settled before the lab starts printing.


### The URL

```
https://labelbench.local:8443
```

If the mDNS name does not resolve — mDNS does not always cross a switch — use
the server's address instead:

```
https://10.10.17.185:8443
```

The certificate carries the IP as a SAN and the server answers on both, so
both URLs are valid.

### Trusting the CA — per operating system

One time per workstation. The `-k` on the download is unavoidable: the
workstation does not trust the CA yet, that is the whole point of the step.
The fingerprint check is what makes it safe.

**Linux — the system trust store (for `curl`, `openssl`, `git`, Node):**

```bash
curl -k https://labelbench.local:8443/rootCA.pem -o rootCA.pem

# Check it before you trust it. It must print exactly:
#   sha256 Fingerprint=<the value your server printed>
openssl x509 -in rootCA.pem -noout -fingerprint -sha256

sudo cp rootCA.pem /usr/local/share/ca-certificates/labelbench-rootCA.crt
sudo update-ca-certificates
```

**Linux — Chrome/Chromium/Edge also need it in the NSS database.**

Chrome on Linux does **not** read `/usr/local/share/ca-certificates`. It has
its own NSS shared database. This is the single most common reason a
workstation still shows a certificate warning after the CA has been
"installed":

```bash
sudo apt-get install -y libnss3-tools

# Chrome M146 and later use the new path; older builds use the old one.
# Add it to whichever exists (adding to both is harmless).
mkdir -p ~/.local/share/pki/nssdb ~/.pki/nssdb
certutil -d sql:$HOME/.local/share/pki/nssdb -N --empty-password
certutil -d sql:$HOME/.pki/nssdb          -N --empty-password

certutil -d sql:$HOME/.local/share/pki/nssdb -A -t "C,," -n "LabelBench Root CA" -i rootCA.pem
certutil -d sql:$HOME/.pki/nssdb          -A -t "C,," -n "LabelBench Root CA" -i rootCA.pem

# List what Chrome will trust:
certutil -d sql:$HOME/.pki/nssdb -L
```

Then **fully quit the browser** — closing the window is not enough — and
reopen it.

> On the reference host the system trust store alone was sufficient for
> Chrome 157 to load the origin with `window.isSecureContext === true`, even
> though the NSS databases were empty. Chrome's Linux trust behaviour has
> changed over the years and is not uniform across versions. Install into
> both places; it costs nothing.

**Windows (PowerShell, administrator):**

```powershell
curl.exe -k https://labelbench.local:8443/rootCA.pem -o rootCA.cer

# Check the CERTIFICATE's fingerprint, not the file's hash.
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 ".\rootCA.cer"
($cert.GetCertHashString("SHA256") -replace '(..)(?=.)','$1:').TrimEnd(':')
# must print exactly the fingerprint your server printed

Import-Certificate -FilePath .\rootCA.cer -CertStoreLocation Cert:\LocalMachine\Root
```

> `certutil -hashfile rootCA.cer SHA256` is **not** the check you want: it
> hashes the downloaded file, not the certificate, so it will never match even
> when the CA is the right one. The `.cer` extension matters too — the
> Windows import dialog does not always recognise a `.pem`.

**macOS:**

```bash
curl -k https://labelbench.local:8443/rootCA.pem -o ~/Downloads/rootCA.pem
openssl x509 -in ~/Downloads/rootCA.pem -noout -fingerprint -sha256
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain ~/Downloads/rootCA.pem
```

**Do not use `sudo mkcert -install` on a workstation.** Under `sudo`, `HOME`
becomes `/root`, so `mkcert` looks in a different `CAROOT`, finds no CA,
creates a second one and installs that instead. The workstation then trusts a
CA that never signed the server certificate, and the browser still warns.
Copying `rootCA.pem` directly avoids the problem entirely.

### A workstation that has never opened the app

The plain HTTP port is the way in. It serves the root CA and a setup page
over plain HTTP — so a workstation that does not trust the certificate yet can
still reach the page that tells it how to trust it.

| Address | Serves |
|---|---|
| `http://<host>:8082/` | the setup page, with this deployment's addresses filled in |
| `http://<host>:8082/setup` | the same page |
| `http://<host>:8082/rootCA.pem` | the root CA, with no trust required |
| everything else | a redirect to the same address over HTTPS |

The redirect keeps the address the client used. A workstation that reached the
server by IP is sent to the IP, not to the hostname — a machine that cannot
resolve the mDNS name across a switch would otherwise be sent to a name it
cannot resolve, and a server that was reachable a moment earlier would look
broken.

The setup page is a Go template rendered by Caddy, so it always carries the
addresses of the deployment it belongs to.

### The printer

> The browser remembers the printer per **origin**. A printer granted at
> `https://labelbench.local:8443` is not granted at `https://10.10.17.185:8443`
> — to the browser they are different origins. Connect on the address you
> print on.

**The printer must be plugged into the workstation the browser runs on.** That
is the design, not a limitation: the browser talks to the printer over USB or
Bluetooth directly, and the server never touches a printer. Templates are
central; the printer is local. A workstation that cannot reach the printer
cannot print to it.

On Linux, the user running the browser must be able to open the serial device:

```bash
sudo usermod -aG dialout "$USER"    # log out and back in for it to take effect
```

Then, in Chrome or Edge: click **Connect printer**, choose the transport, and
pick the device from the browser's own chooser.

- **Web Serial (USB)** — for a B21 / B1. The printer appears as a serial port.
- **Web Bluetooth** — for a D11. The device appears in the Bluetooth chooser.

The model is detected automatically and shown next to the connection. The
browser remembers the grant per origin, so after the first pairing the printer
reconnects in one click.

---

## 8. Backup and restore

### What holds state

Exactly two things, and they are both in one Docker volume:

| What | Where in the container | Notes |
|---|---|---|
| The SQLite database | `/data/labelbench.db` | Templates, template version history, serial counters, asset metadata. |
| The uploaded assets | `/data/assets/` | Images and fonts, content-addressed by SHA-256 of their bytes. |

The Docker volume is `labelbench_labelbench-data` at the checkout path
`/opt/labelbench`. The Compose project name comes from the directory name, so
if you cloned elsewhere the name differs. Look it up rather than guessing:

```bash
cd /opt/labelbench
docker volume ls --filter label=com.docker.compose.project=labelbench
```

### The backup procedure that is actually safe

**Do not copy the database file directly.** The database runs in WAL mode
(`journal_mode = wal`), so recent transactions live in `labelbench.db-wal` and
not in the main file. A plain `cat` of `labelbench.db` produces a file that
**may contain no tables at all**. This was measured on the reference host:
the naive copy was 4096 bytes and opening it raised
`no such table: template`, while the online backup below was 81920 bytes,
passed `PRAGMA integrity_check`, and contained the templates and counters.

Use SQLite's online backup API instead. It takes a consistent snapshot while
the app keeps running — **no downtime**. The repository ships this as
`scripts/backup.sh`:

```bash
cd /opt/labelbench
./scripts/backup.sh                    # writes to ./backups
./scripts/backup.sh /var/backups/labelbench   # or to a directory you name
```

It snapshots the database, archives the assets, opens the result and prints an
integrity line. It refuses to run if the app is not up, and it is safe to run
twice — the files are named with a UTC stamp.

The script does exactly this, if you want to run it by hand:

```bash
cd /opt/labelbench
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p backups
chmod 750 backups

# 1. The SQLite database — consistent snapshot, app stays up.
docker compose exec -T app node -e '
const D = require("better-sqlite3");
const db = new D("/data/labelbench.db", { readonly: true });
db.backup("/tmp/labelbench-backup.db")
  .then(() => { db.close(); })
  .catch((e) => { console.error(e); process.exit(1); });
'
docker compose cp app:/tmp/labelbench-backup.db "backups/labelbench-$STAMP.db"
docker compose exec -T app rm -f /tmp/labelbench-backup.db

# 2. The asset directory.
docker compose exec -T app tar czf - -C /data assets > "backups/assets-$STAMP.tgz"

ls -l "backups/labelbench-$STAMP.db" "backups/assets-$STAMP.tgz"
```

`docker compose exec -T` (no pseudo-TTY) is required, otherwise the tar
stream is corrupted by terminal control characters.

### Verify the backup

A backup you have not opened is not a backup. Copy it back into the app
container temporarily and read it:

```bash
cd /opt/labelbench
STAMP="<the stamp you used>"

docker compose cp "backups/labelbench-$STAMP.db" app:/tmp/verify.db
docker compose exec -T app node -e '
const D = require("better-sqlite3");
const db = new D("/tmp/verify.db", { readonly: true });
console.log("integrity:", db.pragma("integrity_check", { simple: true }));
console.log("templates:", db.prepare("select count(*) c from template").get().c);
console.log("assets:   ", db.prepare("select count(*) c from asset").get().c);
console.log("counters: ", db.prepare("select count(*) c from serial_counters").get().c);
'
docker compose exec -T app rm -f /tmp/verify.db
```

`integrity: ok` and a non-zero template count is what you are looking for.

### Where the backups go

`backups/` inside the checkout is fine for a first copy, but it is on the
same disk as the thing it protects and it is inside the repository. Move the
copies off the server, and keep them somewhere the lab's retention rules
reach. A plain, honest minimum:

```bash
# after each run
sudo install -d -m 700 /var/backups/labelbench
sudo cp -a /opt/labelbench/backups/labelbench-*.db \
           /opt/labelbench/backups/assets-*.tgz \
           /var/backups/labelbench/
```

Or skip the copy step and have the backup write straight there:

```bash
cd /opt/labelbench
./scripts/backup.sh /var/backups/labelbench
```

Then copy `/var/backups/labelbench/` to whatever the lab uses for off-site
storage. **Not verified:** the lab's actual backup destination and retention
policy — that is a site decision, not a repository one.

To automate it, a cron entry is enough:

```bash
sudo crontab -e
# 02:15 every day
15 2 * * * cd /opt/labelbench && /opt/labelbench/scripts/backup.sh >> /var/log/labelbench-backup.log 2>&1
```

The repository ships this as `scripts/backup.sh`, so the cron entry above
works as written. It takes the same snapshot, verifies it, and prints the
integrity check — a backup that fails the check is a failed backup, and a
cron job that only fails silently is worse than none.

### Restoring

**Stop the app first.** It holds the database open, and replacing the file
underneath a running process corrupts it.

```bash
cd /opt/labelbench
STAMP="<the stamp of the backup you are restoring>"

# Locate the data volume instead of hardcoding its name.
VOL="$(docker volume ls -q \
  --filter label=com.docker.compose.project=labelbench \
  --filter label=com.docker.compose.volume=labelbench-data)"
test -n "$VOL" || { echo "data volume not found"; exit 1; }
echo "restoring into volume: $VOL"

# Stop the app. Caddy stays up and will return 502 for a few seconds.
docker compose stop app

# Put the data back, as root, with the ownership the app needs.
docker run --rm --user 0 \
  -v "$VOL":/data \
  -v "$PWD/backups":/backup:ro \
  --entrypoint sh labelbench/app:1.0.0 -c '
    set -e
    # A stale WAL from the previous database must not be replayed over the
    # restored one.
    rm -f /data/labelbench.db-wal /data/labelbench.db-shm
    cp /backup/labelbench-STAMP.db /data/labelbench.db
    tar --no-same-owner -xzf /backup/assets-STAMP.tgz -C /data
    chown -R 1000:1000 /data
    ls -lan /data
  '

# Bring the app back.
docker compose up -d app
```

Replace `labelbench-STAMP.db` and `assets-STAMP.tgz` in the script above with
the actual file names (or copy them to those names first).

#### The ownership detail that will bite you

The container runs as **`node`, uid 1000** — not root. `docker cp` and
`docker compose cp` set the destination file's ownership to **the user who
invoked the copy**, not to root and not to the container's user.

That has two consequences:

- If you run the copy as `root` (or under `sudo`), the restored database
  lands in the volume owned by `root:root` with mode `0644`. The app, running
  as uid 1000, then **cannot write it**. This was measured on the reference
  host: appending to a root-owned file in the volume returned
  `Permission denied`, and the app would fail on its next write — which for a
  WAL database means the next template save fails with a SQLite error.
- If you run the copy as an ordinary user, the file lands owned by *that*
  user's uid, which is also usually not 1000.

**The restored files must end up owned by uid 1000.** The `chown -R 1000:1000
/data` at the end of the restore step is what guarantees it. The helper
container runs as root for exactly this reason.

The `/data` directory itself already belongs to uid 1000:1000 — the image
creates it with `chown -R node:node /data` and Docker seeds a fresh named
volume from the image's directory, so the ownership carries over. Verified on
the reference host.

#### Verify the restore

```bash
cd /opt/labelbench
curl -k https://labelbench.local:8443/api/health
docker compose exec -T app node -e '
const D = require("better-sqlite3");
const db = new D("/data/labelbench.db", { readonly: true });
console.log("templates:", db.prepare("select count(*) c from template").get().c);
console.log("assets:   ", db.prepare("select count(*) c from asset").get().c);
'
```

Then open the app on a workstation and confirm the template gallery lists what
you expect.

> **Not verified end to end:** the full restore sequence above was not
> executed against the live stack — the individual commands it is built from
> were each verified (`docker compose cp` into a stopped container, the
> helper-container `sh -c` with two volume mounts, `chown` to 1000, and the
> app coming back healthy on the restored volume). After your first real
> restore, check the template count in the app **and** that saving a new
> template succeeds. A template that lists but cannot be saved is the
> signature of the ownership problem above.

---

## 9. Upgrading

The repository is the unit of deployment. There is no image registry and no
release channel — you build from the checkout.

```bash
cd /opt/labelbench

# 1. Back up first. Always. See section 8.
# 2. See what you are about to get.
git fetch --all
git log --oneline HEAD..origin/master

# 3. Take the new version.
git pull

# 4. Rebuild and roll the containers.
docker compose up -d --build
```

`docker compose up -d --build` rebuilds the app image, recreates the app
container and restarts Caddy if its configuration changed. The data volume is
untouched — it is a named volume, not a bind mount, so recreating containers
never touches the database.

Check it came up:

```bash
docker compose ps
curl -k https://labelbench.local:8443/api/health
```

### Rolling back

The image tag in `docker-compose.yml` is fixed (`labelbench/app:1.0.0`), so
`docker compose up -d --build` **overwrites that tag**. To roll back, check
out the previous code and rebuild — the old image is not still sitting around
under its tag:

```bash
cd /opt/labelbench
git log --oneline -5                 # find the commit you want
git checkout <previous-commit>
docker compose up -d --build
curl -k https://labelbench.local:8443/api/health
```

Return to the tip when you are ready:

```bash
git checkout master
docker compose up -d --build
```

**The database is not rolled back with the code.** Migrations are append-only
and recorded in a `schema_migrations` table; they are applied once, in order,
on startup, and never removed. Rolling the code back to a version from before
a migration leaves the newer tables and columns in place — harmless, because
the older code simply ignores them. The one thing a rollback cannot undo is
data that the newer code wrote in a format the older code cannot read. If
that matters, restore the database from the backup you took before
upgrading.

---

## 10. Troubleshooting

| Symptom | Cause | What to do |
|---|---|---|
| **Connection refused on 8443** | The containers are not running, or they are running on a different port. | `docker compose ps` — if nothing is listed, `docker compose up -d`. If the ports column shows a different port, `LABELBENCH_HTTPS_PORT` in `.env` and the published port disagree — re-run `docker compose up -d` after editing `.env`. If the container is up, the firewall is the likely culprit: `sudo ufw status` and check the rule for the port. |
| **Browser shows a certificate warning** | The workstation does not trust the CA — usually because it was only added to the system trust store, and Chrome on Linux reads the NSS database instead. | Run the `certutil` steps from [section 7](#7-using-it-from-a-workstation), then **fully quit and reopen** the browser. If the warning says the name is wrong, the URL's hostname is not a SAN in the certificate: check `openssl x509 -in deploy/caddy/certs/labelbench.pem -noout -text \| grep -A2 "Subject Alternative Name"` and reissue with the right name. |
| **`navigator.bluetooth` is undefined; "Web Bluetooth" transport missing** | Web Bluetooth is **not available in Chrome on Linux** — it ships on ChromeOS, macOS, Windows and Android only. Measured on the reference host: Chrome 157 on Linux reports `typeof navigator.bluetooth === "undefined"` while `typeof navigator.serial === "object"`. | Use a **B21 / B1 over Web Serial** on a Linux workstation. To use a **D11 over Bluetooth**, the browser must run on Windows, macOS or ChromeOS. Separately, an untrusted certificate also removes the APIs entirely — check `window.isSecureContext` in the console; it must be `true`. |
| **The printer does not appear in the browser's device list** | Almost always one of three things. | (1) The printer is plugged into a *different* machine — it must be on the workstation running the browser. (2) On Linux the browser user is not in `dialout`: `sudo usermod -aG dialout "$USER"` and log out and back in. (3) Wrong transport: a D11 is a Bluetooth device and appears in the Bluetooth chooser; a B21/B1 is a USB CDC-ACM device and appears as a serial port. Also check `lsusb` and `ls /dev/ttyACM*` on the workstation itself. |
| **A template will not save** | An API error. Open the browser's developer tools → Network, and look at the `POST /api/templates` response. | **401** — the API key gate is on and the key is not set in this browser: click the key icon in the footer and paste it. **400 `invalid_template`** — the payload failed validation: the name must be 1–200 characters, the model must be `d11` or `b21`, the label width and height must be positive, and the canvas must be intact. **413** — the request body is over the server's 32 MB limit, which a very large embedded thumbnail can cause. **413 `too_large`** — an uploaded asset is over 25 MB. Check the app log: `docker compose logs -f app`, and set `LOG_LEVEL=debug` in `.env` if the response body is not enough. |
| **The app is healthy but the page is blank** | The SPA is not being served. | The server returns `503 {"error":"spa_not_built"}` when the static directory is missing — check with `curl -k -i https://labelbench.local:8443/`. If you see that, the image was built without the SPA: rebuild with `docker compose up -d --build` from a clean checkout (see the build warning in section 3). If the response is a normal HTML page but the browser shows white, the browser is running a cached `index.html` that references asset files that no longer exist after an upgrade — hard-reload with `Ctrl+Shift+R`, and check the browser console for a 404 on an `/assets/*.js` file. Also confirm Caddy is proxying: `docker compose logs caddy`. |
| **The app is healthy but nothing is listed in the gallery** | The database was restored without its assets, or the assets were restored without the database. | The gallery reads the template list from the database and the images from `/data/assets`. Both must be restored together — see section 8. |
| **Templates save but the gallery is empty on one workstation** | That workstation has a stale cached copy of the SPA, or the API key is missing there. | Hard-reload, and check the key icon in the footer. |

---

## 11. Known gaps

Things the repository does not do, or does differently from what the
documentation implies. Recorded here so nobody has to discover them the hard
way.

1. **The README's backup command is unsafe.** `docker compose exec app sh -c
   'cat /data/labelbench.db'` copies the main database file only. The
   database runs in WAL mode, so recent writes are in `labelbench.db-wal`.
   Measured on the reference host: the naive copy was 4096 bytes and had no
   `template` table; the online-backup procedure in section 8 produced a
   valid, integrity-checked database. **Use section 8's procedure.**

2. **Web Bluetooth does not exist in Chrome on Linux.** The README describes
   the D11 over Web Bluetooth without noting that Linux Chrome does not
   implement the API. Measured: `navigator.bluetooth` is `undefined` in
   Chrome 157 on Linux. A D11 needs a Windows, macOS or ChromeOS
   workstation.

3. **`LABELBENCH_DATA_DIR`, `LABELBENCH_DB_PATH` and `LABELBENCH_ASSET_DIR`
   have no effect in the Docker deployment.** `docker-compose.yml` sets the
   container paths literally. The `.env` entries only apply to the bare
   systemd deployment.

4. **`LABELBENCH_MAX_ASSET_BYTES` cannot be set from `.env`.** The app reads
   it, but the compose file does not pass it through. Changing it means
   editing `docker-compose.yml`.

5. **`mkcert` and the certificates are not in the repository.**
   `.gitignore` excludes `tools/bin/` and `deploy/caddy/certs/*.pem`, so a
   fresh clone has neither, and `scripts/setup-certs.sh` fails with
   "mkcert not found". Install `mkcert` first — `prepare-host.sh` does this.

6. **`scripts/setup-certs.sh` does not read `CAROOT` from `.env`.** It uses
   `~/.local/share/mkcert`. Running it after `prepare-host.sh` without
   `CAROOT=/opt/labelbench/pki` creates a **second CA** and re-signs the
   server certificate with it, breaking every workstation's trust. Always
   export `CAROOT` when using that script.

7. **There is no backup scheduler and no restore tool in the repository.**
   The backup itself ships as `scripts/backup.sh`, so the cron entry in
   section 8 works as written; the schedule and the off-site copy are the
   operator's. There is no restore tool: the restore is the procedure in
   section 8.

8. **No user accounts, no roles, no audit trail.** With the API key gate on,
   every request is authenticated by the same shared secret and the actor is
   recorded as the literal string `api-key`. The key lives in one browser's
   local storage. There is no way to tell who did what.

9. **The HTTP listener only redirects for the configured hostname and IP.**
   The Caddyfile's plain-HTTP site block covers `LABELBENCH_HOST` and
   `LABELBENCH_IP` only. A request to `http://<other-name>:8082` gets no
   redirect.

10. **No server-side printing.** There is no print queue and no server-side
    print API. Printing happens entirely in the browser on the workstation
    the printer is plugged into.

11. **The `docker-compose.yml` image tag is fixed** (`labelbench/app:1.0.0`),
    so every rebuild overwrites it and a rollback requires a rebuild from the
    previous commit.

12. **A B1 does not report the loaded label size, and the printer panel says
    so.** Observed on 2026-11-18 with a B1 over USB and 40 × 60 mm gap
    stock: the printer connects, the model and serial are read correctly,
    and the panel reports *"The printer has not reported a size"* with no
    measurements beneath it. The canvas is not resized. **Set the size with
    the Label button instead — that works, and it is what that dialog is
    for.** Everything else on the roll is unaffected.

    What is known. The library parses the paper-info response only when it
    is exactly 18 bytes long (`PacketParser.parsePaperInfoResponse`), and
    its own comment says the response "can be 4 bytes, but it return some
    unknown sizes". A response of any other length yields `{ valid: false }`
    with no fields at all, which is indistinguishable from the printer
    saying nothing — and is consistent with the empty reading seen here. The
    app accepts the size in millimetres or in dots, so a unit mismatch is
    ruled out.

    A second, separate trap is waiting behind this one. When the response
    *is* parsed, the library sets `paperHeight = totalHeight` and subtracts
    the gap only for model id 785, the B21 Pro, with the comment
    `todo: check other models?`. If a B1 ever starts answering, its length
    may therefore arrive as the roll's pitch — the label plus the gap — and
    a 60 mm label would size the canvas to 62 mm. Do not subtract the gap
    on a guess: a wrong guess here makes every label short by the gap.

    To resolve it, capture the actual response. With the printer connected,
    the browser console logs every packet (`>> ` sent, `<< ` received); the
    paper-info exchange is the one to keep. Its length and bytes decide both
    questions at once. Until then this is a gap in the reading, not in the
    app's handling of it.

13. **The bare systemd deployment** (`deploy/systemd/labelbench.service`) is
    documented in the repository README and is not covered here. It needs
    `node_modules` present at runtime, not just `dist/`, because
    `better-sqlite3` is a native module tied to one Node ABI. It also needs
    a TLS terminator in front of it. Use the Docker deployment unless you
    have a reason not to.

---

*Verified on Ubuntu 24.04 with Docker Engine 29.9.3 and Compose v5.7.1, using
the reference LabelBench deployment. Items marked "not verified" were not
executed against that host and say what to check.*
