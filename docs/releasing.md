# Releasing this fork

See [building](building.md) for build commands, [the current baseline](../MODERNIZATION.md)
for compatibility and risks, and [history](history.md) for recorded verification
and the unresolved hosted-release limits from 1.8.0. Historical checks do not
replace validation of the commit being released.

## Prepare and validate

- Update the version in `CMakeLists.txt`. The new tag must be exactly `X.Y.Z`
  or `vX.Y.Z` matching that CMake version. Commit regenerated `src/html.h` with
  frontend changes; native builds must use that regenerated bundle.
- Run the pinned immutable frontend install, type/lint/format checks, production
  build and dependency advisory audit. Record unresolved advisories rather than
  suppressing them; see the baseline's recorded development-only advisory.
- Rebuild the executable and check CLI/options consistency with
  `python3 scripts/check-options.py build/native/ttyd`. Run the Linux
  [browser/protocol regression suite](../tests/README.md) against the rebuilt
  executable and embedded UI. The reusable native job runs it as a release gate;
  investigate failures using its uploaded diagnostics rather than retrying them
  away. This covers keyboard input, read-only enforcement, authentication/origin
  boundaries, resize, base paths, lifecycle and unavailable-WebGL fallback.
  mTLS's client-certificate verification was fixed for OpenSSL >=4.1.0 (see
  `docs/history.md`'s 2026-11-09 entry) using a from-source OpenSSL build;
  that reproduction is not part of routine CI. Re-run it by hand if the
  pinned/system OpenSSL approaches 4.x, or periodically against current
  OpenSSL to catch a regression or a related verification-timing change.
- Exercise clipboard, sixel and ZMODEM/trzsz transfers. Compilation alone does
  not verify these integrations. When font behavior changes, validate loading,
  authentication/base paths, fallback, reconnect and terminal measurements;
  account for browser-side remote font restrictions.
- For mobile PWA changes, test actual installation through the deployment's HTTPS
  proxy and authentication at root and non-root paths. On iPhone/iPad Safari and
  Android Chrome, check keyboard open/dismiss, rotation, viewport panning, hardware
  keyboards and iPad floating/split keyboards. In every connection state, the row
  must hide when the keyboard is hidden and appear when the keyboard is visible;
  disconnected controls must be disabled.
  Check pinch zoom/panning, input while zoomed and normal fitting after zoom-out;
  zoom must not silently reflow the PTY or reset itself.
  With the keyboard open and closed, drag xterm's scrollbar through history and both ends,
  then swipe up/down over terminal text. Safari must not take over or bounce the
  canvas; reaching a history boundary must leave the page stationary. Recheck
  keyboard-hidden scrolling, touch selection, rotation and two-finger gestures.
  Verify Ctrl/Alt, held-arrow release/cancel, vim/tmux cursor modes, paste, IME,
  reconnect and read-only mode. Confirm no row in browser tabs or on desktop,
  prompt dismissal survives reload, and the installed launch does not retain
  query secrets. Desktop mobile emulation cannot satisfy this release gate.
  Exercise the right-end Aa controls: terminal font and PTY dimensions change,
  key sizes and keyboard focus do not. Check 8/32px bounds, saved-size restoration
  after reload/reconnect, blocked storage, and panel dismissal when the keyboard
  closes. This is terminal text sizing, not a fix for native pinch zoom.
  Check Select beside Paste at narrow phone widths. Tap start/end in both
  directions, including wrapped lines and Unicode, then Copy. Confirm selection
  taps never reach vim/tmux mouse reporting, and Copy/Close stay reachable after
  keyboard dismissal. Confirm Copy preserves an open keyboard and closes the
  panel on success; Close cancels without copying. Exercise denied/unavailable
  clipboard APIs and the native selectable-text fallback, read-only selection,
  rotation and disconnect cleanup.
- Run the full cross-build matrix, particularly 32-bit, Windows and s390x, and
  validate MSVC in its actual Windows environment. For a musl target (e.g.
  `build/cross/x86_64/ttyd`), also run the command-parsing regression test
  against it directly: `TTYD_BINARY=$(pwd)/build/cross/x86_64/ttyd npx ...
  playwright test -g "option-like argument"` from `tests/`. It does not
  reproduce against the glibc native binary, so the standard suite run does
  not cover it. Cross outputs are `build/cross/<requested BUILD_TARGET>/ttyd`
  (`ttyd.exe` for win32), preserving requested aliases; native outputs are
  separate under `build/native`.
- Build and run both container variants using updated static binaries.
- Validate workflow syntax and image tags. Confirm repository/package permissions
  and explicit release intent before pushing a tag: the workflow publishes
  container images before the draft GitHub release is ready.
- When changing the libwebsockets version (or testing whether upstream fixed
  `permessage-deflate`), build ttyd against it with `-DTTYD_LWS_PMD_TRUSTED=ON`
  and run the `test:compression` script from `tests/`. Only if every case passes
  may the default in `CMakeLists.txt` and the notes in `MODERNIZATION.md` be
  revisited.

## Trigger and publication contract

Only a **new tag push** starts the release jobs. Branch pushes (including
`main`), pull requests, moving an existing tag and deleting a tag do not start
build or publishing jobs. The frontend, backend and container workflows are
reusable workflows called by the tag-triggered [release workflow](../.github/workflows/release.yml).

The workflow validates the tag against CMake, then checks/builds the frontend.
After frontend success, native builds and container publishing run. Both must
succeed before binaries and SHA256 checksums are packaged into a **draft GitHub
release**. Review the artifacts and publish the draft manually when ready.
Existing releases are not updated automatically (`allowUpdates: false`).

Images publish only to GHCR as `ghcr.io/lanjelin/ttyd-ng`, using the exact pushed
tag name (including `v` if present). For this fork:

```text
ghcr.io/lanjelin/ttyd-ng:<tag>
ghcr.io/lanjelin/ttyd-ng:<tag>-alpine
```

There are no branch-driven `latest`/`alpine` aliases.
Authentication uses GitHub's automatic `GITHUB_TOKEN`.
Distribution packages and upstream releases are separate from this fork.

## GHCR permissions and partial failures

The workflow grants `packages: write`, but the GHCR package must also grant
this repository workflow access. In the package's **Settings → Manage Actions
access**, grant `Lanjelin/ttyd-ng` **Write** access, or verify that repository
permission inheritance provides it. A linked repository alone is not proof of
that grant. For `permission_denied: write_package`, check package access before
changing tokens or workflow permissions.

Successful publication of one image does not imply that the other image or the
GitHub draft exists. In the recorded 1.8.0 run, Ubuntu publication succeeded but
Alpine publication failed despite the job token's `packages: write` permission
and linked repository metadata. Available package APIs did not expose effective
inherited permissions or Manage Actions grants; if Write access is already
correct, the creation-versus-subsequent-push discrepancy remains unexplained.
No successful resolution is claimed. See [the incident record](history.md#first-hosted-release-run-180).

Rerunning old tag jobs uses the original tagged commit, not later local fixes.
For fixes, commit them and choose a new matching patch version/tag rather than
moving `1.8.0`, whose Ubuntu image was already public. Do not treat a rerun,
a local cross-build or a permission-setting hypothesis as hosted verification.
