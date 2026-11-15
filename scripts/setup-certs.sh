#!/usr/bin/env bash
#
# LabelBench — TLS setup with an internal CA (mkcert).
#
# Creates (or reuses) a local root CA and issues a server certificate for the
# configured hostname. The certificate is handed to Caddy; the root CA is what
# each workstation has to trust — once per machine.
#
# Usage:
#   ./scripts/setup-certs.sh [hostname-or-ip] [extra-san ...]
#
# Examples:
#   ./scripts/setup-certs.sh labelbench.local
#   ./scripts/setup-certs.sh labelbench.local 10.10.17.185
#   ./scripts/setup-certs.sh 10.10.17.185
#
# Passing an address issues a certificate for that address alone, which is
# what a server reached by IP and port needs. The address is added to the
# certificate as an IP SAN, so the browser accepts it.
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
# An address has no bare form, so it is only added for a name.
if [[ ! "$HOSTNAME_ARG" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  SANS+=("${HOSTNAME_ARG%%.*}")
fi

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

# Publish the CA's public certificate next to the server cert so Caddy can
# serve it. A new workstation then trusts the origin with one download
# instead of an scp. The CA's PRIVATE key is never copied here.
cp "$CAROOT/rootCA.pem" "$CERT_DIR/rootCA.pem"
chmod 644 "$CERT_DIR/rootCA.pem"
echo "==> Published CA       : $CERT_DIR/rootCA.pem  (served at https://<host>/rootCA.pem)"
echo

CA_FINGERPRINT="$(openssl x509 -in "$CAROOT/rootCA.pem" -noout -fingerprint -sha256 | cut -d= -f2)"

echo "Next steps:"
echo "  1. Trust the root CA on THIS machine (so the server and your browser agree):"
echo "       sudo cp $CAROOT/rootCA.pem /usr/local/share/ca-certificates/labelbench-rootCA.crt"
echo "       sudo update-ca-certificates"
echo
echo "     Do NOT use 'sudo mkcert -install' for this. Under sudo, HOME becomes"
echo "     /root, so mkcert creates a SECOND, different CA and installs that one"
echo "     instead — the workstation would then trust a CA that did not sign the"
echo "     server certificate. Copying rootCA.pem directly avoids that entirely."
echo
echo "  2. Start the stack:"
echo "       docker compose up -d --build"
echo
echo "  3. On every other workstation, fetch the CA and check it before trusting it:"
echo "       curl -k https://$HOSTNAME_ARG/rootCA.pem -o rootCA.pem"
echo "       openssl x509 -in rootCA.pem -noout -fingerprint -sha256"
echo "       # must print: $CA_FINGERPRINT"
echo "       sudo cp rootCA.pem /usr/local/share/ca-certificates/labelbench-rootCA.crt"
echo "       sudo update-ca-certificates"
