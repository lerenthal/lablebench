#!/usr/bin/env bash
#
# LabelBench — TLS setup with an internal CA (mkcert).
#
# Creates (or reuses) a local root CA and issues a server certificate for the
# configured hostname. The certificate is handed to Caddy; the root CA is what
# each workstation has to trust — once per machine.
#
# Usage:
#   ./scripts/setup-certs.sh [hostname] [extra-san ...]
#
# Examples:
#   ./scripts/setup-certs.sh labelbench.local
#   ./scripts/setup-certs.sh labelbench.local 10.10.17.185
#
# The root CA is written to $CAROOT (default ~/.local/share/mkcert). Copy
# rootCA.pem to each workstation and import it into that machine's trust store.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MKCERT="${MKCERT:-$REPO_ROOT/tools/bin/mkcert}"
CERT_DIR="$REPO_ROOT/deploy/caddy/certs"
CAROOT="${CAROOT:-$HOME/.local/share/mkcert}"
export CAROOT

HOSTNAME_ARG="${1:-}"
if [[ -z "$HOSTNAME_ARG" ]]; then
  if [[ -f "$REPO_ROOT/.env" ]]; then
    HOSTNAME_ARG="$(grep -E '^LABELBENCH_HOST=' "$REPO_ROOT/.env" | cut -d= -f2- | tr -d '[:space:]')"
  fi
  HOSTNAME_ARG="${HOSTNAME_ARG:-labelbench.local}"
fi
shift || true

if [[ ! -x "$MKCERT" ]]; then
  echo "mkcert not found at $MKCERT" >&2
  echo "Download it, or set MKCERT=/path/to/mkcert." >&2
  exit 1
fi

mkdir -p "$CERT_DIR"

# The address of this host, so the certificate also works when a workstation
# reaches the server by IP.
LAN_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true)"
[[ -z "$LAN_IP" ]] && LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"

SANS=("$HOSTNAME_ARG")
# The bare label, so "https://labelbench" works if the LAN resolver maps it.
SANS+=("${HOSTNAME_ARG%%.*}")
SANS+=("localhost" "127.0.0.1")
[[ -n "$LAN_IP" ]] && SANS+=("$LAN_IP")
SANS+=("$@")

# De-duplicate while preserving order.
mapfile -t SANS < <(printf '%s\n' "${SANS[@]}" | awk 'NF && !seen[$0]++')

echo "==> Issuing certificate for: ${SANS[*]}"

"$MKCERT" \
  -cert-file "$CERT_DIR/labelbench.pem" \
  -key-file  "$CERT_DIR/labelbench-key.pem" \
  "${SANS[@]}"

echo
echo "==> Server certificate : $CERT_DIR/labelbench.pem"
echo "==> Private key        : $CERT_DIR/labelbench-key.pem"
echo "==> Root CA            : $CAROOT/rootCA.pem"
echo
echo "Next steps:"
echo "  1. Trust the root CA on THIS machine (so the server and your browser agree):"
echo "       sudo $MKCERT -install"
echo "  2. Copy the root CA to every workstation that will open the app:"
echo "       scp $CAROOT/rootCA.pem <workstation>:~"
echo "     then import it there (see README, 'Trusting the CA on a workstation')."
echo "  3. Start the stack:"
echo "       docker compose up -d --build"
