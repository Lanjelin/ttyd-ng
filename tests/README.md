# End-to-end regression tests

These tests launch the real `ttyd` executable and exercise its embedded browser
client, HTTP/WebSocket endpoints, and POSIX PTY. They do not use a mocked server
or the webpack development server. Linux is the supported test host; Windows,
macOS, other browsers, production TLS/proxy deployments, clipboard permissions,
SIXEL and file transfers require separate validation.

## Run

From the repository root, build the current checkout first:

```sh
cmake -S . -B build/native -DCMAKE_BUILD_TYPE=Release
cmake --build build/native --parallel
cd tests
npx --yes @yarnpkg/cli-dist@4.18.1 install --immutable
npx --yes @yarnpkg/cli-dist@4.18.1 exec playwright install chromium
npx --yes @yarnpkg/cli-dist@4.18.1 test
```

Requirements: the native build prerequisites in [the building guide](../docs/building.md),
Node >=24, Python 3, and Chromium's runtime libraries. On supported Debian/Ubuntu
hosts, use `playwright install --with-deps chromium` in the install command above
to install browser system dependencies too. That command may require sudo.
The pinned Yarn invocation avoids relying on a global Yarn Classic or Corepack.
The test package and lockfile are independent of the frontend package; adding
or running tests does not regenerate `src/html.h`.

The committed embedded frontend is sufficient for native-only changes. If
browser sources changed, run the pinned frontend install/check/build first,
then rebuild the native executable so the tests exercise the changed bundle.

To select a different freshly built executable, set `TTYD_BINARY` to its absolute
path. `PYTHON` can select the Python 3 executable used for the controlled child.
The default executable is `build/native/ttyd`, independent of the working directory.

```sh
npx --yes @yarnpkg/cli-dist@4.18.1 test:protocol
npx --yes @yarnpkg/cli-dist@4.18.1 test:e2e
npx --yes @yarnpkg/cli-dist@4.18.1 test --grep 'resize'
```

Large-input regressions (protocol payloads from 2047 bytes to 1 MiB, and a
32 KiB browser clipboard paste) need WebSocket compression to be meaningful.
Builds that do not register it skip the protocol cases and still run the
rest. The `test:compression` script (same as setting `TTYD_REQUIRE_COMPRESSION=1`)
requires compression: the run fails unless `permessage-deflate` is negotiated
and every payload arrives intact. Use it with a binary built with
`-DTTYD_LWS_PMD_TRUSTED=ON`, for example when evaluating a libwebsockets upgrade.

## Assertions and isolation

- Browser tests use real keyboard events and xterm's public buffer API, not
  renderer-specific DOM snapshots. They cover writable round trips, read-only
  defaults, Basic authentication, resize, base paths, disconnect cleanup, final
  output on exit, and operation without WebGL.
- Protocol tests connect directly to the real HTTP/WebSocket endpoints. They
  cover authentication/origin boundaries, read-only enforcement, fragmented
  messages, and malformed-message service survival.
  Empty WebSocket frames are covered both as standalone messages and as initial,
  intermediate and final fragments of authenticated/session payloads.
- Origin tests cover public Host/HTTPS Origin headers over a plain-HTTP backend,
  custom ports, hostname case, bracketed IPv6, mismatches and untrusted forwarded
  headers. They preserve the existing default-port spelling policy.
- `protocol/origin-h2.spec.mjs` uses Node's HTTP/2 client and real RFC 8441
  extended CONNECT streams over TLS, including terminal input/output and a
  conflicting Host header. It needs the `openssl` executable to generate an
  ephemeral test certificate. It explicitly skips when the selected binary does
  not negotiate HTTP/2 or advertise extended CONNECT; HTTP/1 tests still run.
- PWA asset tests fetch/decode real embedded icons and verify manifest resolution,
  root/nested base paths, Basic/proxy authentication, no-store headers and custom
  index preservation. Install-hint tests cover explicit install handoff, manual
  guidance, dismissal scope, blocked storage and desktop/standalone exclusions.
- Mobile accessory tests send real PTY bytes for one-shot modifiers, Escape, Tab,
  normal/application-mode arrows, clipboard input and committed Unicode text.
  Viewport resizing checks that keys show with keyboard occlusion and hide on
  dismissal in both connection states; disconnected controls are disabled.
  Read-only mode uses an ordered resize barrier. Installed-display and install-prompt signals are simulated,
  not actual OS installation. IME, native keyboard animations, iPad floating/
  split keyboards, physical hardware keyboards and authenticated installation
  require the device checks in `docs/releasing.md`.
  Paste-key coverage uses the real browser clipboard with granted permissions
  and checks literal single-character input plus bracketed-paste framing at the
  PTY. Denied and delayed reads are simulated to verify continued typing without
  an application popup, read-only enforcement and stale-result rejection after reconnect.
- Text-size cases exercise the Aa panel through touch input: real PTY resize,
  unchanged key-row height/browser scale, focus retention, panel dismissal,
  persistence overriding a configured font size after reload, bounds, and
  continued input with storage writes blocked.
- Mobile selection cases cover the 11-control row at 320px (14px labels, 16px
  icons, 40px buttons), Select immediately after Paste, accessible two-tap prompts,
  inclusive forward/reverse multiline ranges.
  Cell coordinates come from `.xterm-screen` bounds and public terminal dimensions;
  known output is seeded with `terminal.write()` and its completion callback.
  Application mouse reporting is enabled, and an ordered real-PTY resize barrier
  checks that selection/copy sent no input before typing resumes.
  Real clipboard permission coverage checks explicit Copy, no automatic copy,
  no textarea blur during selection/modern Copy, and dismissal after success;
  simulated clipboard rejection plus `execCommand(false)` checks exact native
  read-only fallback text, manual selection and real clipboard retry. A separate
  case checks actual legacy copying with the modern API unavailable.
  Cases also cover keyboard-hidden panel access, range/start reset on resize,
  disconnect/blur/hidden-page cleanup, read-only Select/Copy and desktop/browser-tab
  exclusions. User device testing reports reliable iPhone controls,
  selection/copy (including tmux → Vim) and rotation. iPad/Android and native
  clipboard permission/manual-copy fallback remain unverified. These selection
  cases do not cover or introduce OSC 52.
- Mobile scroll coverage uses genuine Chromium touch drags on xterm's scrollbar
  and screen. In both keyboard states, screen cases check proportional/reversed
  scrolling, top-boundary containment, stable page/container position, retained
  focus and continued typing; slider cases check both history endpoints.
  Two-finger movement does not scroll xterm, and
  swipes in a mouse-enabled alternate buffer send no terminal input.
  Keyboard-hidden wheel scrolling is also exercised. Viewport resizing emulates
  keyboard occlusion, not Safari's native keyboard; the reported iOS viewport
  bounce still needs device testing.
- Browser-zoom coverage uses Chromium's real page-scale API, not mocked viewport
  properties. It checks persistent magnification, unchanged PTY dimensions and
  working input while zoomed, then fitting/PTY resize after zoom-out. Native
  pinch recognition, Safari input auto-zoom and actual keyboard geometry still
  require physical-device testing.
- One test starts ttyd with a command ending in an option-like argument
  (`bash -i`, no `--` separator) and asserts both that the process stays up
  and that it logs the correct `start command:` line. This only exercises the
  historical crash/misparse on a musl static binary; set `TTYD_BINARY` to a
  `build/cross/<target>/ttyd` musl build to actually cover it, for example
  `TTYD_BINARY=$(pwd)/../build/cross/x86_64/ttyd npx ... playwright test -g
  "option-like argument"`. It still passes against the default glibc
  `build/native` binary, which does not reproduce the parsing defect.
- Another test sends a never-finished fragmented message, prefixed with
  `JSON_DATA` to bypass the pre-authentication command check, totaling more
  than the 10 MiB `MAX_MESSAGE_SIZE` cap; it asserts the connection is
  closed instead of growing the receive buffer without limit, and that a
  fresh authenticated session still works afterward.
- Each server binds to `127.0.0.1` on an OS-assigned port and runs only the
  deterministic Python fixture. No test exposes an interactive shell.
- The fixture records observed input, PTY dimensions and lifecycle events in a
  per-server temporary directory. Read-only assertions synchronize on an ordered
  resize event rather than treating a short period of silence as success.
- Assertions have deadlines; tests do not use arbitrary sleeps to wait for
  startup or browser rendering. The runner uses two workers and no retries, so
  an intermittent failure is a failure, not silently retried away.
- Teardown terminates test servers and fixture process groups. Tests must never
  use an existing user terminal session or depend on external network services
  after installing their prerequisites.

The immediate-exit scenario disables automatic reconnect to observe one child
and its final output in isolation. It asserts output-before-close, not a
particular WebSocket close code. On the locally exercised libwebsockets 4.5.7
build, a child exit status of zero was observed by the browser as close code
1006; normal-close signaling and reconnect policy remain separate coverage gaps.

Failures retain Playwright diagnostics in ignored `tests/test-results/`.
Browser failures include a trace and screenshot; server logs aid native crash
and startup diagnosis. To inspect a trace:

```sh
npx --yes @yarnpkg/cli-dist@4.18.1 exec playwright show-trace test-results/<case>/trace.zip
```

The reusable backend workflow runs the suite in its Linux native job and uploads
failure diagnostics. Its caller remains new-tag-only; this does not add branch
or pull-request triggers. Passing locally is not proof that hosted CI, Windows,
macOS, cross-builds or container images work.

Add regressions for reproduced consumer-visible failures, especially boundary,
ordering, cleanup and access-control errors. Do not pin source text, internal
implementation details, or a dependency's private DOM structure.
