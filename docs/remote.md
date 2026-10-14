# Remote and Profile

Remote keeps agent execution, keys, history and permission decisions on your
laptop. The phone is a static web client. A Cloudflare Worker forwards encrypted
messages; no account, VPN or inbound laptop port is required.

## Set up

1. Open **Settings → Remote**. Enter your name and a public username. Use the hosting
   addresses supplied by your operator, or enter your own HTTPS client and WSS
   relay origins under Hosting.
2. Save the address, set up an authenticator, and enter its current code. The
   laptop claims the username before displaying the authenticator QR.
3. Scan **Connect your phone** with the phone camera. Enter a fresh authenticator
   code in the browser, then approve the named device on the laptop.

The pairing link's fragment pins the laptop identity. A username alone shows a
locked screen and asks for the laptop's pairing link. QR generation happens
locally; neither the authenticator secret nor the identity pin goes to a QR
service. The authenticator secret is held by the laptop and your authenticator.

Choose a new device's trust duration: one day, seven days, thirty days, or the
current connection only. Existing devices retain the expiry approved for them.
Signing keys are non-extractable and stored in the browser's IndexedDB. If the
browser clears its storage, scan the pairing link and approve it again.

## Use your phone

The home screen lists live tasks and pending approvals. Open a task to follow
its activity, send a message, steer, pause or stop its current turn. New tasks
use the laptop's selected folder and always start in **Supervised** mode.
Remote steering interrupts the current turn and redirects its next supervised
turn. Existing tasks must be Supervised before they accept remote messages; queued
remote messages are withdrawn if that permission changes before delivery.

Approving a tool request on the phone queues a confirmation on the laptop.
Only that local confirmation grants the single-use permission. Denying a
request takes effect immediately. Remote never grants persistent permissions
or raises autonomy. Device and action confirmations expire after two minutes.

On iPhone, add the web client to the home screen, pair a trusted device, then
choose **Enable approval notifications**. Web Push carries a generic notice;
the app reconnects to the laptop before displaying any details. Push services
belong to the browser platform and do not execute agents or store app history.

The laptop must remain on, awake and running Droidex. **Keep laptop awake**
prevents application suspension while Remote is enabled; closing the lid can
still suspend it. Turning Remote off disconnects phones immediately. **Revoke**
removes a device immediately. **Reset pairing** disables Remote, revokes all
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

**Share → Copy link** creates a fixed, public aggregate snapshot at
`/p/yourname#…`.
It contains your chosen name, username, aggregate activity and model/harness
names. When a harness omits counts, signed coverage flags label the affected
figures as measured minimums. It contains no prompts, workspace paths, source paths, session
identifiers, costs, device data or private keys, and viewing it never connects
to your laptop. The laptop signs the snapshot with the registered username key.
The web client verifies the signature locally, then sends only that public key
and username to the registry for an owner match. The fragment never goes to the
host or relay, and the relay stores no profile. Anyone with the copied link can
view it, and an already copied snapshot cannot be revoked. Create another link
to share updated figures.

Snapshots contain at most 366 activity dates and five entries per ranking. The
payload is limited to 20 KiB and the complete signed fragment to 24 KiB. The
same verified data can be rendered locally as a PNG share card without laptop
access. URL-fragment snapshots cannot produce social preview cards because
crawlers do not receive fragments; a short link or Open Graph image requires a
separate opt-in public snapshot store.

## Operate or self-host

Deploy the [relay](../relay/README.md) and [static client](../remote-web/README.md)
under origins you control. Set the relay's `WEB_ORIGIN` to the exact client
origin and the client's `VITE_REMOTE_RELAY_URL` to the relay's WSS origin.
Set `DROIDEX_REMOTE_RELAY_URL` and `DROIDEX_REMOTE_CLIENT_URL` for development;
the same addresses can be saved in the desktop onboarding flow.

Before a public launch, verify pairing, trust expiry, revocation, reconnects,
WebSocket hibernation and push delivery against the deployed Worker on a real
phone. Protect repository and hosting accounts with 2FA. A compromised relay
sees ciphertext and traffic metadata; compromised web-host JavaScript can read
the browser view. Self-hosting gives you control of both deployments.

The relay retains only the public handle owner key, short-lived claim
challenges and bounded socket routing metadata. A rate-limited profile check
compares a supplied public key with that owner key and returns the same invalid
shape for an unknown handle or wrong key. It persists no profile, ciphertext or
offline queue. Forwarding performs no durable writes. Frames are capped at
64 KiB, receipt windows at 16 frames/256 KiB and connection attempts at 20 per
IP/minute at each edge. The desktop additionally bounds peers, pending actions,
encryption queues, transcript tails and snapshots. Five incorrect authenticator
codes lock new pairing for fifteen minutes; used time steps cannot be replayed.

Desktop keys, authenticator and trusted devices are encrypted with the operating
system keychain in `remote-access.bin` under the Electron profile. An unavailable
or insecure keychain blocks setup. Corrupt state fails visibly; restore that file
from a trusted backup. Removing it deliberately abandons the registry ownership
key, so choose a new username rather than silently attempting recovery.
