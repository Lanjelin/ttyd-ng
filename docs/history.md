# Modernization history and recorded evidence

This is a historical record of the 2026-11-02 modernization audit and later
follow-ups, not a new certification of the current checkout. Commands, versions,
artifact paths and audit results below describe the work recorded at that time.
In particular, `build/ttyd.alpine.x86_64` is a historical local artifact path,
not the current cross-build output contract. Current guidance is in
[the baseline](../MODERNIZATION.md), [building](building.md), and
[releasing](releasing.md). The 1.8.0 hosted failures and outstanding limits below
remain recorded failures/limits; local fixes do not establish hosted success.

Audit date: 2026-11-02. Scope: maintainable dependency/build baseline for
[Lanjelin/ttyd-ng](https://github.com/Lanjelin/ttyd-ng), preserving the terminal protocol
and existing security defaults. This is not a new release or a claim that all
supported platforms have been certified.

## Decisions implemented

| Area | Previous state | New baseline / decision |
| --- | --- | --- |
| Frontend Node | Manifest allowed Node 12; CI used EOL Node 18 | Node 24 minimum and CI baseline; native-only builds do not require Node |
| Package manager | Yarn 3.6.3; README demanded v2; CI activated floating stable | Pin Yarn 4.18.1; immutable lockfile install |
| Browser terminal | xterm 5.5 and canvas addon | xterm 6 compatible addon set; WebGL with DOM fallback; canvas removed |
| Frontend build | Gulp 4, stream plugins, legacy lint integration | webpack retained; Node-based asset generation; current flat ESLint configuration |
| CMake | Dead pre-3.1 branch despite 3.12 minimum | Retain 3.12 minimum, policies through 4.0, normal C99 selection |
| libwebsockets discovery | Raw library names outside MSVC | Select exported targets on all platforms; custom-prefix linking fixed |
| Cross pkg-config | Only staged `lib` searched; host metadata could leak in | Isolated target `PKG_CONFIG_LIBDIR`, including staged `lib64` for OpenSSL |
| zlib cross-build | 1.3.2 from zlib.net | Retain 1.3.2; use the official GitHub release asset after an invalid archive response |
| json-c cross-build | 0.18 | 0.19, including CMake 4 support |
| OpenSSL cross-build | 3.6.1 and downloaded MinGW patch | 3.5.9 LTS; fix already included, external patch removed |
| libuv cross-build | 1.52.1 | 1.53.0 |
| Windows static linking | Raw libuv archive without complete system linkage; MSVC dynamic CRT default | Restore upstream libuv system libraries, including synchronization; match vcpkg's static CRT |
| libwebsockets cross-build | 4.5.7 and config-file patch | 4.5.8 maintenance release; config patch replaced by target selection |
| Containers | Ubuntu 24.04; floating Alpine | Ubuntu retained; Alpine pinned to supported 3.24 |
| Snap | core20, old runtime package names, upstream source checkout | core24, current package names/libuv event plugin, local fork checkout, craftctl |
| CI | Branch/PR builds and independent publishing | New-tag-only orchestration; frontend checks gate native/container builds; release waits for both |
| Publishing | Hardcoded upstream image namespace | Versioned GHCR images only; GitHub releases remain drafts |
| Contributor docs | Outdated frontend and manual tooling instructions | AGENTS.md, current build guidance, pinned go-md2man v2 install |

### Compatibility changes

- Rebuilding the browser client now requires Node >=24 and the pinned Yarn.
  The distributed C executable still has no Node runtime dependency.
- xterm 6 no longer provides the canvas renderer. Replace
  `-t rendererType=canvas` with `-t rendererType=dom`, or omit the setting for
  WebGL with DOM fallback. Do not treat the removed renderer as a supported alias.
- Renderer transitions refit the terminal: a real WebGL context-loss smoke
  exposed an 861px DOM grid in an 800px viewport until fitting was repeated.
- Terminal edges now use the configured theme background, including xterm 6's
  legacy viewport and the unused space outside whole character cells. A
  ResizeObserver batches refits after container/renderer size changes; applying
  preferences also refits for line height and letter spacing, not just font size.
- Disable native scrolling on the obsolete `.xterm-viewport`: xterm 6's active
  scrollbar belongs to `.xterm-scrollable-element`. Leaving the old viewport's
  `overflow-y: scroll` enabled can paint a second, light native scrollbar at the
  browser edge behind the active scrollbar.
- OpenSSL's numerical version decreased intentionally: 3.6 support ended on
  2026-11-01, whereas 3.5 LTS is supported through April 2030. A larger version
  number is not necessarily a better maintenance baseline.
- Native library floors are not raised just to match cross-build pins. System
  builds can use distribution-maintained libraries; libwebsockets must include
  libuv support. The cross-build pins describe bundled release binaries, not
  the oldest distribution packages accepted by CMake.
- Snap packaging now builds the current checkout instead of fetching upstream.
- Only newly created tag pushes start automation. Branch pushes (including
  `main`), pull requests, tag moves and tag deletions do not start build or
  publishing jobs. Frontend/backend/container workflows are reusable, called
  only by the tag-triggered release workflow.
- Tags must match the CMake version, with an optional leading `v`. After
  frontend checks succeed, native builds and GHCR publishing run; both must
  succeed before a draft release is created. Existing releases are not updated.
- Container images use the fork's GHCR namespace and the exact version tag
  (plus `-alpine` for Alpine). Branch-driven `latest`/`alpine` aliases are no
  longer generated.
  Distribution packages and upstream releases remain separate from this fork.

## Intentionally retained / follow-on work

1. **Cross toolchain provenance.** The static matrix still downloads the
   2021-11-23 musl/MinGW toolchains; this remains upstream's latest published
   toolchain release. Replacing compiler/libc stacks across all architectures
   needs an explicit target/support matrix and runnable artifacts, not a guessed
   URL. Downloads also lack a checked-in cryptographic checksum manifest.
   Establish reproducible toolchain builds and verify source/toolchain digests
   before calling the release supply chain hardened.
2. **Major native library migrations.** libwebsockets 5 and OpenSSL 4 are not
   required for this update. Keep the maintained 4.5/3.5 lines until their ABI,
   platform and TLS behavior can be exercised across the supported matrix.
   TypeScript remains 6.0.3 because typescript-eslint's supported peer range
   excludes TypeScript 7. Exact direct dependency pins and a refreshed transitive
   lockfile avoid inheriting the old lockfile's vulnerable tooling versions.
3. **Legacy transfer dependencies.** The patched `zmodem.js` integration is
   retained rather than silently removing file transfer. Treat its maintenance
   status as technical debt; evaluate a maintained replacement with real
   bidirectional transfer and cancellation coverage before cutover.
4. **Packaging coverage.** Verify Windows/MSVC, MinGW, non-x86 targets and an
   installed classic snap in their actual environments. Snap still consumes the
   external `homeishome-launch` stage-snap. Linux browser success does not prove
   those paths or classic-snap ELF/plugin resolution.
5. **Feature work.** Keep future features separate from dependency maintenance.
   Add behavior-level regression coverage when introducing protocol, terminal
   lifecycle, authentication or file-transfer changes. No feature scope is
   implied by this audit.

### Remaining advisory

The refreshed full dependency audit still reports
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
for ESLint's development-only `minimatch@10.2.6` dependency. The fix is in
minimatch 11.0.1, outside ESLint 10.14.0's declared dependency range. Do not
force an unverified major override or suppress the advisory. Upgrade ESLint
when it adopts the fixed major, and avoid running lint with untrusted glob
configuration. The production-only dependency audit reports no suggestions.


## Verification performed

- Node 24.22.2 / Yarn 4.18.1: immutable install, `yarn check`, `yarn build`,
  and `yarn inline` passed. The generated `src/html.h` was rebuilt into native
  executables, not just inspected as a standalone HTML file.
- Full recursive dependency audit reduced to the single development-only
  advisory above; production-only audit returned no suggestions.
- CMake 4.4.5 / GCC 16.2.1: native shared-library build passed with a custom
  libwebsockets prefix, reproducing then fixing the original missing-library
  link failure. CLI version/help and HTTP index/token endpoints exercised.
- Full x86-64 musl cross-build passed using the updated zlib/json-c/libuv/
  OpenSSL/libwebsockets chain and static-only libwebsockets target. Initial
  host pkg-config contamination was reproduced and fixed; the rebuilt binary
  is statically linked. HTTPS token endpoint passed certificate verification
  with a temporary local CA certificate.
- Actual Chromium terminal: WebGL rendering, input/output, viewport resize,
  deliberate WebGL context loss and correctly sized DOM fallback; sixel image
  rendered visibly. Explicit DOM rendering, HTTP Basic authentication, mounted
  base-path endpoints and read-only input behavior exercised.
- Development server: webpack WebSocket transport connected; proxied terminal
  token/WebSocket traffic and command output worked. Normal shell exit showed
  the reconnect prompt; Enter reconnected and accepted a new command.
  A temporary config changed test ports because local port 7681 was occupied;
  that existing service was not stopped.
- Both amd64 Dockerfiles built with the final generated bundle and updated
  static native dependencies; CLI version and real browser shell round trips
  passed in Alpine 3.24 and Ubuntu 24.04 containers.
- `actionlint` workflow validation, `bash -n scripts/cross-build.sh`, and
  man-page regeneration with go-md2man 2.0.7 passed.
- Rendering correction after Alpine VM feedback: frontend check/build and both
  native rebuilds passed. Browser checks covered matching dark/light backgrounds,
  WebGL/DOM grid fitting, font sizes 13/18/20/24, live line-height/letter-spacing
  changes, container-only resizing and viewport resizing. Grid geometry matched
  FitAddon at pixel ratios 1, 1.25 and 2. Glyph screenshots were checked for
  WebGL at 1 and DOM at 1.25; emulated high-DPI WebGL has a browser backing-store
  measurement mismatch, so its glyph screenshots are not certified. The updated
  static artifact is available locally as `build/ttyd.alpine.x86_64`.
- Right-edge follow-up: frontend checks/build and native rebuilds passed.
  A real 200-line scrollback session confirmed the obsolete viewport reserves
  no native scrollbar width, even with an explicitly white native scrollbar
  style. The active xterm scrollbar remained usable: mouse-wheel scrolling
  moved the viewport and dragging its thumb reached the first output line.
  The rebuilt bundle's edge was checked visually. The supplied Alpine VM LAN
  endpoint refused browser and workstation connections, so verification used
  the rebuilt static binary locally; no commands were sent to the VM terminal.
- Tag-only automation rewrite: `actionlint` passed. Parsed-workflow smoke cases
  allowed release jobs only for a new tag, not main/new-branch pushes, pull
  requests, tag moves or tag deletions. The actual version-check shell accepted
  matching bare/`v` tags and rejected mismatches; the actual image-metadata shell
  emitted only the two versioned GHCR image names. No GitHub release or image
  publication was performed during these checks.
  The release-packaging shell also correctly named 14 fixture assets and
  generated verified SHA256 checksums in an isolated, source-free workspace.

Not certified here: MSVC builds/native Windows execution, non-x86 hardware,
installed snap (Snapcraft is not available locally), clipboard integration and
ZMODEM transfers. A trzsz download attempt reached the browser file-picker flow
but was cancelled under headless automation; successful end-to-end transfer is
not claimed. Local verification did not publish images or releases. These are
release-validation limits, not hidden claims of platform coverage.

## First hosted release run: 1.8.0

Inspected [run 41443189974](https://github.com/Lanjelin/ttyd-ng/actions/runs/41443189974)
without rerunning jobs or changing remote state.

- **MSVC and win32:** static libuv introduced `WaitOnAddress` and
  `WakeByAddressSingle` references, but raw library discovery omitted their
  system-library dependencies. Restored the Windows system-library list from
  upstream libuv, including `synchronization`. MSVC also emitted a `LIBCMT`
  runtime mismatch; the static vcpkg job now selects `/MT` (Release) and `/MTd`
  (Debug), rather than suppressing that warning.
- **ppc64le:** failed while unpacking zlib, before compilation, because the
  zlib.net response was not gzip data. Switched to zlib's official GitHub
  release asset. Its downloaded SHA256 matched the upstream release metadata.
- **Verification:** complete win32 and ppc64le cross-builds passed locally.
  The Windows PE executable imports both previously unresolved symbols from
  the Windows synchronization API set. The PowerPC binary ran under QEMU
  10.2.3, served HTTP index/token requests, and completed a WebSocket PTY command
  round trip. Linux configure/build/CLI, shell syntax and actionlint passed.
  Initial local cross-build attempts hit temporary disk quota; owned obsolete
  build trees were cleared and the complete checks then passed sequentially.
  MSVC compilation/runtime still needs a hosted Windows run.
- **Docker:** all four architectures built for both variants. Ubuntu publication
  succeeded, creating the public 1.8.0 image in the fork's pre-rename GHCR namespace; Alpine
  publication failed with `permission_denied: write_package`. The job token
  already had `packages: write`, and package metadata links it to this fork.
  Effective inherited permissions and Manage Actions access grants are not
  exposed by the available package APIs. Check repository **Write** access in
  the package settings; if already correct, the creation-versus-subsequent-push
  authorization discrepancy remains unexplained. No speculative Docker
  configuration or credential changes were made.

Rerunning the old tag's jobs uses its original commit, not these local fixes.
Commit fixes and select a new matching patch version/tag for the next attempt;
prefer that over moving `1.8.0`, since its Ubuntu image is already public.

## External terminal font loading

- Added long-only `--font` for one readable regular local `.woff2`, `.woff`,
  `.ttf`, or `.otf` file, or an HTTP(S) font-file URL. No font bytes are embedded
  in the executable and no new runtime dependency is required.
- Local fonts use an exact authenticated `/font` route under the configured
  base path; no directory is exposed. Token JSON carries the browser-facing
  font URL. Remote fonts are fetched directly by the browser, never by ttyd.
- The bundled client awaits font loading/registration before opening xterm,
  automatically selects an internal alias, and preserves it across reconnects.
  Failed loads warn in the browser console and retain font-family fallback.
  A loaded `--font` overrides `fontFamily` preferences; size/weight controls
  remain independent. Custom index pages must implement loading separately.
- Remote deployments still depend on client connectivity, CDN availability,
  CORS, HTTPS/mixed-content rules, and deployed CSP. Only one regular face is
  configured; separate bold/italic face mapping is not implemented.
- Verification: pinned Yarn 4.18.1 immutable install, TypeScript/ESLint check,
  production frontend generation, and native Release configure/build passed.
  Actual bundled Chromium sessions loaded an external TTF before terminal
  creation, exercised authenticated base-path serving, automatic font selection
  over `fontFamily=serif`, font-size preferences, writable input/output, PTY
  resize, reconnect without duplicate font registration/download, and WebGL
  context-loss fallback to a correctly sized DOM terminal. A cross-origin TTF
  loaded directly from a local HTTP font host; read-only input remained blocked.
  A host without CORS produced a visible console warning and a usable DOM
  fallback terminal. HTTP smoke checks covered exact file bytes/content type,
  missing authentication, unknown paths, invalid local inputs, both font/base-path
  option orders, escaped remote URL metadata, and unconfigured token responses.
- Limits: actual font decoding was exercised with TTF, not every supported font
  format. Public CDNs, remote HTTPS/CSP deployments, Windows/cross-target builds,
  containers, and snap were not verified for this feature. Transfers and sixel
  integrations were unchanged and were not exercised.

## Repository organization and build isolation — 2026-11-03

- Kept the C/frontend source layout intact. Separated recommended native output
  (`build/native`) from cross outputs (`build/cross/<requested-target>`), retaining
  requested aliases and avoiding deletion of the shared root build directory.
  Updated workflow upload/container consumers and moved release staging to
  `artifacts/` and `release-assets/` without changing published asset names.
- Split current baseline/risks, build guidance, release procedures and historical
  evidence into linked documents. README now prioritizes installation/use and
  distinguishes upstream/distribution packages from this fork's builds.
  The manual is the detailed CLI reference rather than a duplicated README list.
- Added `scripts/check-options.py`, invoked by native release CI, comparing real
  `--help` long names/short aliases with manual source and generated man page.
  Known libwebsockets-dependent options may be absent from runtime help; prose,
  argument semantics and defaults remain review responsibilities.
- Verification: native Release configure/build passed. Full static musl builds
  passed for requested targets `amd64` (invoked outside the checkout from `/tmp`)
  and `x86_64`. Native and prior amd64 executable SHA256 values were unchanged
  after the second cross build; the legacy root `build/ttyd` also survived.
  Both resulting cross executables were identified as statically linked.
- Both amd64 container variants built from the new binary staging path. Native,
  Alpine and Ubuntu HTTP index/token endpoints and browser shell input/output
  round trips passed. Alpine DOM rendering was checked visually. Headless WebGL
  screenshots were blank despite working terminal buffers/input, so this run
  does not certify WebGL visual output; no renderer code was changed.
- Shell syntax and actionlint passed. The actual release-packaging shell produced
  all 14 expected names and verified SHA256 checksums from isolated fixture
  artifacts. Parsed workflows retained only new-tag triggers and reusable
  workflows, with native/container success still gating the draft release.
- CLI consistency passed against native (30 built/31 documented) and static
  (31/31) help, including IPv6's conditional absence. Throwaway smoke cases
  rejected missing/stale options, alias mismatch, duplicates and stale generated
  definitions; actual checker processes returned failure on documentation drift
  and executable failure. The man page was regenerated and local documentation
  paths/anchors checked.
- Limits: no hosted release, publication, non-x86/Windows build or snap
  installation was performed for this reorganization. No frontend sources or
  bundled assets changed; frontend builds and transfer/sixel checks were not
  repeated. Historical checks above retain their original scope and limits.

## Fork naming transition — 2026-11-03

- The project/repository and installable image/package identities are `ttyd-ng`;
  the binary, CLI, CMake target, installed executable and manual remain `ttyd`.
  Publishing derives `ghcr.io/<lowercase-owner>/ttyd-ng` independently of the
  repository basename, retaining exact version and `-alpine` tags. Container
  metadata and current fork links use the renamed project. Upstream attribution
  remains intact, and the earlier publication record still describes the
  pre-rename namespace rather than claiming a retroactive rename.
- At the naming transition, Snap was the only package recipe present and was
  renamed `ttyd-ng`, retaining its `ttyd` app and `usr/bin/ttyd` command. Snap has
  no deb/rpm-style `Conflicts`/`Provides` fields. The qualified command and optional
  manual alias were documented at that time; automatic conflict enforcement or
  Store aliases were not claimed. The recipe and guidance were subsequently
  removed as recorded below.
- Verification: pinned Yarn immutable install, frontend checks/build, native
  Release configure/build and an amd64 musl executable rebuild passed. Native
  CLI consistency passed. Real temporary native/static installations produced
  `bin/ttyd` and `share/man/man1/ttyd.1`, not `bin/ttyd-ng`, and ran `--version`;
  native installation used the matching custom-prefix runtime library path.
- Both renamed amd64 container variants built locally and ran `ttyd --version`
  through their existing entrypoints. Image metadata named ttyd-ng and retained
  default command `ttyd -W bash`; container help used the renamed fork URL.
  The actual tag shell passed old/new repository-basename and mixed-case-owner
  cases. Shell syntax and actionlint passed. A non-README reference scan found
  no stale old image/fork URL references, and local documentation links passed.
- Parsed Snap YAML retained the executable/part contract without unsupported
  conflict/provision keys. All three README checksums were unchanged. No repo
  settings, credentials, releases or remote image publications were changed.
- Limits: Snapcraft and snap are unavailable locally, so snap pack/install and
  alias behavior were not exercised. Windows and non-amd64 builds were not
  repeated; the image checks do not certify those environments.

## Snap packaging removal — 2026-11-03

- Removed the unused `snap/` recipe because this fork is not distributing or
  validating Snap packages. Removed current installation/alias instructions,
  support claims, release checklist requirements and contributor references.
- Native binaries, release downloads and container packaging are unaffected.
  Earlier Snap mentions in this document remain historical evidence, not current
  support or installation guidance.

## Sources

- [Node release lifecycle](https://nodejs.org/en/about/previous-releases)
- [Yarn installation and Corepack](https://yarnpkg.com/corepack)
- [xterm.js releases](https://github.com/xtermjs/xterm.js/releases)
- [json-c 0.19 changes](https://raw.githubusercontent.com/json-c/json-c/json-c-0.19-20260627/ChangeLog)
- [OpenSSL source releases](https://openssl-library.org/source/) and
  [support policy](https://openssl-library.org/policies/releasestrat/)
- [libuv 1.53.0 changes](https://raw.githubusercontent.com/libuv/libuv/v1.53.0/ChangeLog)
- [libwebsockets maintenance changes](https://github.com/warmcat/libwebsockets/compare/v4.5.7...v4.5.8)
- [Cross toolchain releases](https://github.com/tsl0922/musl-toolchains/releases)
- [Alpine support](https://alpinelinux.org/releases/) and
  [Ubuntu lifecycle](https://ubuntu.com/about/release-cycle)
- Ubuntu 24.04 packages: [json-c](https://packages.ubuntu.com/noble/libjson-c5),
  [libwebsockets](https://packages.ubuntu.com/noble/libwebsockets19t64),
  [libuv event plugin](https://packages.ubuntu.com/noble/libwebsockets-evlib-uv)

## Linux end-to-end regression suite (2026-11-03)

Added `tests/` with its own pinned Yarn 4.18.1 lockfile, Playwright 1.64.1,
Chromium and `ws` 8.22.1. The suite runs the rebuilt native executable and its
embedded frontend against a raw/noecho Python PTY fixture; no application mock
or frontend development server is involved. The Linux native reusable workflow
now runs the suite and retains failure diagnostics, without adding branch/PR
triggers or changing publication policy.

The first run exposed a native crash: after a valid WebSocket session, an empty
binary message terminated ttyd with `SIGSEGV`. `LWS_CALLBACK_RECEIVE` allocated
zero bytes through `xmalloc(0)` and dereferenced the resulting null buffer.
The approved fix ignores empty messages when no data is buffered and avoids
reallocation/copying for empty continuations while still dispatching buffered
data on an empty final continuation. The same previously failing regression
passed after rebuilding; authenticated fragmented handshakes and input also
passed with empty first, intermediate and final fragments.

The integrated run passed all 16 tests locally; the final repeatability run passed
32/32 executions (`--repeat-each=2`), using two workers and no retries. The host
was Linux x86-64, Node 26.13.0, Python 3.12 and the locally linked libwebsockets
4.5.7, using the Playwright
Chromium build. Native CMake configure/build, the immutable test-package install,
CLI/manual consistency (30 built options, 31 documented), and actionlint 1.7.11
workflow validation also passed. A separate real-browser smoke visibly rendered
keyboard input and its `/usr/bin/cat` response on loopback.

Two initial test-harness failures were corrected rather than changing server
behavior: the disconnect test now observes actual child reaping instead of
expecting Playwright socket events after page destruction; the immediate-exit
test disables reconnect so it observes exactly one fixture session. On this
libwebsockets build, child exit status zero was observed as browser close code
1006. Output-before-close passed, but normal-close signaling and reconnect
policy are not certified by that test.

No Windows, macOS, other-browser, TLS/mTLS, clipboard, SIXEL, transfer,
cross-target, container or hosted-release execution is claimed. See
[the test guide](../tests/README.md) for commands, isolation and coverage limits.


## WebSocket compression and libwebsockets 5.1.0 (2026-11-04)

Investigated a report that pasting 32 KiB or more kills the WebSocket. Reproduced
with the installed 1.9.0 release binary (libwebsockets 4.5.8): the server logs
`lws_extension_callback_pm_deflate: rx buffer underflow`, the browser sees close
code 1006 and reconnects, which looks like a reload. Repeated-byte input failed
from 2048 bytes and passed through 1 MiB with client compression disabled, so
the cause is compressed receive, not a size limit. The local `build/native`
libwebsockets 4.5.7 has `LWS_WITHOUT_EXTENSIONS`, which hid the bug.

Built libwebsockets 5.1.0 separately (OpenSSL, `LWS_WITH_HTTP3=OFF` because it
otherwise forces GnuTLS, extensions on) and linked ttyd against it. Findings:

- ttyd exited immediately: 5.x `lws_service()` runs one loop iteration per call.
  Fixed by looping until `force_exit`; SIGINT shutdown exits 0.
- 2048 bytes to 1 MiB of repeated bytes pass, so the 4.5.8 failure is fixed.
- Random base64 text loses about 19% of the message silently: 32 KiB delivered
  26,624 bytes. Tracing `LWS_CALLBACK_RECEIVE` showed libwebsockets delivering a
  well-formed `final` message of 26,625 bytes for 32,769 sent, so ttyd's
  reassembly was not at fault. Without compression the same payloads, up to
  8 MiB, arrived intact on 5.1.0, the 4.5.8 release and the 4.5.7 build.
- The new regression tests fail on 5.1.0 with compression and pass without it:
  protocol varied-input case and a real Chromium clipboard paste. The default
  build passes the suite (17 passed, 2 skipped).

Decision: do not register `permessage-deflate` for libwebsockets >=4.4.0 unless
built with `TTYD_LWS_PMD_TRUSTED=ON`. Not adopted: bumping the cross-build pin to
5.1.0.

File transfers hung at `::TRZSZ:TRANSFER:S:...` (reported in a real browser too).
Cause: the shell ttyd spawned inherited `TMUX` from the environment that launched
ttyd. trzsz then enters tmux mode (trigger id ends in `20`), and writes its replies
to the tmux client's TTY instead of ttyd's PTY, so the browser never receives them.
The trzsz Python server source and a bare-PTY run showed the writer is the tmux TTY.
With `TMUX`/`TMUX_PANE` unset, a 1 MiB upload and download matched SHA-256 in
headless Chromium on the libwebsockets 5.1.0 build (compression off), with both
`trzsz` 1.1.6 (Python) and 1.2.0 (Go) server tools. The browser's file pickers were
stubbed in-page because headless Chromium cannot show them; the protocol traffic
was real. Not exercised: SIXEL, tmux itself, and real file-picker dialogs.

## mTLS rejects valid client certificates on OpenSSL >=4.1.0 (2026-11-09)

Investigated an upstream report (tsl0922/ttyd#1583/#1584) that mTLS rejects
valid client certificates on OpenSSL 4.1.0, with
`client certificate verification error: ok (0), depth: 1`. The pinned cross
OpenSSL (3.5.9 LTS) and the local system's (3.6.5) both predate the change and
do not reproduce it; OpenSSL 4.x is not yet packaged by any distro used here.

Built OpenSSL 4.1.0 from its official source tarball into an isolated prefix,
then rebuilt libwebsockets 4.5.8 (the project's pinned version) and a separate
ttyd against it, all linked to confirm (`ldd`: `libssl.so.4`/`libcrypto.so.4`
from the custom prefix, not the system's `libssl.so.3`). Generated a local CA,
server cert and CA-signed client cert.

Reproduced exactly: `ttyd -S -C server.pem -K key.pem -A ca.pem -W bash`
rejected the CA-signed client cert with the literal upstream error string,
and `openssl s_client`/`curl --cert` both failed the handshake. The root
cause matches the report: `src/http.c`'s
`LWS_CALLBACK_OPENSSL_PERFORM_CLIENT_CERT_VERIFICATION` handler called
`SSL_get_verify_result()`, which is not yet updated inside that callback.

Fixed by using only `!len` (`preverify_ok`, which libwebsockets already
passes), matching PR #1584 verbatim. Rebuilt and reverified against the same
OpenSSL 4.1.0 stack: valid client cert now reaches `/token` (HTTP 200);
untrusted (self-signed, not CA-signed) and missing client certs are still
rejected, confirmed both at the TLS layer (`s_client`) and the application
layer (`curl`). The local `tests/` suite (system OpenSSL 3.6.5) shows no
regression, but does not exercise this path.

No automated regression test was added: reproducing this requires a
from-source OpenSSL 4.1.0 build, not just a build flag of the existing
pinned stack (contrast the compression fix's `TTYD_LWS_PMD_TRUSTED`), which
is too heavy to run on every CI invocation. This entry is the verification
record; `docs/releasing.md` notes when to re-run it by hand.

## PTY read stall on fd reuse (2026-11-09)

Fixed an upstream-reported bug (tsl0922/ttyd#1573): `read_cb` in `src/pty.c`
called `uv_read_stop()` unconditionally, then for a zero-byte read (libuv's
documented EAGAIN, not EOF) or `UV_ENOBUFS` returned without ever restarting
the read or freeing the allocated buffer. The reported trigger is pty file
descriptor reuse under session churn: a session's pty closes, a new
session's pty reuses the same fd number, and a stale epoll readiness event
for the old fd lands on the new handle, producing a spurious zero-byte read
that then stops that pty from ever being read again. Symptom: the WebSocket
opens normally and stays open (pings keep flowing) but the terminal is blank
forever; only a full ttyd restart clears it. The upstream PR documents two
independent real-world reproductions: 137/300 stalled sessions in a 900-session
stress reproducer against `login` before the fix, 0/900 after; 2-3 blank
terminals out of 20 concurrent real users in production, 0 after.

Fixed by restarting the read (`uv_read_start(stream, alloc_cb, read_cb)`) and
freeing the buffer on that branch instead of returning early, matching the
upstream PR verbatim.

Attempted to reproduce the race locally before concluding the fix was
correct by inspection alone. Wrote a churn stress test opening many
concurrent short-lived sessions against one ttyd instance, each waiting for
its `READY` output before closing: 300 sessions (20 concurrent) against the
unfixed code showed 0 stalls; scaled to 2000 sessions (40 concurrent), still
0; scaled to 3200 sessions (80 concurrent) with abrupt `terminate()` closes
(TCP RST, no WS close handshake) instead of clean closes, still 0. Upstream's
own PR already frames the race as rare outside specific conditions (about 1%
with a short-lived exec under a plain reproducer, much higher with `login`'s
heavier syscall profile, or real multi-user production load over hours); this
sandbox's kernel/libuv combination did not trigger the specific stale-epoll
condition even at 3200 sessions. The fix was applied on the strength of
libuv's documented `nread == 0` contract and the upstream PR's two
independent production reproductions, not a fresh local repro. No regression
test was added: it would have passed on both the fixed and unfixed code here,
so it would not actually test anything.

## Origin checking with HTTP/2 and TLS-terminating proxies (2026-11-17)

Addressed [upstream #1566](https://github.com/tsl0922/ttyd/issues/1566) in
`check_host_origin()`. The comparison now prefers HTTP/2 `:authority`, falling
back to HTTP/1.1 Host only when the pseudo-header is absent. A conflicting Host
cannot override `:authority`. The token reference is guarded by `LWS_ROLE_H2`
for HTTP/1-only builds. Origin parsing uses separate source/destination buffers,
initializes the port, rejects an unset port, checks formatting length, and puts
brackets back around IPv6 literals.

Preserved existing default-port spelling rather than introducing authority
normalization. HTTPS Origin with a matching public Host is still accepted over
plain HTTP from a TLS-terminating proxy. No trust was added for forwarded
headers and no requirement was added for Origin's scheme to match the backend
transport.

Rebuilt pinned libwebsockets 4.5.8 with libuv and HTTP/2. The new real RFC 8441
test failed against the pre-fix executable (no successful CONNECT response);
after rebuilding ttyd it passed, delivering the PTY fixture's READY output and
an input/echo round trip. A conflicting Host matching Origin cannot authorize
a mismatched `:authority`. HTTP/1 tests passed for HTTPS-to-HTTP proxy-shaped
headers, custom ports, case-insensitive hostnames, bracketed IPv6, and rejection
of wrong authorities, null/unknown-scheme origins and forged forwarded headers.
These exercise real sockets and PTYs, not the user's actual proxy deployment.
The upstream five-second browser fallback explanation was not separately
verified. A separate libwebsockets build with `LWS_WITH_HTTP2=OFF` and ttyd
compilation also succeeded.

Final verification: full browser/protocol suite 22 passed, 2 compression-dependent
tests skipped; CLI documentation consistency passed. Against the HTTP/1-only
build, origin coverage had 3 passed and the HTTP/2 test explicitly skipped.


## MSVC option-buffer compilation failure (2026-11-17)

The 1.9.2 release build failed on MSVC because `calc_command_start()` sized
`plus_opt_string` with `strlen()`, creating a variable-length array unsupported
by MSVC. Declare `opt_string` as a character array and size the prefixed buffer
with `sizeof(opt_string) + 1`, preserving the leading `+` and terminating NUL
without changing option parsing.

Local native configure/build passed with `-Werror=vla`; the existing
option-like command-argument regression passed, and CLI documentation
consistency passed. Windows/MSVC compilation still requires CI verification.

## Mobile PWA and installed-only accessory keys (2026-11-18)

Added a relative install manifest, deterministic 192/512px PNG icons and a
180px Apple touch icon to the embedded frontend. Native routes retain HTTP
authentication and base-path boundaries; metadata/icons and token responses use
no-store. There is no service worker or offline cache. Manifest identity, scope
and launch URL omit query arguments and fragments.

Regular secure mobile browsers offer optional install guidance or an explicit
browser install prompt. Dismissal is scoped to the terminal path: sessionStorage
for Not now and localStorage for persistent dismissal, with blocked-storage
fallback. Installed mobile clients alone get the accessory row. It uses public
xterm input/mode APIs for Escape, Tab, one-shot Ctrl/Alt and repeating arrows,
fits the terminal to the visual viewport and has a Keys/Auto override for
floating keyboards. Listeners/timers and armed modifiers are cleared on their
respective disposal, focus and connection boundaries.

Pinned immutable frontend installation, type/lint checks, production asset
generation, native configure and compilation passed. The first 52-case suite
run had 44 passes, 2 compression-dependent skips and 6 failures. Corrected a
toolbar stacking bug (xterm's canvas intercepted the manual override), replaced
Fetch in PWA HTTP tests so actual 407 proxy-auth responses could be inspected,
and allowed expected EPIPE/ECONNRESET on an oversized fragment while still
requiring session rejection and fresh authenticated service recovery.

Focused reruns passed all 13 keyboard/asset cases and the oversized-message
case. After strengthening the mobile read-only resize barrier and removing a
log-wording assertion, the two rejection cases passed again. All 28 new PWA
cases passed across these runs; no single all-green full-suite rerun is claimed.
Coverage includes real PTY bytes, application cursor mode, single-character
paste, committed Unicode text, viewport fitting/dismissal, root/nested paths,
Basic/proxy authentication, decoded PNGs and install-hint state transitions.

Opened the rebuilt native UI in Chromium mobile emulation: the install flyout
and DOM-rendered accessory layout were visually inspected, and the Ctrl key
interrupted a real shell's sleep command. Chromium reported no manifest or
installability errors. Mobile-emulated WebGL rendering was blank in both this
build and the pre-feature `build/origin-noh2/ttyd` baseline; this does not prove a
PWA regression or establish its cause. Visual output inspection used DOM
fallback instead.

Standalone-display and install-prompt signals in automated coverage are
simulated. Actual installation, iOS keyboard animations/IME, floating or split
keyboards, physical keyboard transitions, authenticated OS installation fetches
and the deployment's HTTPS proxy were not exercised. Those remain explicit
physical-device release gates, not verified behavior. Windows, cross-target
builds, containers, sixel and file transfers were not exercised for this change.

Built the PWA checkout as `build/cross/x86_64/ttyd` using the existing musl
toolchain/stage: zlib 1.3.2, json-c 0.19, libuv 1.53.0, OpenSSL 3.5.9 and
libwebsockets 4.5.8. `file` reports a stripped, statically linked x86-64 ELF.
Version/help consistency and three focused tests passed against this artifact:
root/nested PWA metadata with decoded icons and musl command-argument parsing.
These checks ran on the Linux build host, not Alpine; Alpine and physical-device
testing remain external validation. The executable includes uncommitted PWA
sources despite reporting the base commit version `1.9.2-9777848`.

### Accessory touch focus, Paste and key symbols

The user reported that the Alpine artifact works, but accessory taps sometimes
close the native keyboard. Added non-passive touchstart/touchend default
cancellation alongside pointer/mouse handling, with synchronous textarea focus
restoration inside the control gesture. This addresses the touch-focus path;
the physical-device symptom has not yet been retested against the revision.

Added an explicit Paste key using the browser clipboard API on pointer release
or accessibility activation. It clears armed modifiers and uses xterm's paste
API, preserving bracketed-paste mode and input gating. Permission failures show
dismissible manual-paste guidance; pending results cannot enter a different
connection after reconnect. Browser-owned clipboard permission UI may still
temporarily dismiss the keyboard.

Replaced key words/line arrows with conventional ShellFish-style Tab, Control,
Option and filled-arrow symbols, keeping accessible names. The clipboard SVG is
original artwork rather than a redistributed native icon asset. Nine keys
remain on one row with 44px height and reduced gaps.

Frontend type/lint checks and production generation passed; native and cached
static-musl x86-64 builds passed. All nine accessory tests passed against the
static artifact in Chromium mobile emulation, including real clipboard reads,
literal input, bracketed paste, denied-access recovery, reconnect isolation and
read-only behavior. Failure/delay clipboard responses were simulated; permission
dialogs and iOS native keyboard visibility were not. Visually inspected the
updated row against the static executable using DOM rendering. The revised
binary and checksum are in `build/cross/x86_64/`; no release was published.

### Compact persistent row and native iOS strip limitation

The user reported substantially improved touch behavior, requested the standard
Escape symbol and smaller keys, and asked for the row to remain visible throughout
mobile PWA use. Escape now uses `⎋`; key height is 40px (previously 44px), with
16px symbols and an 18px clipboard outline. Removed the Keys/Auto button and its
forced-visibility state. The row remains visible through viewport changes, input
blur and disconnect; disconnected controls are disabled. Viewport inference now
only handles safe-area padding and modifier cleanup on keyboard dismissal.

The previous/next/dismiss strip is native iOS UI, not a webpage element.
[Ionic's platform guidance](https://ionicframework.com/docs/developing/keyboard#hiding-the-accessory-bar)
explicitly states that browser/PWA apps cannot hide it; native wrappers can.
[W3C editing issue #545](https://github.com/w3c/editing/issues/545) tracks a
requested browser opt-out and was still open when checked. No unsupported
input/focus workaround or redundant hide-keyboard key was added; the native
dismiss control remains available.

Frontend checks/build, native and static-musl x86-64 builds passed. All nine
accessory cases passed against the refreshed static artifact, including persistent
visibility after dismissal/blur, disabled controls during disconnect, clipboard
framing and reconnect isolation. Inspected the compact row and working Escape
control in Chromium mobile emulation with DOM rendering. Actual iOS native-strip
behavior and the revised layout still require device validation. Refreshed
`build/cross/x86_64/ttyd` and its adjacent checksum; nothing was published.

### Automatic disconnected controls and zoom persistence

The user requested automatic visibility only for disconnected controls and
reported that pinch magnification did not persist. Connected rows still remain
present; disconnected rows are disabled and shown only when keyboard occlusion
is inferred from the viewport. Keyboard inference normalizes visual height by
page scale to avoid mistaking magnification for an open keyboard.

The PWA controller previously resized its container to every visual viewport
change, including native zoom. It now preserves container geometry while zoomed.
All fitting paths in the terminal wrapper share a zoom-aware guard, and visual
viewport resize events resume normal fitting after zoom-out. A 16px font on the
hidden input avoids Safari's small-input focus auto-zoom without changing the
rendered terminal font. Native page zoom magnifies/pans the whole page rather
than changing the PTY grid; this is not terminal-only font resizing.

Frontend type/lint and production generation, native and static-musl x86-64
builds passed. The 19-case accessory/desktop browser run had 17 passes and two
test failures: the viewport test typed before the queued modifier reset, and
Chromium's synthetic touch-pinch command did not change page scale here. The
former now waits for observable modifier cleanup; the latter uses Chromium's
real page-scale API instead of claiming physical gesture coverage. Both focused
cases then passed. No all-green single 19-case rerun is claimed.

Verified native browser scaling remains above 1x while typing, preserves terminal
dimensions, and normal fitting/PTY resize resumes after zoom-out. Disconnected
visibility, clipboard safety, read-only mode, desktop resize/authentication and
renderer fallback passed across those runs. Visually inspected 2x page scaling
with DOM rendering: the terminal stayed at 46 columns and 52 rows. Actual iOS
pinch recognition and keyboard behavior remain device-test requirements.
Refreshed the Alpine-compatible binary and adjacent checksum.

### Keyboard-only visibility in all connection states

The user clarified the intended behavior: keyboard hidden means keys hidden;
keyboard visible means keys visible, regardless of connection state. Removed
the connected-session visibility exception and initialize the row hidden to
avoid an initial flash before viewport detection. Disconnected controls remain
disabled. There is no manual visibility toggle.

The user also confirmed that native pinch zoom still snaps back. That symptom
is unresolved. Per the user's request, no zoom behavior was changed or tested
in this correction; the existing browser-scale checks do not establish working
native pinch gestures.

Frontend checks/build and native/static-musl builds passed. Eight keyboard cases
passed in the selected run; the read-only case's resize barrier reused the new
500px keyboard-open viewport and therefore produced no resize. Changing its
barrier to 460px retained a real ordered resize, and that focused case passed.
Connected and disconnected show/hide transitions, focus retention, literal and
bracketed paste, stale-read isolation and read-only enforcement passed across
those runs. Zoom coverage was explicitly excluded from this keyboard-only run,
not disabled in the suite. Inspected the initially hidden row and observed
viewport-driven show/hide transitions in the rebuilt UI under mobile emulation;
actual native keyboard behavior still needs the user's device retest.

Refreshed `build/cross/x86_64/ttyd` and its adjacent checksum. No commit, push or
release was made.

### Right-end terminal text-size controls

Added an Aa button at the right end of the mobile PWA key row, opening a compact
minus/current-size/plus panel. It changes xterm's font size in 1px steps within
8–32px and refits through the existing fit path, notifying the real PTY without
sending input or scaling the key row. Taps retain textarea focus. Aa, outside
taps, keyboard dismissal and disconnect close the panel.

Sizes chosen through the panel persist in localStorage scoped to the terminal
path. Restore occurs after server/URL preferences on load/reconnect, so a saved
mobile choice overrides configured fontSize. Invalid/out-of-range stored values
are ignored. Storage denial still permits sizing and retains the in-page choice.
Desktop and ordinary mobile browser behavior are unchanged. No dependencies,
CLI options, server protocol changes or native pinch-zoom fixes were added.

Frontend type/lint and production generation, native and static-musl builds
passed. All 13 selected keyboard/text-size cases passed against the static
artifact in one run, including PTY dimensions, unchanged row height and browser
scale, retained focus, persistence after server preferences, 8/32px limits and
blocked storage. Existing clipboard/read-only/reconnect cases also passed.
Zoom coverage remained excluded; the reported native pinch issue is unresolved.

Visually inspected the right-end button and open size panel under Chromium mobile
emulation using native touch dispatch and DOM rendering. Increasing text size
retained input focus and page scale 1. Keyboard presence was emulated by viewport
occlusion; actual iPhone/iPad keyboard behavior still needs device verification.
Regenerated src/html.h and refreshed build/cross/x86_64/ttyd plus its checksum.
No commit, push or release was made.

### Arrow order and removal of the application paste warning

Reordered the four arrows to Left, Right, Up, Down. The real-PTY regression now
taps them in displayed order and checks the resulting direction sequences.

The user confirmed that the Paste button works but long-press pasting does not,
and requested removal of the "Paste unavailable" popup. Removed the popup DOM,
dismiss control, lifecycle state and CSS, along with the misleading manual-paste
advice. Clipboard reads and xterm paste handling are unchanged when access
succeeds; a canceled/unavailable read returns without application feedback and
re-enables the button. Browser-owned clipboard permission UI is not suppressed.

Frontend checks/production generation and native/static-musl builds passed.
All 13 selected keyboard/text-size cases passed against the refreshed static
binary, including displayed arrow order at the PTY, successful literal/bracketed
paste, denied-access continued typing without a popup, reconnect safety and
font sizing. Visually inspected the reordered row in Chromium mobile emulation
with DOM rendering. Native pinch zoom and touch selection remain deferred.
Updated build/cross/x86_64/ttyd and its checksum; no commit, push or release.

### Explicit mobile selection and copy

Added mobile-PWA-only Select text directly after Paste in an 11-control row:
14px labels, 16px icons and unchanged 40px button height, including narrow 320px
layouts. The independent Terminal selection panel prompts for the first and last
cell; two taps select an inclusive range in either direction through xterm's
public selection API, without synthetic mouse events or PTY input.

Selection requires explicit Copy, never automatic copying or OSC 52. Clipboard
write falls back to legacy copying, then a native read-only Selected text field
with manual-selection and Copy-retry access. Only API-reported success displays
Copied. The panel remains accessible after the keyboard hides the toolbar.
Viewport resize clears its range/start anchor; Done restores terminal focus and
clears selection, while disconnect, blur and document hiding close the panel.
Read-only terminals retain Select/Copy without weakening input enforcement. Desktop
selection and ordinary mobile-browser-tab behavior are unchanged.

Focused regression scenarios were added for real permission-granted clipboard
copy, denied clipboard/legacy-copy fallback with exact reverse-multiline text,
retry, application mouse-reporting isolation, ordered PTY input barriers,
keyboard-hidden panel access, resize/cleanup, read-only behavior and narrow row
  bounds. Frontend checks/production generation and native/static-musl builds
  passed. The first selected run passed 19/22 cases; three new assertions
  incorrectly assumed server read-only disables frontend keys, or resized an
  already fixed-width mobile page into browser page scaling. Corrected those
  test assumptions without changing application behavior. The five-case
  correction run passed, including real legacy clipboard copying with the
  modern API unavailable and real clipboard retry after simulated denial.
  The retained keyboard/selection scenarios passed across these runs; the
  known-unresolved native pinch path was excluded.

Visually inspected the one-row controls and highlighted two-tap selection with
Copy/Done in Chromium mobile emulation using DOM rendering. Updated
`build/cross/x86_64/ttyd` and its checksum. Physical iOS selection, native
manual-copy fallback and keyboard behavior remain unverified. The reported
native pinch snap-back remains unresolved, and denied Paste still has no
application popup or long-press advice. Nothing committed, pushed or released.

### Preserve keyboard focus and dismiss selection after copy

Following a device report that Copy dismisses the keyboard, selection no longer
explicitly blurs xterm. Copy and the renamed Close control reuse the accessory
keys' focus-preserving touch/pointer activation, invoking clipboard access on
release. Successful modern or legacy copying clears selection and closes its
panel; failure retains the native manual-copy fallback and retry.

Frontend checks/production generation and native/static-musl builds passed.
All 22 selected keyboard/selection cases passed, including no input-textarea
blur through modern Copy, automatic dismissal, real clipboard contents,
legacy copying, denied-copy retry and Close cancellation. The unresolved
browser-zoom case was excluded. Chromium mobile-emulation UI inspection showed
Copy/Close, retained input focus, matching clipboard text and a hidden panel
after Copy. Physical iOS keyboard/permission behavior still needs retesting.
Refreshed `build/cross/x86_64/ttyd` and its checksum. No commit, push or release.

### Vim copy investigation

A local real Vim 9.2 session using the alternate screen and mouse reporting
copied the selected text to Chromium's clipboard through the PWA controls,
closed the selection panel and retained terminal focus. No source fix was made.
The user subsequently reported that copying worked after refreshing the PWA,
including tmux → Vim, and planned further device testing. The cause of the
earlier stale clipboard was not established.
