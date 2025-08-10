#!/bin/sh

set -e

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m | tr '[:upper:]' '[:lower:]')

# Determine the binary name based on OS and architecture
BINARY=""
if [ "$OS" = "linux" ]; then
    if [ "$ARCH" = "x86_64" ]; then
        BINARY="grind.linux_amd64"
    elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
        BINARY="grind.linux_arm64"
    elif echo "$ARCH" | grep '^arm' >/dev/null; then
        BINARY="grind.linux_arm"
    else
        echo "Unsupported architecture on Linux: $ARCH"
        exit 1
    fi
elif [ "$OS" = "darwin" ]; then
    if [ "$ARCH" = "x86_64" ]; then
        BINARY="grind.darwin_amd64"
    elif [ "$ARCH" = "arm64" ]; then
        BINARY="grind.darwin_arm64"
    else
        echo "Unsupported architecture on macOS: $ARCH"
        exit 1
    fi
else
    echo "Unsupported OS: $OS"
    exit 1
fi

# Download and install the binary
URL="https://codegrinder.russross.com/$BINARY"
curl --silent --compressed --fail -o /usr/local/bin/grind "$URL"
chmod 755 /usr/local/bin/grind

echo 'grind installed successfully'
echo 'type "grind" and you should see a help message'
