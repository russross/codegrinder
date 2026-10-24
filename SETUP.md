Building and deployment
=======================

Native builds
-------------

The Rust workspace uses the host toolchain for normal development:

    make build
    make -C server test
    make -C grind test

`make server` builds only `codegrinder` for the current host.
The production server is always a native build; promoting a checkout
does not change source files or build flags.

Use `make -C grind test TEST_ARGS=filter` or the equivalent server target for
focused tests. Component tests run formatting checks and Clippy before tests.
Run only checks for the code and boundaries changed; a CLI edit does not require
server tests. `make test` checks both Rust components when both are affected.

Normal development uses incremental builds. Do not precede builds or tests with
`clean` or `mostlyclean`; missing dependencies must be fixed in the build rules.
Cargo tracks Rust dependencies, while Make tracks generated browser and SDK
assets, including source additions, removals, and deleted outputs. GNU Make
4.3 or newer is required for grouped protobuf outputs.
Validate build rules with `make -C tests build-check`; these tests use temporary
checkouts and substituted external tools, leaving the live deployment intact.

Every build component has `mostlyclean` and `clean`. `mostlyclean` removes
intermediate assets and dependencies but preserves runnable native binaries,
downloadable clients, and deployed browser files, including older immutable
assets required by cached pages. Rust components share one intermediate cache.
`clean` also deletes deployment outputs. Neither target changes configuration,
databases, backups, or installed services. Cleanup is an explicit maintenance
operation; the next build recreates any removed intermediates.


Client distribution builds
--------------------------

The distributable `grind` binaries use Rust target standard libraries,
Zig, and `cargo-zigbuild`. Install the four Rust targets with rustup:

    rustup target add x86_64-unknown-linux-musl
    rustup target add aarch64-unknown-linux-musl
    rustup target add x86_64-apple-darwin
    rustup target add aarch64-apple-darwin

Build individual clients with `make grind-linux-amd64`,
`make grind-linux-arm64`, `make grind-macos-amd64`, or
`make grind-macos-arm64`. `make grind-dist` builds all four and copies
them into `www/` using the names expected by the download site.

Linux outputs are static musl executables, and the build rejects a
Linux output containing an ELF interpreter. macOS does not support
fully static executables; those outputs link only to operating-system
libraries and do not require third-party shared libraries. A macOS SDK
is required when building the macOS targets from Linux. The Makefile builds
the bundled minimal SDK using `make -C macos-minimal-sdk`; override
`MACOS_AMD64_SDKROOT` or `MACOS_ARM64_SDKROOT` to use a different SDK.
Cross builds retain their Cargo caches instead of cleaning after publication.


Server configuration
--------------------

The server requires an explicit configuration path:

    codegrinder --config /etc/codegrinder/config.json

The server always runs TA bookkeeping and a local daycare. `hostname` is the public host returned to execution clients; `problemTypes` lists the locally supported types, and `capacity` limits concurrent containers. All LMS, session, and daycare signing secrets are required. When updating an existing installation, remove `taHostname` from its JSON configuration and remove role flags from its service command. Unknown configuration fields are rejected.

`CODEGRINDER_CONFIG` may select the path instead. The server never
searches a user's home directory for configuration or data. Relative
`sqlite3Path` values are resolved from the directory containing the config
file. Absolute paths are appropriate for system installations. Start from
`setup/config.example.json`, generate each
secret independently with `head -c 32 /dev/urandom | base64`, and keep
the populated config outside the repository.

The preferred deployment runs directly from a live checkout. Build the
release server in that checkout, then customize the installed OpenRC or
systemd definition to execute `<checkout>/target/release/codegrinder`.
Do not copy the executable to `/usr/local/bin`; a service restart after a
successful release build should run that build directly.

The checked-in OpenRC, systemd, and Caddy files are generic installation
assets. Copy them into the system configuration and customize the installed
copies for the local checkout, account, hostname, and paths. Do not put
machine-specific values into the repository templates. OpenRC settings can
be overridden in `/etc/conf.d/codegrinder`:

    codegrinder_user="codegrinder"
    codegrinder_group="codegrinder"
    codegrinder_config="/etc/codegrinder/config.json"

Caddy owns public TLS and reverse-proxies to the server's default
`localhost:1400` cleartext listener. Configure the installed Caddyfile to
serve static files directly from `<checkout>/www`; do not maintain a copied
web tree under `/usr/share`. The Caddy account needs directory traversal
permission from the checkout's parent directories and read permission for
the files under `www`. The server requires `curl` for Canvas grade passback and verifies that it is available during startup.

With this layout, build browser assets with `make -C www`, downloadable clients
with `make grind-dist`, and the Rust server with `make server`, then restart
the CodeGrinder service.
Caddy reads static content from the checkout immediately and does not need a
copy or synchronization step. Docker runtime images and problem type data
remain explicit manual build and installation steps.


Database setup and backup
-------------------------

Database creation is deliberately destructive and requires `--force`:

    ./setup/setup-database.sh --force --database /var/lib/codegrinder/codegrinder.db

Without `--database`, it operates only on `db/codegrinder.db` beside
this checkout. It does not inspect `$HOME` or alter `.sqliterc`.

The backup script has the same checkout-local defaults. Production
jobs should select both paths explicitly:

    ./setup/backup-codegrinder-database \
        --database /var/lib/codegrinder/codegrinder.db \
        --backup-dir /var/backups/codegrinder
