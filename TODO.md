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

## Security / crash — do before anything else

- [ ] **Static (musl) release binaries can crash on startup.**
  `calc_command_start()` in `src/server.c` copies `argv` into a buffer sized
  exactly `argc`, with no NULL terminator, then runs `getopt_long` over it. If
  the user's command ends in something that looks like a ttyd option taking a
  value (e.g. `bash -i`), musl's `getopt` permutes one slot past the end of the
  heap buffer; the corruption is detected and traps at `free()`.
  **Reproduced locally**: `build/cross/x86_64/ttyd -i 127.0.0.1 -p 0 -W bash -i`
  exits 139 (SIGSEGV); the glibc `build/native` binary with the identical
  command line does not crash. This affects every static/Alpine/container
  build currently shipped.
  Matches [tsl0922/ttyd#1575](https://github.com/tsl0922/ttyd/issues/1575) /
  [#1576](https://github.com/tsl0922/ttyd/pull/1576) (NULL-terminate the argv
  copy, and free through the terminator slot since getopt permutation can move
  a string there).

- [ ] **Unauthenticated WebSocket message size is unbounded.**
  `src/protocol.c` grows `pss->buffer` via `xrealloc(pss->buffer, pss->len +
  len)` with no cap, and the authentication check only runs after that growth
  for any message whose first byte isn't `JSON_DATA`. An unauthenticated
  client can force unbounded memory growth before the connection is rejected.
  Not reproduced locally; code matches the report exactly.
  Matches [tsl0922/ttyd#1544](https://github.com/tsl0922/ttyd/pull/1544)
  (add a `MAX_MESSAGE_SIZE` cap, close the connection on overflow).

- [ ] **mTLS may reject valid client certificates on newer OpenSSL.**
  `src/http.c`'s `LWS_CALLBACK_OPENSSL_PERFORM_CLIENT_CERT_VERIFICATION`
  handler calls `SSL_get_verify_result()`, which upstream reports is not yet
  final inside that callback on OpenSSL 4.1.0; libwebsockets already passes
  `preverify_ok` as `len`, which should be used instead. Not reproduced here
  (our pinned OpenSSL is 3.5.9 LTS); dependency-version-sensitive.
  Matches [tsl0922/ttyd#1583](https://github.com/tsl0922/ttyd/issues/1583) /
  [#1584](https://github.com/tsl0922/ttyd/pull/1584). Pair the fix with a
  regression test since it only manifests on specific OpenSSL versions.

## Correctness bugs

- [ ] **PTY reads can stall permanently.** `src/pty.c`'s `read_cb` calls
  `uv_read_stop()` before checking the result; on `n == 0` or `UV_ENOBUFS` it
  returns without ever restarting the read or freeing the allocated buffer.
  Per libuv, `nread == 0` is not EOF, so the terminal goes silent until ttyd is
  restarted. Not reproduced locally.
  Matches [tsl0922/ttyd#1573](https://github.com/tsl0922/ttyd/pull/1573).

- [ ] **`--check-origin` always fails over HTTP/2.** `check_host_origin()` in
  `src/protocol.c` reads `WSI_TOKEN_HOST`, which HTTP/2 never populates (the
  authority lives in `:authority`/`WSI_TOKEN_HTTP_COLON_AUTHORITY`). Every h2
  handshake is refused and falls back to HTTP/1.1 after ttyd's 5s idle ping
  policy closes the h2 connection — a visible per-connection delay, not a
  lockout, but still gets the check consistently wrong over h2. Not
  reproduced locally.
  Matches [tsl0922/ttyd#1566](https://github.com/tsl0922/ttyd/issues/1566)
  (also notes an uninitialized `port` for unrecognized `Origin` schemes, an
  overlapping-buffer `snprintf`, and IPv6-literal origins that can never
  match — same function, worth fixing together).

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
