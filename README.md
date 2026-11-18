![release](https://github.com/Lanjelin/ttyd-ng/actions/workflows/release.yml/badge.svg)
[![GitHub Releases](https://img.shields.io/github/downloads/Lanjelin/ttyd-ng/total)](https://github.com/Lanjelin/ttyd-ng/releases)
![GitHub](https://img.shields.io/github/license/Lanjelin/ttyd-ng)

# ttyd-ng - Share your terminal over the web

ttyd-ng is a command-line tool for sharing terminal over the web, forked from
[tsl0922/ttyd](https://github.com/tsl0922/ttyd). The executable is named `ttyd`
for compatibility with existing scripts and services.

Install binaries or container images from
[Lanjelin/ttyd-ng](https://github.com/Lanjelin/ttyd-ng) to use features such as
custom font loading. Upstream releases and distribution packages may not include
these features.

- [Command and client-option reference](man/ttyd.man.md)
- [Build guide](docs/building.md)
- [Current compatibility and known risks](MODERNIZATION.md)

https://github.com/user-attachments/assets/6b96cacc-2b19-4f0a-aad0-0688fcd81743

23-second demo: Nerd Font file icons, SIXEL graphics, truecolor output, and live
terminal resizing.

# Features

- Built on top of [libuv](https://libuv.org) and [WebGL2](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API) for speed
- Fully-featured terminal with [CJK](https://en.wikipedia.org/wiki/CJK_characters) and IME support
- [ZMODEM](https://en.wikipedia.org/wiki/ZMODEM) ([lrzsz](https://ohse.de/uwe/software/lrzsz.html)) / [trzsz](https://trzsz.github.io) file transfer support
- [Sixel](https://en.wikipedia.org/wiki/Sixel) image output support ([img2sixel](https://saitoha.github.io/libsixel) / [lsix](https://github.com/hackerb9/lsix))
- SSL support based on [OpenSSL](https://www.openssl.org) / [Mbed TLS](https://github.com/Mbed-TLS/mbedtls)
- Run any custom command with options
- Basic authentication support and many other custom options
- Cross platform: macOS, Linux, FreeBSD/OpenBSD, [OpenWrt](https://openwrt.org), Windows

# Installation

## Download binaries

Download prebuilt binaries from the
[ttyd-ng Releases page](https://github.com/Lanjelin/ttyd-ng/releases).

1. Choose a release and read its notes.
2. Download the binary matching your operating system and architecture, plus
   that release's `SHA256SUMS`.
3. Verify the checksum before installing or running the binary.

| Platform | Release asset |
| --- | --- |
| Linux x86-64, including Alpine | `ttyd.x86_64` |
| Linux ARM64 | `ttyd.aarch64` |
| Linux 32-bit x86 | `ttyd.i686` |
| Linux PowerPC64 little-endian | `ttyd.ppc64le` |
| Linux s390x | `ttyd.s390x` |
| Windows x64 | `ttyd.msvc.exe` or `ttyd.win32.exe` (both are 64-bit) |

For other ARM/MIPS variants, match both the architecture and ABI when selecting
an asset. On macOS, [build from source](docs/building.md#native-build).

### Linux download and user-local installation

The following example is for Linux x86-64. Replace `TAG` with the exact published
tag from this repository's Releases page, including a leading `v` if present.
For another Linux architecture, change `ASSET` using the table above.

```sh
TAG='REPLACE_WITH_PUBLISHED_TAG'
ASSET='ttyd.x86_64'
URL="https://github.com/Lanjelin/ttyd-ng/releases/download/$TAG"
mkdir -p ttyd-download &&
  cd ttyd-download &&
  curl --fail --location --output "$ASSET" "$URL/$ASSET" &&
  curl --fail --location --output SHA256SUMS "$URL/SHA256SUMS" &&
  sha256sum --check --ignore-missing SHA256SUMS &&
  mkdir -p "$HOME/.local/bin" &&
  install -m 0755 "$ASSET" "$HOME/.local/bin/ttyd"
```

Run `"$HOME/.local/bin/ttyd" --version` to check the installed binary. Add
`"$HOME/.local/bin"` to your `PATH` if needed. The checksum command uses GNU
`sha256sum`; it checks the downloaded asset while ignoring other release
assets that were not downloaded.

On Windows, download an x64 `.exe` and `SHA256SUMS` from the same release.
Use PowerShell's `Get-FileHash .\ttyd.msvc.exe -Algorithm SHA256` (or the
`ttyd.win32.exe` filename) and compare it with the corresponding checksum entry.
Then run the executable directly or place it in a directory on your `PATH`.

Distribution and third-party packages named `ttyd` are not maintained by this
project and may install a different version. Use the releases above to install
ttyd-ng.

### Install with mise

[mise](https://mise.jdx.dev/) can install the release binary directly from this
repository. Add the following to your `mise.toml`, choosing your desired
`version` and setting `matching` to the release asset for your platform:

```toml
[tools]
"github:Lanjelin/ttyd-ng" = { version = "latest", matching = "ttyd.x86_64", bin = "ttyd" }
```

Then install and check the executable from the directory containing `mise.toml`:

```sh
mise install
mise exec -- ttyd --version
```

This example selects the latest Linux x86-64 build. Use the release asset table
above to choose another build.

### Container images

Container images are available from GHCR with explicit version tags:

```text
ghcr.io/lanjelin/ttyd-ng:<tag>
ghcr.io/lanjelin/ttyd-ng:<tag>-alpine
```

Replace `<tag>` with the exact release tag, including a leading `v` if present.
There are no `latest`/`alpine` aliases. See the
[build guide](docs/building.md#local-container-images) to build an image locally.

## Build from source

Install the prerequisites in the [build guide](docs/building.md#native-build),
then run:

```sh
cmake -S . -B build/native -DCMAKE_BUILD_TYPE=Release
cmake --build build/native --parallel
./build/native/ttyd -i 127.0.0.1 -W bash
```

The committed browser bundle allows native-only builds without Node.js. See the
build guide for frontend rebuilds, Alpine-compatible static binaries, and local
container images.

# Usage

## Quick start

```sh
ttyd -i 127.0.0.1 -W bash
```

Open `http://127.0.0.1:7681/`. Omit `-W` for a read-only terminal. Keep test
shells on loopback; configure authentication and transport security before
exposing a deployment.

Use `ttyd --help` for options available in your build. The
[manual](man/ttyd.man.md) is the authoritative detailed CLI and client-option
reference; the installed equivalent is `man ttyd`.

## Optional client settings

- **Rendering:** If you see distorted text, borders, or colors, try
  `-t rendererType=dom` instead of the default WebGL renderer.
- **File transfers:** Enable with `-t enableTrzsz=true`; install `trzsz` where the
  shell runs, then use `trz` to upload or `tsz file` to download.
- **SIXEL graphics:** Enable with `-t enableSixel=true`; requires an application
  that outputs SIXEL. Multiplexers may require additional configuration.

See the [manual](man/ttyd.man.md#client-options) for more client options.

## Custom terminal font

Serve one regular font file outside the executable, or have browsers fetch a
font file directly:

```sh
ttyd -i 127.0.0.1 --font /srv/fonts/JetBrainsMonoNerdFont-Regular.woff2 -W bash
ttyd -i 127.0.0.1 --font https://example.com/fonts/JetBrainsMonoNerdFont-Regular.woff2 -W bash
```

[Nerd Fonts WOFF2](https://nick2bad4u.github.io/nerd-fonts-woff2/) is a possible
third-party source of CDN-hosted webfonts. Choose a regular monospace font and
copy its direct `.woff2` CDN URL into `--font`; the font browser's page URL is
not a font-file URL.

Local fonts use the terminal's HTTP authentication and base path; their
directory is not exposed. A loaded font is selected automatically. Remote URLs
must point to font files, not stylesheets, and depend on browser connectivity,
CORS, HTTPS/mixed-content rules, and CSP. See the
[font reference](man/ttyd.man.md#custom-font) for formats, preference precedence,
fallback, and weight/style limits.

## Mobile installed app

Serve the bundled client over HTTPS (a TLS-terminating reverse proxy is fine),
then install it from your mobile browser. On iPhone/iPad, use **Share → Add to
Home Screen**, enabling **Open as Web App** if offered. Other supported browsers
offer **Install app** or **Add to Home screen**.

- Installed mobile/tablet windows show extra keys only while the keyboard is
  visible, whether connected or disconnected. The 11 controls use 14px labels,
  16px icons and the same 40px height, including on a 320px-wide screen. Symbols
  are `⎋` (Escape), `⇥` (Tab), `⌃` (Ctrl) and `⌥` (Alt), with filled arrows and
  an original clipboard outline.
  Ctrl/Alt apply to the next supported character; tap again to cancel.
  Hold an arrow to repeat. Arrow order: Left, Right, Up, Down.
  Cmd is not a standard terminal modifier.
- Tap **Aa** at the right end of the row for **− / +** text-size controls
  (8–32px, 1px steps). This changes terminal text and refits the PTY, not browser
  zoom or key sizes. Tap Aa again or outside the panel to close it; hiding the
  keyboard also closes it. The chosen size is remembered per terminal path
  when local storage is available, overriding configured `fontSize` in the
  mobile PWA. Desktop/browser-tab preferences are unchanged.
- Paste reads the clipboard only when tapped, through the browser's clipboard
  API. It requires a secure context and browser permission; a native permission
  or paste popup may temporarily dismiss the keyboard. Canceled or unavailable
  clipboard access does not show an application warning or long-press advice.
  Bracketed paste and read-only enforcement remain intact; a pending clipboard
  result is discarded if the session changes.
- Tap **Select text**, immediately after Paste, then tap the first and last
  terminal cells to select an inclusive range (either direction, across lines).
  The independent **Terminal selection** panel prompts **Tap selection start**
  and **Tap selection end**. Selection does not send terminal input or mouse
  reports, including in applications with mouse reporting enabled.
  Tap **Copy** explicitly; selecting text never copies automatically. Copy tries
  the browser clipboard API, then legacy browser copying. If both fail, a
  read-only **Selected text** field remains available for native manual selection
  and copying, or retry Copy. Successful copying closes the selection panel.
  This is browser-side copying, not OSC 52 clipboard integration.
- The selection panel remains available if the keyboard and key row disappear.
  A viewport resize clears the range/start point without closing the panel.
  **Close** clears selection and restores terminal focus; disconnect, window blur
  or a hidden page closes selection. Read-only terminals allow Select and Copy;
  terminal input remains blocked. Desktop selection behavior is unchanged.
  Selection and Copy/Close preserve input focus to avoid dismissing the keyboard.
  Browser permission UI and the native manual-copy fallback can still affect it.
- Keyboard visibility is inferred from viewport geometry. Keyboard hidden means
  the row is hidden; keyboard visible means the row is shown. Disconnected
  controls are disabled. There is no Keys/Auto toggle. Desktop windows and
  ordinary mobile browser tabs have no row.
- Device testing still reports pinch zoom snapping back. This remains unresolved;
  browser page-scale tests are not proof of working native pinch gestures.
- iOS's native previous/next/dismiss strip cannot be hidden by a browser or PWA;
  its keyboard-dismiss control remains available. Removing it requires a native
  wrapper, not a CSS or input-mode workaround.
- A mobile browser can show optional installation guidance. **Not now** hides it
  for the tab session; **Don't show again** remembers dismissal across visits
  for that terminal path. Browser storage restrictions may prevent persistence.
- Installation does not enable writing: `-W` is still required. It adds no
  offline mode, authentication bypass or guarantee of background connectivity.
  Use a server-side multiplexer such as tmux when session persistence matters.

The installed launch URL deliberately excludes query parameters and fragments.
URL-supplied command arguments and client settings are not saved into the app.
Keep the terminal's public base path stable and forward its manifest/icon
requests through the same authenticated HTTPS proxy. Browser/OS installation
and credential handling vary; installation behind authentication must be tested
in the target browser. Custom index pages must provide their own integration.
Physical iPhone/iPad and Android verification remains an outstanding release
requirement, including iOS two-tap selection, native manual-copy fallback and
keyboard dismissal; desktop mobile emulation is not sufficient.

## Browser Support

Modern browsers are supported; see the
[xterm.js browser support list](https://github.com/xtermjs/xterm.js#browser-support).

## Alternatives

* [Wetty](https://github.com/krishnasrinivas/wetty): [Node](https://nodejs.org) based web terminal (SSH/login)
* [GoTTY](https://github.com/yudai/gotty): [Go](https://golang.org) based web terminal

## Development

See the [build guide](docs/building.md), [end-to-end tests](tests/README.md),
[release procedures](docs/releasing.md), and [project history](docs/history.md)
for contributor and maintainer information.
