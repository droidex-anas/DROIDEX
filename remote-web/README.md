# DROIDEX Remote web client

The web client is a static phone interface. Agent execution, authenticator verification,
device trust, and permission decisions stay on the laptop. It requires a running DROIDEX
app and the separate relay in `../relay`.

## Develop and build

Use the repository's installed dependencies; the client has no separate dependency tree.

```sh
VITE_REMOTE_RELAY_URL=wss://your-relay.workers.dev npm run remote:dev
npm run remote:typecheck
VITE_REMOTE_RELAY_URL=wss://your-relay.workers.dev npm run remote:build
```

Development runs on port 1421. A local relay can use `ws://127.0.0.1:<port>`.
Production requires HTTPS for the client and WSS for the relay.

## Vercel or self-hosting

Run the Vercel CLI from the repository root with `--local-config remote-web/vercel.json`.
Set `VITE_REMOTE_RELAY_URL` in that Vercel project's build environment. The configuration
builds the repository's `remote:build` script, serves `remote-web/dist`, and routes usernames
and `/public/<username>` to the single-page app. Set the desired domain in the Vercel project.

For another static host, serve `remote-web/dist` over HTTPS, route application paths to
`index.html`, and copy the security headers from `vercel.json`. Serve `sw.js` without
caching. Restrict CSP `connect-src` to your configured relay origin when deploying.
Secure the source repository and deployment account with two-factor authentication;
code served by the web host has access to the decrypted browser view.

## Pair and use

1. Open DROIDEX **Settings → Remote**, then enter your name and username. The official
   client and relay are preconfigured; custom addresses live under **Advanced →
   Self-host Remote**.
2. Set up the authenticator on the laptop and verify its current code to enable Remote.
   The laptop claims the username before displaying the authenticator QR.
3. Scan **Connect your phone** with the phone camera, enter a fresh authenticator code,
   and approve the browser on the laptop. The pairing URL fragment pins the laptop identity;
   a username alone cannot pair a new browser. The laptop chooses its trust expiry.
   Browser signing keys are non-extractable and persist in IndexedDB.
4. Open an agent to read its activity, send or steer a message, pause, or stop a turn.
   New tasks and permission grants wait for laptop approval. Keep the laptop awake.

On iPhone, use Share → Add to Home Screen to enable Web Push. After pairing a trusted
device, select **Enable approval notifications**. Notifications contain generic text;
opening one reconnects to the laptop before showing any request. Browser storage can be
cleared by the browser or the user; scan the laptop QR code again to recover.

**Forget browser** deletes this browser's device key. To revoke remote access immediately,
remove the device in DROIDEX or turn remote access off on the laptop.

## Shared profiles

Settings → Profile publishes an opt-in
`https://droidex.vercel.app/public/<username>` aggregate snapshot. Public
profiles show normalized local token activity, DROIDEX session count, streaks, and
harness/model rankings. They contain no prompts, source paths, raw session identifiers,
workspace paths, device data, or cost data. Signed coverage flags distinguish unknown,
complete and measured-minimum token figures. The relay stores the signed public aggregate;
the browser verifies the bounded v3 payload and username-owner signature before rendering.
The owner can update or revoke the exact current snapshot. Revocation prevents future views
but cannot erase copies or screenshots. Snapshots include at most 366 activity dates and
five entries per ranking, with a 20 KiB payload limit. A share-card UI can render the
verified data to PNG locally; rich social previews need a dynamic image or metadata
endpoint. See [`docs/usage.md`](../docs/usage.md) for ledger and privacy boundaries.

Before publishing, verify pairing, reconnects, device revocation and push delivery on a
real phone against the deployed relay. Local builds and automated checks cover only the
local implementation.
