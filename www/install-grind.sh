#!/bin/sh

set -eu

BOOTSTRAP_SERVER=https://codegrinder.russross.com
BIN_DIR=$HOME/.local/bin
CONFIG_FILE=$HOME/.config/codegrinder/config.toml
RISCLET_VERSION=v0.4.3

temp_file=
cleanup() {
    if [ -n "$temp_file" ]; then
        rm -f "$temp_file"
    fi
}
trap cleanup 0
trap 'exit 1' 1 2 15

fail() {
    echo "update-grind: $*" >&2
    exit 1
}

path_is_configured() {
    case ":$PATH:" in
        *:"$BIN_DIR":*) return 0 ;;
        *) return 1 ;;
    esac
}

profile_configures_path() {
    [ -f "$1" ] && grep '^[[:space:]]*[^#].*\.local/bin' "$1" >/dev/null 2>&1
}

bash_profile_sources_profile() {
    [ -f "$1" ] && grep '^[[:space:]]*[^#].*\.profile' "$1" >/dev/null 2>&1
}

configure_path() {
    mkdir -p "$BIN_DIR"
    if path_is_configured; then
        return
    fi

    shell_path=${SHELL:-}
    if [ -z "$shell_path" ] && [ -r /etc/passwd ]; then
        user_name=$(id -un)
        shell_path=$(awk -F: -v user="$user_name" '$1 == user { print $7; exit }' /etc/passwd)
    fi
    shell_name=${shell_path##*/}
    profile=
    case "$shell_name" in
        bash)
            if [ -f "$HOME/.bash_profile" ]; then
                profile=$HOME/.bash_profile
            elif [ -f "$HOME/.bash_login" ]; then
                profile=$HOME/.bash_login
            else
                profile=$HOME/.profile
            fi
            ;;
        ash) profile=$HOME/.profile ;;
        zsh) profile=${ZDOTDIR:-$HOME}/.zprofile ;;
        *)
            if [ -n "$shell_name" ]; then
                echo "Add $BIN_DIR to PATH for your $shell_name shell"
            else
                echo "Add $BIN_DIR to PATH for your shell"
            fi
            echo "Activate now: export PATH=\"$BIN_DIR:\$PATH\""
            PATH=$BIN_DIR:$PATH
            export PATH
            return
            ;;
    esac

    profile_has_path=false
    if profile_configures_path "$profile"; then
        profile_has_path=true
    elif [ "$shell_name" = bash ] && [ "$profile" != "$HOME/.profile" ] \
        && bash_profile_sources_profile "$profile" \
        && profile_configures_path "$HOME/.profile"; then
        profile_has_path=true
    fi

    if [ "$profile_has_path" = false ]; then
        mkdir -p "$(dirname "$profile")"
        {
            echo
            echo '# CodeGrinder user binaries'
            echo 'case ":$PATH:" in'
            echo '    *:"$HOME/.local/bin":*) ;;'
            echo '    *) PATH="$HOME/.local/bin:$PATH" ;;'
            echo 'esac'
            echo 'export PATH'
        } >>"$profile"
        echo "Added $BIN_DIR to PATH in $profile"
    fi

    echo "Activate now: export PATH=\"$BIN_DIR:\$PATH\""
    PATH=$BIN_DIR:$PATH
    export PATH
}

server_url() {
    if [ ! -r "$CONFIG_FILE" ]; then
        echo "$BOOTSTRAP_SERVER"
        return
    fi

    host=$(awk '
        /^[[:space:]]*host[[:space:]]*=/ {
            sub(/^[[:space:]]*host[[:space:]]*=[[:space:]]*/, "")
            quote = substr($0, 1, 1)
            if (quote != "\"" && quote != "\047") {
                exit
            }
            value = substr($0, 2)
            end = index(value, quote)
            if (end > 0) {
                print substr(value, 1, end - 1)
            }
            exit
        }
    ' "$CONFIG_FILE")
    [ -n "$host" ] || fail "no host found in $CONFIG_FILE"
    case "$host" in
        *[![:print:]]*|*[[:space:]]*) fail "invalid host in $CONFIG_FILE" ;;
        http://*|https://*) ;;
        *) host=https://$host ;;
    esac
    echo "${host%/}"
}

download() {
    url=$1
    destination=$2
    description=$3
    temp_file=$(mktemp "$BIN_DIR/.update-grind.XXXXXX")
    echo "Downloading $description"
    curl -fsSL --compressed "$url" -o "$temp_file"
    chmod 755 "$temp_file"
    mv -f "$temp_file" "$destination"
    temp_file=
}

remove_legacy_binary() {
    legacy_path=/usr/local/bin/$1
    if [ -e "$legacy_path" ] || [ -L "$legacy_path" ]; then
        echo "Removing $legacy_path"
        sudo rm -f "$legacy_path"
    fi
}

platform_name() {
    os=$(uname -s)
    arch=$(uname -m)
    case "$os-$arch" in
        Linux-x86_64|Linux-amd64) echo linux_amd64 ;;
        Linux-aarch64|Linux-arm64) echo linux_arm64 ;;
        Darwin-x86_64|Darwin-amd64) echo darwin_amd64 ;;
        Darwin-aarch64|Darwin-arm64) echo darwin_arm64 ;;
        *) fail "unsupported platform: $os on $arch" ;;
    esac
}

install_grind() {
    platform=$(platform_name)
    server=$(server_url)
    remove_legacy_binary grind
    download "$server/grind.$platform" "$BIN_DIR/grind" "grind for $platform"
    download "$server/install-grind.sh" "$BIN_DIR/update-grind" update-grind
}

risclet_version() {
    "$BIN_DIR/risclet" --version 2>/dev/null | awk '
        {
            for (i = 1; i <= NF; i++) {
                if ($i ~ /^v?[0-9]+\.[0-9]+\.[0-9]+$/) {
                    sub(/^v/, "", $i)
                    print "v" $i
                    exit
                }
            }
        }
    '
}

install_risclet() {
    remove_legacy_binary risclet
    installed_version=
    if [ -x "$BIN_DIR/risclet" ]; then
        installed_version=$(risclet_version)
    fi
    if [ "$installed_version" = "$RISCLET_VERSION" ]; then
        echo "risclet $RISCLET_VERSION is up to date"
        return
    fi

    os=$(uname -s)
    arch=$(uname -m)
    case "$os-$arch" in
        Darwin-x86_64|Darwin-amd64) binary=risclet-x86_64-apple-darwin ;;
        Darwin-aarch64|Darwin-arm64) binary=risclet-aarch64-apple-darwin ;;
        Linux-x86_64|Linux-amd64) binary=risclet-x86_64-unknown-linux-musl ;;
        Linux-aarch64|Linux-arm64) binary=risclet-aarch64-unknown-linux-musl ;;
        *) fail "unsupported platform: $os on $arch" ;;
    esac
    download "https://github.com/russross/risclet/releases/download/$RISCLET_VERSION/$binary" \
        "$BIN_DIR/risclet" "risclet $RISCLET_VERSION"
}

case $# in
    0) mode=grind ;;
    1)
        [ "$1" = risclet ] || fail 'usage: update-grind [risclet]'
        mode=risclet
        ;;
    *) fail 'usage: update-grind [risclet]' ;;
esac

configure_path
case "$mode" in
    grind) install_grind ;;
    risclet) install_risclet ;;
esac
