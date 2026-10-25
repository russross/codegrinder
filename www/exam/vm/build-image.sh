#!/bin/sh
set -eu

if [ "$#" -lt 5 ]; then
    echo "usage: $0 NAME SIZE_MIB MINIROOTFS TOOL_ARCHIVE PACKAGES..." >&2
    exit 2
fi
name=$1
size=$2
archive=$(realpath "$3")
tools=$(realpath "$4")
shift 4
case "$name" in ''|*[!a-z0-9-]*) echo "invalid image name: $name" >&2; exit 2 ;; esac
[ -d "$name" ] || { echo "missing image overlay: $name" >&2; exit 2; }
PATH="$PATH:/usr/sbin:/sbin"
export PATH
for command in fakeroot cpio gzip tar timeout qemu-system-riscv64 truncate mkfs.ext4; do
    command -v "$command" >/dev/null 2>&1 || { echo "missing command: $command" >&2; exit 1; }
done

stage=$(mktemp -d "$(pwd)/build/rootfs.XXXXXX")
output=$(mktemp -d "$(pwd)/build/output.XXXXXX")
trap 'rm -rf "$stage" "$output" build/$name-rootfs.ext4.part' EXIT HUP INT TERM

# Fakeroot carries numeric ownership through both initramfs and ext4 construction.
initramfs="$(pwd)/build/$name-setup-initramfs.gz"
export initramfs
fakeroot sh -eu -c '
    tar -xpf "$1" -C "$2"
    cp -R "$3/." "$2/"
    cp -R "$4/." "$2/"
    tar -xpf "$5" -C "$2"
    mkdir -p "$2/usr/local"
    cp ../../../stepper/dist/stepper.linux_riscv64 "$2/usr/local/stepper"
    chmod 755 "$2/usr/local/stepper"
    stage=$2
    shift 5
    printf "%s\n" "$@" > "$stage/etc/exam-packages"
    cd "$stage"
    chown -R 0:0 .
    find . -print0 | cpio --null --quiet -o -H newc | gzip -1 > "$initramfs"
' sh "$archive" "$stage" "$(pwd)/guest" "$(pwd)/$name" "$tools" "$@"

# Package installation happens once per image input change, outside browser testing.
if ! timeout 300 qemu-system-riscv64 \
    -machine virt -m 512M -smp 1 -nographic -no-reboot \
    -bios build/fw_dynamic.bin -kernel build/linux -initrd build/$name-setup-initramfs.gz \
    -append 'console=ttyS0,115200 rdinit=/sbin/exam-prepare riscv_isa_fallback panic=-1' \
    -netdev user,id=net -device virtio-net-device,netdev=net \
    -fsdev "local,id=output,path=$output,security_model=none" \
    -device virtio-9p-device,fsdev=output,mount_tag=output \
    > build/$name-image-setup.log 2>&1; then
    echo "QEMU image preparation failed; see vm/build/$name-image-setup.log" >&2
    tail -20 build/$name-image-setup.log >&2
    exit 1
fi
if [ ! -f "$output/complete" ] || [ -f "$output/failed" ]; then
    echo "Guest image preparation failed; see vm/build/$name-image-setup.log" >&2
    tail -20 build/$name-image-setup.log >&2
    exit 1
fi

# Population needs no host mount; the resulting root remains writable in the VM.
rm -rf "$stage"
mkdir -p "$stage"
fakeroot sh -eu -c '
    tar -xpf "$1" -C "$2"
    truncate -s "${4}M" "$3"
    mkfs.ext4 -q -F -m 0 -O ^has_journal -d "$2" "$3"
' sh "$output/rootfs.tar" "$stage" "$(pwd)/build/$name-rootfs.ext4.part" "$size"
mv "build/$name-rootfs.ext4.part" "build/$name-rootfs.ext4"
echo "Prepared $size MiB writable $name exam image."
