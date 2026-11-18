# Browser client

## Prerequisites

Use Node.js 24 or newer and the exact Yarn version declared by `packageManager`
in `package.json`. Node is needed only to develop/rebuild the browser client;
native builds can use the committed `src/html.h`.

Install [Corepack](https://yarnpkg.com/corepack) if your Node installation does
not provide it, then let Corepack select the pinned Yarn version:

```sh
npm install --global corepack
corepack enable
cd html # from the repository root
node --version
yarn --version
yarn install --immutable
```

Do not use Yarn Classic or activate a floating `yarn@stable` in CI. For an
intentional dependency update, use `yarn install` to update `yarn.lock`, then
verify that `yarn install --immutable` succeeds. Keep the local ZMODEM patch in
`.yarn/patches/` until its fix is available upstream.

## Development

1. Build the native server, then run `./build/native/ttyd -i 127.0.0.1 -W bash` from the
   repository root. `-W` is necessary for keyboard input; read-only is the default.
2. From `html/`, run `yarn start` and open `http://localhost:9000/`.
   The dev server proxies `/token` and `/ws` to port 7681.
3. Run `yarn check` for TypeScript and lint checks. Use `yarn fix` only
   when you intend to apply formatting/lint changes.

## Production assets

```sh
yarn build
```

The production build bundles and inlines HTML/JavaScript/CSS, compresses the
result, and writes `../src/html.h`. The header also embeds the manifest and
192/512px PNG icons plus the 180px Apple touch icon; `pwa-icons.js` rasterizes
the original artwork deterministically without image-library dependencies.
Commit the generated header with frontend source/dependency changes. Rebuild
the native binary before testing its bundled page. `yarn inline` produces
`dist/inline.html` and standalone metadata/icon files without replacing the C
header. Native builds serve embedded metadata under the configured base path.

xterm.js 6 supports the default WebGL renderer and DOM fallback; the deprecated
canvas addon is no longer shipped. Change `-t rendererType=canvas` deployments
to `-t rendererType=dom` (or omit it to use WebGL).

Verify the actual terminal in a browser after dependency upgrades: output,
keyboard input, resizing, reconnect/disconnect, and DOM fallback. File transfer,
clipboard and image support need their own scenario checks; a successful
webpack build does not verify them.

## Mobile PWA development

The install hint is mobile-browser-only; the accessory keyboard is
installed-mobile-only (`display-mode: standalone` or iOS `navigator.standalone`).
Browser fullscreen alone is not installation. There is no service worker,
offline cache or new WebSocket protocol. The manifest uses relative URLs and
does not persist query arguments or fragments.

The accessory controller owns its viewport/pointer listeners and repeat timers,
clearing modifiers on keyboard dismissal, focus loss and disconnect. Its input
uses xterm's public input/mode APIs and existing socket path. Single committed
ASCII characters can form Ctrl/Alt chords; paste and multi-character/non-ASCII
input are not rewritten. Native IME behavior requires device validation.
The row follows inferred keyboard visibility in every connection state and starts
hidden until keyboard occlusion is detected. Disconnected buttons are disabled.
Infer occlusion from visual viewport height multiplied by page scale, so zoom
does not look like a keyboard. There is no Keys/Auto toggle or native strip suppression.
During native page zoom, preserve the existing container geometry and defer all
xterm fitting through the shared fit method until zoom returns to normal.
Visual viewport resize events resume fitting after zoom-out. The hidden textarea
uses a 16px font to avoid Safari input-focus auto-zoom; rendered terminal font
preferences are unchanged.
Device testing still reports pinch zoom snapping back; the guards above have
not resolved that symptom. Zoom work is deferred while keyboard UI is validated.
Accessory controls cancel non-passive touch defaults as well as pointer/mouse
focus actions, restoring textarea focus synchronously inside the user gesture.
Paste reads on pointer release/accessibility activation (not touch pointerdown)
and uses `terminal.paste()`. Clipboard permission UI is browser-owned; asynchronous
results are rejected across connection changes. Canceled/unavailable clipboard
access does not show an application popup or manual-paste advice.

The right-end Aa button opens a focus-preserving font-size panel (8–32px, 1px
steps). Changes use xterm's `fontSize` and the shared fit callback; no input bytes
or new WebSocket commands are generated. Only the terminal font changes, not the
key row. A chosen size is saved to path-scoped localStorage and restored after
server/URL preferences are applied on load/reconnect, so the mobile user's choice
takes precedence. Invalid/out-of-range stored values are ignored; blocked storage
retains the choice only in the current page. Keyboard dismissal, disconnect and
outside taps close the panel.

Use the regression scenarios in `tests/` and the physical-device checklist in
`docs/releasing.md`. Desktop-emulated viewport changes do not prove iOS keyboard
animation, floating/split keyboard behavior, or authenticated app installation.
