#!/bin/bash
set -euo pipefail
umask 077

if [[ $# -ne 1 || -e "$1" ]]; then
  echo "Usage: bash tools/create-self-signed-signing-cert.sh /secure/path/new-signing-directory" >&2
  echo "Choose a new directory outside the repository; never replace an existing release identity." >&2
  exit 1
fi

OUTPUT_DIR="$1"
read -r -s -p 'Choose a password for the signing .p12: ' DROIDEX_P12_PASSWORD </dev/tty
printf '\n' >/dev/tty
read -r -s -p 'Confirm password: ' CONFIRM_PASSWORD </dev/tty
printf '\n' >/dev/tty
if [[ -z "$DROIDEX_P12_PASSWORD" || "$DROIDEX_P12_PASSWORD" != "$CONFIRM_PASSWORD" ]]; then
  echo "Passwords must match and must not be empty." >&2
  exit 1
fi
export DROIDEX_P12_PASSWORD
unset CONFIRM_PASSWORD

SCRATCH_DIR="$(mktemp -d)"
trap 'rm -rf "$SCRATCH_DIR"' EXIT
cat >"$SCRATCH_DIR/openssl.cnf" <<'CONFIG'
[req]
prompt = no
distinguished_name = subject
x509_extensions = code_signing
[subject]
CN = DROIDEX Self-Signed
[code_signing]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
CONFIG

openssl req -new -x509 -newkey rsa:4096 -nodes -sha256 -days 3650 \
  -config "$SCRATCH_DIR/openssl.cnf" \
  -keyout "$SCRATCH_DIR/private.key" -out "$SCRATCH_DIR/certificate.pem"
# Explicit PKCS#12 algorithms keep the export importable by macOS Keychain.
openssl pkcs12 -export -name 'DROIDEX Self-Signed' \
  -inkey "$SCRATCH_DIR/private.key" -in "$SCRATCH_DIR/certificate.pem" \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
  -passout env:DROIDEX_P12_PASSWORD -out "$SCRATCH_DIR/droidex-signing.p12"

mkdir -m 700 "$OUTPUT_DIR"
mv "$SCRATCH_DIR/droidex-signing.p12" "$OUTPUT_DIR/droidex-signing.p12"
mv "$SCRATCH_DIR/certificate.pem" "$OUTPUT_DIR/certificate.pem"
# Keep credentials out of terminal logs; gh reads these protected files through stdin.
openssl base64 -A -in "$OUTPUT_DIR/droidex-signing.p12" -out "$OUTPUT_DIR/droidex-signing.p12.base64"
printf '%s' "$DROIDEX_P12_PASSWORD" > "$OUTPUT_DIR/password"
unset DROIDEX_P12_PASSWORD
chmod 600 "$OUTPUT_DIR/droidex-signing.p12" "$OUTPUT_DIR/droidex-signing.p12.base64" "$OUTPUT_DIR/password"
openssl x509 -in "$OUTPUT_DIR/certificate.pem" -outform DER |
  shasum -a 256 | awk '{print $1}' > "$OUTPUT_DIR/certificate.sha256"

printf '\nKeep %s/droidex-signing.p12 and its password in a secure backup.\n' "$OUTPUT_DIR"
printf 'From the source checkout, upload the protected files to GitHub environment macos-release:\n'
printf 'gh secret set DROIDEX_SIGNING_CERT_P12_BASE64 --env macos-release < %q\n' "$OUTPUT_DIR/droidex-signing.p12.base64"
printf 'gh secret set DROIDEX_SIGNING_CERT_PASSWORD --env macos-release < %q\n' "$OUTPUT_DIR/password"
printf '\nPublic SHA-256 fingerprint (safe to commit): %s\n' "$(cat "$OUTPUT_DIR/certificate.sha256")"
printf 'Pin it in the source repository:\n'
printf 'gh variable set DROIDEX_SIGNING_CERT_SHA256 < %q\n' "$OUTPUT_DIR/certificate.sha256"
printf '\n\nNothing was uploaded or imported into your Keychain. Reuse this certificate for every release.\n'
