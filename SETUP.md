Building and deployment
=======================

Native builds
-------------

The Rust workspace uses the host toolchain for normal development:

    make build
    make test

`make server` builds only `codegrinder-server` for the current host.
The production server is always a native build; promoting a checkout
does not change source files or build flags.


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
is required when building the macOS targets from Linux. Set `SDKROOT`
to the SDK directory before running the macOS targets.


Server configuration
--------------------

The server requires an explicit configuration path:

    codegrinder-server --config /etc/codegrinder/config.json -ta -daycare

`CODEGRINDER_CONFIG` may select the path instead. The server never
searches a user's home directory for configuration or data. Relative
`sqlite3Path` and `wwwRoot` values are resolved from the directory
containing the config file. Absolute paths are appropriate for system
installations. Start from `setup/config.example.json`, generate each
secret independently with `head -c 32 /dev/urandom | base64`, and keep
the populated config outside the repository.

The checked-in OpenRC and systemd definitions use the generic
`codegrinder` service account and `/etc/codegrinder/config.json`.
Customize the installed unit, not the repository copy. OpenRC settings
can be overridden in `/etc/conf.d/codegrinder-server`:

    codegrinder_user="codegrinder"
    codegrinder_group="codegrinder"
    codegrinder_config="/etc/codegrinder/config.json"
    codegrinder_roles="-ta -daycare"

Caddy owns public TLS and reverse-proxies to the server's default
`localhost:1400` cleartext listener.


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
