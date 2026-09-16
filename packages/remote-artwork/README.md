# Remote artwork

Original SVG device artwork and a state-driven animation controller. The phone
uses published iPhone 17 Pro proportions, not an official Apple SVG or CAD asset.
The source is recorded in `device.json`. No external font, image, or animation
package is required.

## Generate

```sh
node packages/remote-artwork/generate.mjs
node packages/remote-artwork/generate.mjs --check
node --test packages/remote-artwork/artwork.test.mjs
```

The desktop `dev`, `electron:dev`, and `build` scripts generate the resources first.
For an iOS-only build, run the generator before opening the Xcode project. Generated
outputs are not stored in Git; the downloadable source bundle includes them.

`artwork.js` owns geometry and motion. The generator writes matching HTML and SVG
resources to `public/remote-artwork`, `electron/mobile/artwork`, and the iOS app's
`Resources/RemoteArtwork` directory. Do not hand-edit generated files. Open
`public/remote-artwork/index.html` to preview all nine states. The standalone guide
contains no real pairing ticket or usable QR.

## State contract

The app supplies `intro`, `scan`, `verifying`, `approval`, `syncing`, `connected`,
`running`, `offline`, or `error`. These are illustrations of reported app state,
not a timed sequence pretending that pairing succeeded. The controller interpolates
path geometry and starts an interrupted transition from the rendered pose.

Mount with `DroidexArtwork.mount(element, { phase: 'intro' })`. Update through
`setPhase`, `setActive`, and `setReducedMotion`; call `destroy` when removing the
view. Hidden or inactive views suspend animation. Reduce Motion selects a static
pose. The HTML viewer uses an exact script hash and denies network/image requests.
The React iframe and nonpersistent native WKWebView receive only bounded phase
messages. Real controls remain outside the illustration and retain their hit areas.

## Verification boundary

Asset and geometry tests do not prove native WKWebView rendering, physical-device
performance, or authenticated pairing. Run the Xcode build and device checks in
`mobile/ios/README.md` before releasing.
