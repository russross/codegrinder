#!/bin/sh
set -eu

if [ "$#" -ne 3 ]; then
    echo "usage: $0 RELEASE_DIRECTORY RISCLET_BINARY MINIROOTFS" >&2
    exit 2
fi
release=$(realpath "$1")
binary=$(realpath "$2")
archive=$(realpath "$3")
PATH="$PATH:/usr/sbin:/sbin"
export PATH
for command in fakeroot cpio gzip tar timeout qemu-system-riscv64 truncate mkfs.ext4; do
    command -v "$command" >/dev/null 2>&1 || { echo "missing command: $command" >&2; exit 1; }
done

# The release supplies a matched kernel and firmware for preparation and browser boot.
set -- "$release"/linux-*.gz
[ "$#" -eq 1 ] && [ -f "$1" ] || { echo 'release must contain one Linux payload' >&2; exit 1; }
gzip -dc "$1" > build/linux
set -- "$release"/fw_dynamic.bin-*.gz
[ "$#" -eq 1 ] && [ -f "$1" ] || { echo 'release must contain one firmware payload' >&2; exit 1; }
gzip -dc "$1" > build/fw_dynamic.bin
stage=$(mktemp -d "$(pwd)/build/rootfs.XXXXXX")
output=$(mktemp -d "$(pwd)/build/output.XXXXXX")
trap 'rm -rf "$stage" "$output" build/rootfs.ext4.part' EXIT HUP INT TERM

# Fakeroot carries numeric ownership through both initramfs and ext4 construction.
fakeroot sh -eu -c '
    tar -xpf "$1" -C "$2"
    cp -R "$3/." "$2/"
    mkdir -p "$2/usr/local/bin"
    cp "$4" "$2/usr/local/bin/risclet"
    chmod 755 "$2/usr/local/bin/risclet"
    cd "$2"
    chown -R 0:0 .
    find . -print0 | cpio --null --quiet -o -H newc | gzip -1 > "$5"
' sh "$archive" "$stage" "$(pwd)/guest" "$binary" "$(pwd)/build/setup-initramfs.gz"

# Package installation happens once per image input change, outside browser testing.
if ! timeout 300 qemu-system-riscv64 \
    -machine virt -m 512M -smp 1 -nographic -no-reboot \
    -bios build/fw_dynamic.bin -kernel build/linux -initrd build/setup-initramfs.gz \
    -append 'console=ttyS0,115200 rdinit=/sbin/exam-prepare riscv_isa_fallback panic=-1' \
    -netdev user,id=net -device virtio-net-device,netdev=net \
    -fsdev "local,id=output,path=$output,security_model=none" \
    -device virtio-9p-device,fsdev=output,mount_tag=output \
    > build/image-setup.log 2>&1; then
    echo 'QEMU image preparation failed; see vm/build/image-setup.log' >&2
    tail -20 build/image-setup.log >&2
    exit 1
fi
if [ ! -f "$output/complete" ] || [ -f "$output/failed" ]; then
    echo 'Guest image preparation failed; see vm/build/image-setup.log' >&2
    tail -20 build/image-setup.log >&2
    exit 1
fi

# Population needs no host mount; the resulting root remains writable in the VM.
rm -rf "$stage"
mkdir -p "$stage"
fakeroot sh -eu -c '
    tar -xpf "$1" -C "$2"
    truncate -s 32M "$3"
    mkfs.ext4 -q -F -m 0 -d "$2" "$3"
' sh "$output/rootfs.tar" "$stage" "$(pwd)/build/rootfs.ext4.part"
mv build/rootfs.ext4.part build/rootfs.ext4
echo 'Prepared 32 MiB writable Exam image with Risclet, make, and tzdata.'
