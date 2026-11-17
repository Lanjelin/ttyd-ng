# TODO

Prioritized by severity, not by effort. Bugs before features. Entries note
whether the defect was reproduced locally or matched by code inspection only;
see linked upstream issues/PRs for original reports.

## Done

- [x] **Reject plaintext WebSocket upgrades when SSL is enabled.** A plaintext
  (non-TLS) connection to `/ws` succeeded and spawned a shell even with `-S`
  and `-A <ca>` (mTLS) configured, bypassing client-certificate verification
  entirely. Reproduced locally before the fix (plaintext `ws://` reached an
  `-S -A` server and spawned the fixture process); fixed in `src/http.c`
  (`LWS_CALLBACK_HTTP_CONFIRM_UPGRADE`) and `src/server.c`/`server.h`
  (`server->ssl`). Verified after the fix: plaintext upgrade now fails the
  connection (both plain `-S` and `-S -A`), while HTTP still redirects to
  HTTPS, `/token` and a real `wss://` session work unchanged, and the full
  regression suite plus CLI-options check still pass.
  Matches upstream [tsl0922/ttyd#1550](https://github.com/tsl0922/ttyd/pull/1550).

- [x] **Static (musl) release binaries can crash on startup, and even a
  NULL-terminator-only fix still misparses the command.**
  `calc_command_start()` in `src/server.c` copied `argv` into a buffer sized
  exactly `argc`, with no NULL terminator, then ran `getopt_long` over it. A
  command ending in something that looks like a ttyd option taking a value
  (e.g. `bash -i`) made musl's `getopt` permute one slot past the end of the
  heap buffer; the corruption trapped at `free()`.
  **Reproduced locally**: `build/cross/x86_64/ttyd -i 127.0.0.1 -p 0 -W bash -i`
  exited 139 (SIGSEGV); the glibc `build/native` binary with the identical
  command line did not crash. Upstream's proposed fix
  ([#1576](https://github.com/tsl0922/ttyd/pull/1576), NULL-terminate the copy)
  was never run against a real musl binary ("Not built or run here" per the
  PR). **Verified that fix alone is insufficient**: applied in isolation, the
  crash is gone, but GNU getopt permutation keeps scanning past the command
  for more options and misreads the command's own trailing `-i` as ttyd's own
  `-i <interface>`, leaving no command at all (`ttyd: missing start command`).
  This additional defect is musl-specific in practice — the same input parses
  correctly on the glibc `build/native` binary even without the second fix,
  matching the upstream issue's own caveat ("glibc builds may not show the
  problem").
  Fixed here with both: the NULL terminator (freeing through index `argc`
  inclusive, since permutation can move a string there), plus a `+` prefix on
  the `getopt_long` optstring used only for this pre-scan, which disables
  permutation so it stops at the first non-option (the command) instead of
  scanning through it. Verified: all of `bash -i`, `bash -l`, `bash
  --noprofile`, and `-- bash -i` now produce the correct
  `start command: ...` log line on the musl cross binary with no crash;
  regression test added in `tests/protocol/session.spec.mjs` (also passes
  unchanged on `build/native`); full suite and CLI-options check pass.
  Matches [tsl0922/ttyd#1575](https://github.com/tsl0922/ttyd/issues/1575) /
  [#1576](https://github.com/tsl0922/ttyd/pull/1576); the permutation defect
  is not filed upstream.

- [x] **Unauthenticated WebSocket message size was unbounded.**
  `src/protocol.c` grew `pss->buffer` via `xrealloc(pss->buffer, pss->len +
  len)` with no cap, and the authentication check only ran after that growth
  for any message whose first byte isn't `JSON_DATA`. An unauthenticated
  client could force unbounded memory growth before the connection was
  rejected, by prefixing a never-finished fragmented message with `JSON_DATA`
  (`{`) to bypass the pre-auth command gate.
  Fixed with upstream's exact approach: a 10 MiB `MAX_MESSAGE_SIZE` cap
  checked on both the initial allocation and every subsequent `xrealloc`,
  closing the connection on overflow regardless of auth state or command
  type. 10 MiB was chosen because it comfortably exceeds any realistic
  single terminal message (tested up to 1 MiB/32 KiB elsewhere in this
  suite; trzsz/zmodem chunk their own protocol well below it), so normal
  pastes and file transfers are unaffected.
  Regression test added (`tests/protocol/session.spec.mjs`): a `-c`-protected
  server sent an unfinished 12 MiB fragmented message starting with `{`;
  verified the connection is closed, no events leak through, and a fresh
  authenticated session still works. Confirmed the test fails (hangs/never
  closes) with the cap reverted, and passes with it restored.
  Matches [tsl0922/ttyd#1544](https://github.com/tsl0922/ttyd/pull/1544).

- [x] **mTLS rejected valid client certificates on newer OpenSSL.**
  `src/http.c`'s `LWS_CALLBACK_OPENSSL_PERFORM_CLIENT_CERT_VERIFICATION`
  handler called `SSL_get_verify_result()`, which is not yet updated inside
  that callback on OpenSSL 4.1.0; libwebsockets already passes
  `preverify_ok` as `len`, which should be used instead.
  **Reproduced**: our pinned/system OpenSSL (3.5.9 LTS / 3.6.5) both predate
  4.1.0 and don't show it, so built OpenSSL 4.1.0 from source plus a
  libwebsockets 4.5.8 rebuild against it (full details and exact commands in
  `docs/history.md`'s 2026-11-09 entry). Got the literal upstream error,
  `client certificate verification error: ok (0), depth: 1`, for a valid
  CA-signed client certificate.
  Fixed with upstream's exact approach (`!len` only). Reverified on the same
  OpenSSL 4.1.0 stack: valid cert now reaches `/token` (200); untrusted
  (self-signed) and missing client certs are still rejected, at both the TLS
  and application layer. No regression in the local suite (system OpenSSL,
  doesn't exercise this path).
  No automated regression test: reproducing this needs a from-source OpenSSL
  4.1.0 build, not just a build flag of the existing stack, too heavy for
  routine CI. `docs/releasing.md` notes when to re-run it by hand.
  Matches [tsl0922/ttyd#1583](https://github.com/tsl0922/ttyd/issues/1583) /
  [#1584](https://github.com/tsl0922/ttyd/pull/1584).

- [x] **PTY reads could stall permanently.** `src/pty.c`'s `read_cb` called
  `uv_read_stop()` unconditionally, then for `n == 0` or `UV_ENOBUFS`
  returned without ever restarting the read or freeing the allocated
  buffer. Per libuv, `nread == 0` is EAGAIN/a spurious wakeup, not EOF; the
  reported trigger is pty file-descriptor reuse under session churn (a
  stale epoll readiness event for a just-closed pty landing on a new
  session's pty that reused the same fd number), leaving that connection's
  terminal blank forever, with the WebSocket staying open on pings.
  Fixed with upstream's exact approach: restart the read
  (`uv_read_start(stream, alloc_cb, read_cb)`) and free the buffer on that
  branch instead of returning early.
  **Not reproduced locally**: wrote a churn stress test (many concurrent
  short-lived sessions opened/closed rapidly) and ran it up to 3200
  sessions at concurrency 80, including abrupt `terminate()` closes, against
  the unfixed code; zero stalls. Upstream's own PR frames this as
  hard to reproduce outside specific conditions (~1% with a short-lived
  exec, much higher with `login`'s heavier syscall profile, or real
  multi-user production load over hours); this sandbox's kernel/libuv
  combination apparently doesn't trigger the specific stale-epoll-event
  condition even at that volume. The fix is applied on the strength of
  libuv's documented `nread == 0` contract and two independent real-world
  production reproductions in the upstream PR (one with a 900-session
  reproducer showing 137/300 stalled before, 0/900 after), not a fresh local
  repro. No regression test was added (would pass on both fixed and unfixed
  code here, so it wouldn't actually test anything).
  Matches [tsl0922/ttyd#1573](https://github.com/tsl0922/ttyd/pull/1573).

- [x] **`--check-origin` rejected matching HTTP/2 origins.** Fixed
  `check_host_origin()` to prefer `:authority` over `Host`, with the HTTP/2
  token guarded for builds without HTTP/2. Also removed overlapping-buffer
  formatting, initialized the parsed port, and restored brackets around IPv6
  literal authorities. Preserved existing default-port spelling and public
  Host matching when a reverse proxy terminates TLS; forwarded headers are
  not trusted. Real RFC 8441 regression failed before the fix and passes
  afterward, including terminal input/output and rejection of a forged Host
  that conflicts with `:authority`. See `docs/history.md` for verification.
  Matches [tsl0922/ttyd#1566](https://github.com/tsl0922/ttyd/issues/1566).

## Correctness bugs

- [ ] **Per-connection URL-argument array leak.** With `--url-arg` and at
  least one `arg=`, `pss->args` is heap-allocated in `src/protocol.c`, but
  disconnect cleanup frees each string without freeing the array itself.
  Matches [tsl0922/ttyd#1585](https://github.com/tsl0922/ttyd/pull/1585),
  which also tightens the `/ws` path match from a prefix `strncmp` to an exact
  `strcmp` (not shown to be exploitable here, since auth runs first either
  way, but it's an unintended prefix match).

## Frontend / lifecycle — lower urgency, real UX bugs

- [ ] **Child-exit race and invalid close code.** A fast command can close the
  WebSocket before its remaining PTY output is drained
  (`src/protocol.c`/`src/pty.c`). Separately, a nonzero child exit sends close
  code `1006`, which is reserved and not valid to send on the wire; the
  frontend's default auto-reconnect then resets the terminal on what was
  actually a normal command completion. Already partially documented in
  `MODERNIZATION.md`/`tests/README.md`.
  Relates to [tsl0922/ttyd#1429](https://github.com/tsl0922/ttyd/issues/1429).

- [ ] **Transfer cancellation/disposal is inconsistent.** In
  `html/src/components/terminal/xterm/addons/zmodem.ts`, Ctrl-C during a
  transfer denies the zmodem handshake but doesn't reliably clean up trzsz or
  local session state; the file-selection modal has no cancel path; the outer
  `Xterm.dispose()` doesn't close its WebSocket or terminal. Needs one
  coherent cancel/teardown path, not a dependency swap.

- [ ] **Clipboard copy reports success unconditionally.** The xterm
  selection-copy path in `html/src/components/terminal/xterm/index.ts` calls
  the deprecated `execCommand('copy')` and ignores its boolean result, always
  showing the "copied" indicator.

## Features (only where directly relevant)

- No feature work is prioritized ahead of the items above.
- OSC 52 clipboard support ([tsl0922/ttyd#1586](https://github.com/tsl0922/ttyd/issues/1586))
  is **already shipped**: `ClipboardAddon` is loaded unconditionally in
  `html/src/components/terminal/xterm/index.ts`. Nothing to do here; noted so
  it isn't re-requested as new work.
