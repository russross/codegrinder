Shared client build and checks
==============================

Exam owns `www/exam/client-core/` and compiles its source directly. Other clients
mount that directory with sshfs and follow its self-contained `README.md` and
`CHANGELOG.md`. The matching runtime artifacts and checksums live under
`www/exam/vm/runtime/`; the existing guest image stays under `vm/image/`.

From the repository root:

1. Install with `npm --prefix www/exam/client-core ci` and `npm --prefix www/exam ci`.
2. Check with `npm --prefix www/exam run typecheck` and
    `www/exam/client-core/node_modules/.bin/tsc -p www/exam/client-core-check.json --noEmit`.
3. Test the shared library with `RISCBOX_CLIENT_RUNTIME="$PWD/www/exam/vm/runtime/riscbox.js" RISCBOX_CLIENT_WASM="$PWD/www/exam/vm/runtime/riscbox.wasm" npm --prefix www/exam/client-core test`.
4. Run exam checks with `npm --prefix www/exam test` and, from `www/exam/`,
    `npm run test:browser`. The latter checks a real guest and the complete exam
    page with a deterministic protobuf RPC peer; it does not alter server data.
5. Build with `make exam`. Serve the entire `www/exam/dist/` directory, including
    generated JavaScript chunks and WASM, along with the runtime and guest assets.

Use the Alpine system Node 24 and npm. Browser tests use a temporary profile and
close their browser processes. Shared tests invoke `google-chrome`; an installed
Chromium can be exposed under that name with a temporary PATH wrapper. Exam
browser tests use Chromedriver and `/usr/bin/chromium-browser`.

Make shared improvements directly in `client-core`, record API and policy
changes in its changelog, and rerun these checks. The other client adapts its
host integration from that changelog. Keep runtime aliases in host TypeScript
configs; mounted consumers need no CodeGrinder sources or distributed bundle.

Clicking Reboot VM again during shutdown uses the shared reset operation with
Exam's current official files; there is no separate VM reset control.
It discards disk overlays and guest-only namespace entries without flushing
editor text or sending RPCs. CodeGrinder file Reset remains independent.
