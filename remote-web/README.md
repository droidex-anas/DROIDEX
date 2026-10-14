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
and `/p/<username>` to the single-page app. Set the desired domain in the Vercel project.

For another static host, serve `remote-web/dist` over HTTPS, route application paths to
`index.html`, and copy the security headers from `vercel.json`. Serve `sw.js` without
caching. Restrict CSP `connect-src` to your configured relay origin when deploying.
Secure the source repository and deployment account with two-factor authentication;
code served by the web host has access to the decrypted browser view.

## Pair and use

1. Open DROIDEX **Settings → Remote**, enter your name, username and hosting addresses,
   then save the address.
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

Settings → Profile creates an opt-in `/p/<username>#…` aggregate snapshot. Its fragment
stays in the browser and is never sent to the static host. Public profiles show normalized
local token activity, session counts, streaks, and harness/model rankings. They contain no
prompts, source paths, session identifiers, workspace paths, or cost data. Signed coverage
flags label partial token figures as measured minimums. The laptop signs
the snapshot with the username owner key. The browser verifies the signature locally and
asks the relay registry to match only that public key to the username; neither service
receives the profile payload. A copied snapshot cannot be revoked; create a fresh link to
share newer figures. Snapshots include at most 366 activity dates and five entries per
ranking. The payload is limited to 20 KiB and the complete fragment to 24 KiB.

Because social crawlers do not receive URL fragments, this private-by-default format does
not generate Open Graph or Twitter previews. A share-card UI can render the verified data
to PNG locally. A short URL or server-rendered preview needs a separate opt-in public
snapshot store. See [`docs/usage.md`](../docs/usage.md) for the ledger and privacy boundaries.

Before publishing, verify pairing, reconnects, device revocation and push delivery on a
real phone against the deployed relay. Local builds and automated checks cover only the
local implementation.
