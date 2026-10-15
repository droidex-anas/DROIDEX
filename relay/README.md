# Droidex relay

The Worker assigns one Durable Object to each lowercase handle. The laptop
and browser both connect outbound. The object forwards encrypted application
frames directly; it never records their content or logs request bodies.
Only the public handle owner key and short-lived claim challenges use durable
storage. Socket attachments contain routing IDs, roles, limits and receipt
counts, never payloads, authenticator secrets or device private keys.

## Deploy

Use an authenticated Cloudflare account and the current Wrangler CLI:

```sh
wrangler deploy --config relay/wrangler.jsonc
```

Set `WEB_ORIGIN` to the exact static client's HTTPS origin. Set the laptop's
relay URL to the resulting Worker origin and the web client's relay URL to the
same origin. For local Wrangler development, override `WEB_ORIGIN` with the
local web origin. Self-hosting means deploying this Worker and the static
client under infrastructure you control. Keep GitHub and deployment accounts
protected by two-factor authentication.

```sh
./node_modules/.bin/tsc -p relay/tsconfig.json
node --import tsx --test tools/remote-crypto.test.ts
```

Before enabling the public deployment, verify a real phone can pair, reconnect,
receive updates, and lose access immediately after laptop revocation. Confirm
the claimed handle cannot be claimed by a second laptop key. Set Cloudflare
usage alerts; rate limits bound ordinary abuse but are not a spending cap.

## Protocol

`POST /v1/handles/:handle/challenge` returns a one-use challenge lasting 60
seconds. The laptop signs `claimProof(handle, challenge)` and posts
`{publicKey, challenge, signature}` to `/claim`. Claiming is atomic and only
the existing owner can repeat it. Preserve the laptop identity backup: there
is deliberately no password reset, account recovery or automatic ownership
transfer.

`POST /v1/handles/:handle/profile-challenge` accepts an owner-signed client
nonce and registers it for one profile mutation. `POST /profile` publishes or
updates a signed snapshot when `currentPayload` exactly matches the stored
payload. `DELETE /profile` revokes the exact current payload. Mutation proofs
bind the handle, one-use nonce, current payload and next payload, so copied or
stale requests cannot restore, replace or remove a profile.

`GET /v1/handles/:handle/profile` returns the signed public bundle or 404. The
browser validates the bounded v3 payload, username and owner signature before
rendering it. The relay stores only the signed aggregate payload and signature;
the owner public key already belongs to the handle record. Public reads do not
connect to the laptop.

`GET /v1/handles/:handle/socket` upgrades every valid handle to the same
WebSocket greeting: `{type:"relay-ready", peerId, challenge}`. There is no
username existence lookup. The laptop sends `{type:"host-auth", publicKey,
signature}` signed over `hostProof(handle, challenge)` within 30 seconds.
Only a verified owner becomes the host. It receives `host-ready`, then
`peer-open` and `peer-close` messages for browsers.

The host sends `{type:"forward", peerId, payload}`; browsers omit `peerId`.
The relay appends `deliveryId` to each forwarded envelope. Receivers immediately
send `{type:"received", deliveryId}`. The host sends `authorize-peer` with
the browser's `peerId` only after device authentication completes. Unapproved
connections expire after two minutes. The host sends `disconnect-peer` when
revoking, denying or expiring a browser; the relay closes that browser immediately.
Host disconnects close browsers so
reconnecting always establishes fresh channel keys. A plain `ping` receives
`pong` through Cloudflare's hibernation API without waking the object.

Application payloads begin with a signed host ECDH handshake pinned to the
laptop fingerprint from the pairing URL fragment. The fragment is never sent
to the relay. A typed handle must first acquire that fingerprint from the
laptop; sending an authenticator code to an unpinned key would let a compromised
relay steal it. P-256 ECDH, transcript-bound HKDF-SHA256 and separate AES-256-GCM
direction keys protect each connection. Strict counters reject reflection,
reordering and replay. A device signs the fresh channel challenge using its
non-extractable browser key. TOTP verification, trust expiry, laptop approval,
revocation and command authorization belong exclusively to the laptop.

Unknown owners, invalid claims and invalid host proofs return a generic locked
response. Handles remain public addresses; network timing and traffic metadata
are visible to the relay. End-to-end encryption protects against a compromised
relay, not JavaScript replaced in the static web deployment.

## Bounds

- 20 connection or registry attempts per IP per minute at each Cloudflare edge.
- 120 public profile reads per IP per minute at each Cloudflare edge.
- At most eight owner-authenticated profile mutations per handle per minute.
- At most 33 sockets per room; pairing sockets expire after two minutes.
- At most 64 KiB per relay frame; encrypted plaintext is capped at 46 KB.
- Browser: 120 frames and 256 KiB per second; host: 480 frames and 1 MiB per second.
- At most 16 outstanding frames and 256 KiB awaiting receiver receipts per socket.

Slow or abusive sockets close immediately. There is no offline queue or
ciphertext persistence. Claim and opt-in profile mutations write storage;
message forwarding only updates bounded socket metadata. Idle approved
connections can hibernate.
