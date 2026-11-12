#!/usr/bin/env bash
#
# prepare-host.sh — prepare a fresh Debian/Ubuntu server for LabelBench.
#
# What it does:
#   1. installs Docker Engine + the Compose plugin from Docker's apt
#      repository, if they are not already installed
#   2. installs the small set of packages the guide relies on
#   3. installs mkcert, if it is not already installed
#   4. creates the /opt/labelbench layout with sane ownership
#   5. creates the internal root CA and a server certificate, ONLY if they do
#      not exist yet — an existing CA or certificate is never overwritten
#   6. installs the CA into the host trust store, so the host itself trusts
#      the app
#   7. prints the CA fingerprint and the exact commands the operator should
#      run on each workstation to trust it
#
# It is safe to run again. Every step checks before it acts; a second run
# changes nothing. It does not start, stop or reconfigure any container, it
# does not touch the Docker daemon's running containers, and it does not
# require the app to be running.
#
# Usage:
#   sudo ./deploy/prepare-host.sh [options]
#
# Options:
#   --host NAME     hostname workstations will open   (default: labelbench.local)
#   --ip ADDR       server's LAN address               (default: auto-detected)
#   --dir PATH      install directory                   (default: /opt/labelbench)
#   --help          this text
#
# Exit codes: 0 success, 1 error.
#
set -euo pipefail

# ---------------------------------------------------------------- defaults ---

LABELBENCH_HOST="${LABELBENCH_HOST:-labelbench.local}"
LABELBENCH_IP="${LABELBENCH_IP:-}"
LABELBENCH_DIR="${LABELBENCH_DIR:-/opt/labelbench}"

DOCKER_APT_REPO_URL="https://download.docker.com/linux"
MKCERT_UPSTREAM_URL="https://dl.filippo.io/mkcert/latest"

# The CA's private key lives here and must never be world-readable.
CAROOT=""
CERT_DIR=""

# ------------------------------------------------------------------ helpers ---

log()  { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '    WARNING: %s\n' "$*" >&2; }
die()  { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//; $d'
  exit 0
}

# Run a command, or die with a clear message.
run() {
  info "\$ $*"
  "$@"
}

# ------------------------------------------------------------------- checks ---

# ------------------------------------------------------------------ options ---

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) LABELBENCH_HOST="${2:?--host needs a value}"; shift 2 ;;
    --ip)   LABELBENCH_IP="${2:?--ip needs a value}";   shift 2 ;;
    --dir)  LABELBENCH_DIR="${2:?--dir needs a value}"; shift 2 ;;
    --help|-h) usage ;;
    *) die "Unknown option '$1'. Try --help." ;;
  esac
done

# ------------------------------------------------------------------- checks ---

if [[ "${EUID}" -ne 0 ]]; then
  die "This script must be run as root.

    sudo $0 $*

It installs packages, writes to /etc and to $LABELBENCH_DIR, and installs
the CA into the system trust store. Run it as root, or under sudo."
fi

[[ -r /etc/os-release ]] || die "Cannot read /etc/os-release — is this a Debian/Ubuntu host?"
# shellcheck disable=SC1091
. /etc/os-release

case "${ID:-}" in
  debian|ubuntu) : ;;
  *) die "This script supports Debian and Ubuntu only (detected ID='${ID:-unknown}')." ;;
esac

case "${VERSION_CODENAME:-}" in
  bookworm|trixie|jammy|noble|plucky) : ;;
  "") die "Cannot determine the distribution codename from /etc/os-release." ;;
  *) warn "Untested distribution codename '${VERSION_CODENAME}' — continuing anyway." ;;
esac

# Detect the server's LAN address if it was not given.
if [[ -z "$LABELBENCH_IP" ]]; then
  LABELBENCH_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true)"
  [[ -z "$LABELBENCH_IP" ]] && LABELBENCH_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  [[ -z "$LABELBENCH_IP" ]] && die "Could not detect this host's IPv4 address. Pass it explicitly: --ip <address>"
  info "Detected LAN address: $LABELBENCH_IP"
fi

CAROOT="$LABELBENCH_DIR/pki"
CERT_DIR="$LABELBENCH_DIR/deploy/caddy/certs"

export DEBIAN_FRONTEND=noninteractive

log "LabelBench host preparation"
info "distribution : ${PRETTY_NAME:-$ID $VERSION_ID}"
info "hostname     : $LABELBENCH_HOST"
info "LAN address  : $LABELBENCH_IP"
info "install dir  : $LABELBENCH_DIR"
info "CA root      : $CAROOT"

# ------------------------------------------------------- 1. base packages ---

log "Installing base packages (ca-certificates, curl, openssl, libnss3-tools, iproute2)"
apt-get update -qq
apt-get install -y --no-install-recommends \
  ca-certificates curl openssl libnss3-tools iproute2 gnupg >/dev/null
info "done"

# ------------------------------------------------------ 2. Docker + Compose ---

have_docker()      { command -v docker >/dev/null 2>&1; }
have_compose()     { docker compose version >/dev/null 2>&1; }

if have_docker && have_compose; then
  log "Docker Engine and the Compose plugin are already installed"
  info "docker        : $(docker --version)"
  info "compose       : $(docker compose version --short 2>/dev/null || docker compose version)"
else
  log "Installing Docker Engine and the Compose plugin from Docker's apt repository"

  if ! have_docker; then
    info "adding Docker's apt repository for $ID $VERSION_CODENAME"
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "$DOCKER_APT_REPO_URL/$ID/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc

    # Only rewrite the source list when it does not already point at Docker,
    # so a re-run leaves the operator's own edits alone.
    if ! grep -qs "download.docker.com/$ID" /etc/apt/sources.list.d/docker.list 2>/dev/null; then
      printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] %s/%s %s stable\n' \
        "$(dpkg --print-architecture)" "$DOCKER_APT_REPO_URL" "$ID" "$VERSION_CODENAME" \
        > /etc/apt/sources.list.d/docker.list
    fi

    apt-get update -qq
    apt-get install -y \
      docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
    info "installed"
  else
    info "Docker Engine is present but the Compose plugin is missing — installing it"
    apt-get update -qq
    apt-get install -y docker-compose-plugin >/dev/null 2>&1 \
      || die "Could not install docker-compose-plugin from Docker's repository.
          Check the repository entry in /etc/apt/sources.list.d/docker.list."
    info "installed"
  fi

  if command -v systemctl >/dev/null 2>&1; then
    info "enabling the Docker service"
    systemctl enable --now docker >/dev/null 2>&1 || warn "Could not enable the Docker service; start it manually with 'systemctl start docker'."
  fi
fi

have_docker  || die "Docker is still not available after installation."
have_compose || die "The Docker Compose plugin is still not available after installation."
info "docker        : $(docker --version)"
info "compose       : $(docker compose version --short 2>/dev/null || docker compose version)"

# ----------------------------------------------------------- 3. install mkcert ---

if command -v mkcert >/dev/null 2>&1; then
  log "mkcert is already installed"
  info "mkcert: $(command -v mkcert) ($(mkcert -version 2>/dev/null || echo 'version unknown'))"
else
  log "Installing mkcert"
  if apt-get install -y mkcert >/dev/null 2>&1; then
    info "installed from the distribution package"
  else
    info "downloading the upstream binary"
    mk_arch="$(dpkg --print-architecture)"
    case "$mk_arch" in
      amd64|arm64) : ;;
      *) die "No mkcert binary for architecture '$mk_arch'. Install mkcert manually and re-run." ;;
    esac
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    curl -fsSL "$MKCERT_UPSTREAM_URL?for=linux/$mk_arch" -o "$tmp/mkcert"
    install -m 0755 "$tmp/mkcert" /usr/local/bin/mkcert
    rm -rf "$tmp"
    trap - EXIT
    info "installed to /usr/local/bin/mkcert"
  fi
  info "mkcert: $(mkcert -version 2>/dev/null || echo 'version unknown')"
fi

# ------------------------------------------------ 4. directory layout + owner ---

log "Creating the $LABELBENCH_DIR layout"

mkdir -p "$LABELBENCH_DIR"
mkdir -p "$LABELBENCH_DIR/pki"
mkdir -p "$LABELBENCH_DIR/backups"
mkdir -p "$LABELBENCH_DIR/deploy/caddy/certs"

# The CA's private key is in here: root only, no group or world access.
chown root:root "$CAROOT"
chmod 700 "$CAROOT"

# The backups hold template content; the operator needs to read and write
# them, but they are not public.
chmod 750 "$LABELBENCH_DIR/backups"

# The deployed certificate's private key is read by the Caddy container (as
# root, inside the container). Keep it tight but readable to root.
if [[ -f "$CERT_DIR/labelbench-key.pem" ]]; then
  chmod 600 "$CERT_DIR/labelbench-key.pem"
fi
info "pki/ (CA, root only), backups/, deploy/caddy/certs/"

# -------------------------------------------------- 5. the CA and the server cert ---

# CAROOT is pinned for the whole of this script. Without it mkcert falls back
# to ~/.local/share/mkcert, and a later run of the repository's
# scripts/setup-certs.sh would find no CA there, create a SECOND one, and
# re-sign the server certificate with it — breaking every workstation's
# trust. This is the trap the repository README warns about.
export CAROOT

log "Checking the internal CA"

if [[ -f "$CAROOT/rootCA.pem" ]]; then
  info "existing CA found in $CAROOT — keeping it, not creating another one"
else
  info "no CA yet — one will be created in $CAROOT"
fi

log "Checking the server certificate"

SAN_LIST=("$LABELBENCH_HOST" "${LABELBENCH_HOST%%.*}" "localhost" "127.0.0.1")
[[ -n "$LABELBENCH_IP" ]] && SAN_LIST+=("$LABELBENCH_IP")

if [[ -f "$CERT_DIR/labelbench.pem" && -f "$CERT_DIR/labelbench-key.pem" ]]; then
  info "existing server certificate found — keeping it, not reissuing"
else
  info "issuing a server certificate for: ${SAN_LIST[*]}"
  # Issuing a certificate creates the CA in $CAROOT if there is not one there
  # yet, and reuses the existing CA if there is. That is what makes a second
  # run of this script a no-op.
  if ! mkcert -cert-file "$CERT_DIR/labelbench.pem" \
               -key-file  "$CERT_DIR/labelbench-key.pem" \
               "${SAN_LIST[@]}" >/dev/null 2>&1; then
    die "mkcert could not issue the server certificate. Run it by hand to see the error:
         CAROOT=$CAROOT mkcert -cert-file $CERT_DIR/labelbench.pem \\
           -key-file $CERT_DIR/labelbench-key.pem ${SAN_LIST[*]}"
  fi
  chmod 600 "$CERT_DIR/labelbench-key.pem"
  chmod 644 "$CERT_DIR/labelbench.pem"
  info "issued"
fi

# The CA must exist by now. If it does not, the certificate above was signed
# by some other CA and the host would trust the wrong one.
if [[ ! -f "$CAROOT/rootCA.pem" ]]; then
  info "the CA is still missing — creating it in $CAROOT"
  if ! TRUST_STORES=system mkcert -install >/dev/null 2>&1; then
    die "The CA could not be created at $CAROOT/rootCA.pem.
         Run it by hand to see the error:
           CAROOT=$CAROOT TRUST_STORES=system mkcert -install"
  fi
fi

[[ -f "$CAROOT/rootCA.pem" ]] || die "The CA was not created at $CAROOT/rootCA.pem."

# The certificate must be signed by the CA we are about to trust. If it is
# not, the browser will warn and the operator will not know why.
if ! openssl verify -CAfile "$CAROOT/rootCA.pem" "$CERT_DIR/labelbench.pem" >/dev/null 2>&1; then
  warn "the server certificate is NOT signed by the CA in $CAROOT."
  warn "workstations will not trust it. To reissue against this CA, remove"
  warn "these two files and re-run this script:"
  warn "  rm $CERT_DIR/labelbench.pem $CERT_DIR/labelbench-key.pem"
fi

CA_FINGERPRINT="$(openssl x509 -in "$CAROOT/rootCA.pem" -noout -fingerprint -sha256 | cut -d= -f2)"
info "CA fingerprint: $CA_FINGERPRINT"

# Publish the CA's PUBLIC certificate next to the server certificate so Caddy
# can serve it at /rootCA.pem and a workstation can trust the origin with a
# single download. The CA's private key is never copied here.
if ! cmp -s "$CAROOT/rootCA.pem" "$CERT_DIR/rootCA.pem" 2>/dev/null; then
  cp "$CAROOT/rootCA.pem" "$CERT_DIR/rootCA.pem"
  chmod 644 "$CERT_DIR/rootCA.pem"
  info "published the CA at $CERT_DIR/rootCA.pem"
fi

# ---------------------------------------------- 6. trust store on the host ---

log "Installing the CA into this host's trust store"

TRUST_FILE="/usr/local/share/ca-certificates/labelbench-rootCA.crt"

# Copy the CA directly rather than using 'mkcert -install' as root: under
# sudo, HOME becomes /root, so mkcert looks in a different CAROOT, finds no
# CA, creates a second one and installs that instead — the host would then
# trust a CA that never signed the server certificate.
install -d -m 0755 /usr/local/share/ca-certificates

if [[ -f "$TRUST_FILE" ]] && cmp -s "$CAROOT/rootCA.pem" "$TRUST_FILE"; then
  info "already installed and up to date"
else
  cp "$CAROOT/rootCA.pem" "$TRUST_FILE"
  chmod 644 "$TRUST_FILE"
  update-ca-certificates >/dev/null 2>&1 \
    || warn "update-ca-certificates failed — run it by hand: sudo update-ca-certificates"
  info "installed at $TRUST_FILE"
fi

# -------------------------------------------------------- 7. the handover ---

cat <<EOF

===============================================================================
 LabelBench host is prepared.

 CA fingerprint (SHA-256):
   $CA_FINGERPRINT

 Publish this fingerprint to the operator. On every workstation, the CA must
 match it EXACTLY before it is trusted.

 -----------------------------------------------------------------------------
 ON EACH WORKSTATION — Linux (system trust store; for curl, git, openssl):

   curl -k https://$LABELBENCH_HOST:8443/rootCA.pem -o rootCA.pem
   openssl x509 -in rootCA.pem -noout -fingerprint -sha256
   # must print: $CA_FINGERPRINT
   sudo cp rootCA.pem /usr/local/share/ca-certificates/labelbench-rootCA.crt
   sudo update-ca-certificates

 ON EACH WORKSTATION — Linux (Chrome/Chromium/Edge also need the NSS db;
 Chrome on Linux does NOT read /usr/local/share/ca-certificates):

   sudo apt-get install -y libnss3-tools
   mkdir -p ~/.local/share/pki/nssdb ~/.pki/nssdb
   certutil -d sql:\$HOME/.local/share/pki/nssdb -N --empty-password
   certutil -d sql:\$HOME/.pki/nssdb          -N --empty-password
   certutil -d sql:\$HOME/.local/share/pki/nssdb -A -t "C,," \\
     -n "LabelBench Root CA" -i rootCA.pem
   certutil -d sql:\$HOME/.pki/nssdb          -A -t "C,," \\
     -n "LabelBench Root CA" -i rootCA.pem
   # then FULLY QUIT the browser and reopen it

 ON EACH WORKSTATION — Windows (PowerShell, administrator):

   curl.exe -k https://$LABELBENCH_HOST:8443/rootCA.pem -o rootCA.cer
   \$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 ".\\rootCA.cer"
   (\$cert.GetCertHashString("SHA256") -replace '(..)(?=.)','\$1:').TrimEnd(':')
   # must print: $CA_FINGERPRINT
   Import-Certificate -FilePath .\\rootCA.cer -CertStoreLocation Cert:\\LocalMachine\\Root

 ON EACH WORKSTATION — macOS:

   curl -k https://$LABELBENCH_HOST:8443/rootCA.pem -o ~/Downloads/rootCA.pem
   openssl x509 -in ~/Downloads/rootCA.pem -noout -fingerprint -sha256
   # must print: $CA_FINGERPRINT
   sudo security add-trusted-cert -d -r trustRoot \\
     -k /Library/Keychains/System.keychain ~/Downloads/rootCA.pem

 Do NOT run 'sudo mkcert -install' on a workstation. Under sudo, HOME becomes
 /root, so mkcert creates a SECOND, different CA and installs that one —
 the browser would then trust a CA that never signed the server certificate.

 -----------------------------------------------------------------------------
 NEXT STEPS on this server:

   cd $LABELBENCH_DIR
   cp .env.example .env
   \$EDITOR .env          # set LABELBENCH_HOST, LABELBENCH_IP, the ports
   docker compose up -d --build
   curl -k https://$LABELBENCH_HOST:8443/api/health

 See docs/PRODUCTION-INSTALL.md for the full procedure.

 NOTE: always export CAROOT=$CAROOT when you use the repository's
 scripts/setup-certs.sh, or it will create a second CA and re-sign the
 server certificate with it.
===============================================================================
EOF

log "Done"
