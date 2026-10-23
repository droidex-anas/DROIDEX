# Remote and Profile

Remote opens the full DROIDEX app in a browser on another computer, tablet or
phone, while agents, keys, history and files stay on your laptop. The browser
loads a static web client; a Cloudflare Worker forwards encrypted messages. No
account, VPN or inbound laptop port is required.

## Set up

1. Open **Settings → Remote** (or the Remote card in the sidebar) and choose
   **Get started**.
2. **Claim your username**: enter your name and a public username. The official
   client and relay are already configured. To run your own, open **Self-host
   Remote** and enter your HTTPS client and WSS relay origins.
3. **Link an authenticator**: scan the QR with an authenticator app and enter
   its current code. The laptop claims the username before showing the QR.
4. When Remote is live, scan the pairing code with your other device, or open
   the pairing link there. Enter a fresh authenticator code in the browser,
   then choose **Approve** in the card at the bottom right of the laptop window.

The pairing link's fragment pins the laptop identity. A username alone shows a
locked screen and asks for the laptop's pairing link. QR generation happens
locally; neither the authenticator secret nor the identity pin goes to a QR
service. The authenticator secret is held by the laptop and your authenticator.

Choose how long the laptop trusts a new device: 1 day, 7 days, 30 days, or
**Ask every time** (the current connection only). Existing devices keep the
expiry approved for them. A browser approved with **Ask every time** is listed
under **Trusted devices** while it stays connected, with **Disconnect**. If the
laptop declines a browser, the browser says so and can ask again. If you revoke
or disconnect a browser, the laptop stops answering it at once; the browser
shows that it was removed and does not reconnect until it is unlocked and
approved again. When the laptop goes offline, paired browsers say so at once
and reconnect by themselves. Errors that a reconnect cannot fix, such as a
changed laptop identity, stay on screen until you choose **Try again**.
Signing keys are non-extractable and stored in the browser's IndexedDB. If the
browser clears its storage, scan the pairing link and approve it again.

## Use DROIDEX in a browser

After approval the browser shows the same app as the laptop window: your
projects, chats, settings and theme. Start and steer agents at any autonomy,
answer permission requests, review diffs, use Git and GitHub, and open
terminals. Everything runs on the laptop. **Open workspace** browses the
laptop's folders instead of opening a file dialog. Projects you add and chats
you rename, pin or archive appear on the laptop and in every other paired
browser right away.

The web client updates as soon as it is deployed, while laptops update later.
When the browser and the laptop speak different Remote protocol versions, the
browser asks you to update DROIDEX on the laptop, or to reload the page, instead
of connecting. Desktop features the laptop does not know yet fail with the same
advice.

A trusted browser has the same control as the laptop window, so approve only
browsers you own and keep trust durations short on shared machines. A few
features drive the laptop's own screen and stay there: built-in browser panes,
native file dialogs, app updates and relaunch, and Remote pairing settings.

On iPhone, add the web client to the home screen, pair a trusted device, then
choose **Enable approval notifications**. Web Push carries a generic notice;
the app reconnects to the laptop before displaying any details. Push services
belong to the browser platform and do not execute agents or store app history.

The laptop must remain on, awake and running DROIDEX with its window open, since
the browser starts from the window's projects and settings. **Keep laptop awake**
prevents application suspension while Remote is enabled; closing the lid can
still suspend it. The laptop checks its relay connection every 30 seconds and
reconnects as soon as it wakes from sleep. If the relay refuses the laptop's key
for the username, Remote settings show the error instead of retrying. Turning
Remote off disconnects phones immediately. **Revoke** removes a device
immediately. **Reset pairing** disables Remote, revokes all
devices and replaces the authenticator while preserving the laptop identity
that owns the username. There is no account recovery for a lost laptop key.

## Profile

**Settings → Profile** shows normalized local token totals, an interactive
daily/weekly/cumulative activity chart, streaks, cost coverage, and harness/model
rankings. A sidecar worker incrementally reads supported harness histories into
the append-only `usage.sqlite` ledger, including activity created outside the
DROIDEX window. Unknown categories stay unknown instead of becoming zero. Cost
is shown only when reported or calculable and is labeled as an API-equivalent
estimate for subscription usage. Initial indexing is nonblocking and reports
its state per source; sharing stays unavailable until every source completes.
See [Local usage ledger](usage.md).

**Share → Copy link** publishes an opt-in aggregate snapshot at
`https://droidex.vercel.app/public/yourname`.
It contains your chosen name, username, aggregate activity and model/harness
names. When a harness omits counts, signed coverage flags label the affected
figures as measured minimums; completely unreported token totals stay unknown.
The headline session count covers durable top-level sessions DROIDEX has
created or resumed; harness/model ranking counts remain observed usage
sessions. “Tracked since” includes imported harness history. The snapshot
contains no prompts, workspace paths,
source paths, raw session identifiers, costs, device data or private keys.
The laptop signs it with the registered username key. The relay stores the
signed public aggregate so the link works while the laptop is offline, and the
web client verifies the signature before rendering it. Publishing, updating
and revoking are explicit owner-signed actions tied to the exact current
snapshot. Revocation stops future views but cannot erase copies or screenshots.
Because the short URL carries no key pin, public-profile authenticity trusts the
relay's username-to-owner-key registry. A compromised relay could substitute a
different public profile, but it still cannot reach the laptop or decrypt Remote
traffic; paired Remote devices pin the laptop key separately through the QR link.

Snapshots contain at most 366 activity dates and five entries per ranking. The
payload is limited to 20 KiB. The same verified data can be rendered locally as
a PNG share card without laptop access. Per-user Open Graph images still need a
dynamic image or metadata endpoint.

## Operate or self-host

Deploy the [relay](../relay/README.md) and [static client](../remote-web/README.md)
under origins you control. Set the relay's `WEB_ORIGIN` to the exact client
origin and the client's `VITE_REMOTE_RELAY_URL` to the relay's WSS origin.
Set `DROIDEX_REMOTE_RELAY_URL` and `DROIDEX_REMOTE_CLIENT_URL` for development;
the same addresses can be saved in the desktop onboarding flow.

The official site keeps marketing and Remote in separate Vercel projects. Ordered
project routes on `droidex.vercel.app` proxy valid `/<username>` and
`/public/<username>` pages plus `/__droidex_remote/*` static files to
`droidex-remote.vercel.app`. Fixed marketing and infrastructure names are reserved
and cannot be claimed as usernames. The browser still sees one origin, so the
marketing deployment and Vercel account are part of the Remote client trust boundary.
Deploy Remote first, verify its stable alias, stage and test the routes, then publish
them. The marketing checkout does not need to be rebuilt for a Remote release.

Before a public launch, verify pairing, trust expiry, revocation, reconnects,
WebSocket hibernation and push delivery against the deployed Worker on a real
phone. Protect repository and hosting accounts with 2FA. A compromised relay
sees ciphertext and traffic metadata; compromised web-host JavaScript can read
the browser view. Self-hosting gives you control of both deployments.

The relay retains the public handle owner key, short-lived challenges, bounded
socket routing metadata and an opt-in signed public aggregate. It persists no
private messages, ciphertext or offline queue. Forwarding performs no durable
writes. Frames are capped at 64 KiB, receipt windows at 16 frames/256 KiB,
connection attempts at 20 per IP/minute and public profile reads at 120 per
IP/minute at each edge. Sockets that are neither the laptop nor an authorized
browser share a pool of 16 at the relay and on the laptop; a new one evicts the
oldest, so a flood can slow pairing but cannot lock out the laptop or its
trusted browsers. The desktop allows eight authorized browsers at once and
additionally bounds each browser's bridge sockets, terminals, in-flight calls
and encryption queue. Five incorrect authenticator codes lock new pairing for
fifteen minutes; trusted browsers still unlock. Used time steps, including the
code that finished setup, cannot be replayed.

Desktop keys, authenticator and trusted devices are encrypted with the operating
system keychain in `remote-access.bin` under the Electron profile. An unavailable
or insecure keychain blocks setup. Corrupt state fails visibly; restore that file
from a trusted backup. Removing it deliberately abandons the registry ownership
key, so choose a new username rather than silently attempting recovery.
