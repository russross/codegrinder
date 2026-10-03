(function (root) {
// Packets are copied at every WASM boundary. All filesystem identities stay exact.
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
class Writer {
    parts = [];
    u32(value) {
        if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff)
            throw new RangeError("invalid u32");
        const bytes = new Uint8Array(4);
        new DataView(bytes.buffer).setUint32(0, value, true);
        this.parts.push(bytes);
        return this;
    }
    u64(value) {
        if (typeof value === "number" && !Number.isSafeInteger(value))
            throw new RangeError("invalid integer");
        const integer = BigInt(value);
        if (integer < 0n || integer > 0xffffffffffffffffn)
            throw new RangeError("invalid u64");
        const bytes = new Uint8Array(8);
        new DataView(bytes.buffer).setBigUint64(0, integer, true);
        this.parts.push(bytes);
        return this;
    }
    raw(bytes) { this.parts.push(bytes); return this; }
    blob(bytes) { return this.u32(bytes.length).raw(bytes); }
    str(value) { return this.blob(encoder.encode(value)); }
    finish() {
        const bytes = new Uint8Array(this.parts.reduce((size, part) => size + part.length, 0));
        let offset = 0;
        for (const part of this.parts) {
            bytes.set(part, offset);
            offset += part.length;
        }
        return bytes;
    }
}
class Reader {
    bytes;
    offset = 0;
    view;
    constructor(bytes) {
        this.bytes = bytes;
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    u32() { const value = this.view.getUint32(this.offset, true); this.offset += 4; return value; }
    u64() { const value = this.view.getBigUint64(this.offset, true); this.offset += 8; return value; }
    str() {
        const length = this.u32();
        if (length > this.bytes.length - this.offset)
            throw new RangeError("truncated filesystem string");
        const value = decoder.decode(this.bytes.subarray(this.offset, this.offset + length));
        this.offset += length;
        return value;
    }
    end() { if (this.offset !== this.bytes.length)
        throw new RangeError("trailing filesystem bytes"); }
}
class FilesystemError extends Error {
    errno;
    constructor(errno) {
        super(`Filesystem operation failed (errno ${errno})`);
        this.errno = errno;
        this.name = "FilesystemError";
    }
}
const kinds = ["directory", "file", "symlink"];
const changes = {
    1: "create", 2: "write", 3: "remove", 4: "rename", 5: "metadata", 8: "reset", 9: "rescan",
};
const sources = ["host", "guest"];
function kind(reader) {
    const value = kinds[reader.u32() - 1];
    if (value === undefined)
        throw new Error("Invalid filesystem kind");
    return value;
}
function now() { return Math.floor(Date.now() / 1000); }
function checked(status) { if (status < 0)
    throw new FilesystemError(-status); }
// A facade references its VM-owned tree; calls always finish before returning.
class Filesystem {
    runtime;
    handle;
    listeners = new Set();
    closed = false;
    constructor(runtime, handle) {
        this.runtime = runtime;
        this.handle = handle;
    }
    static open(runtime, name) {
        const handle = runtime.withBytes(name, (address, length) => runtime.exports.riscbox_fs_get(address, length));
        if (handle === 0)
            throw new FilesystemError(-runtime.exports.riscbox_fs_status());
        const existing = runtime.filesystems.get(handle);
        if (existing)
            return existing;
        const filesystem = new Filesystem(runtime, handle);
        runtime.filesystems.set(handle, filesystem);
        return filesystem;
    }
    snapshot() {
        return this.runtime.bytes(this.runtime.exports.riscbox_fs_data_address(), this.runtime.exports.riscbox_fs_data_length());
    }
    call(operation, body = new Writer(), origin = 0n) {
        if (this.closed)
            throw new FilesystemError(9);
        const packet = new Writer().u32(operation).u64(now()).u64(origin).raw(body.finish()).finish();
        const status = this.runtime.withBytes(packet, (address, length) => this.runtime.exports.riscbox_fs_call(this.handle, address, length));
        const bytes = this.snapshot();
        checked(status);
        return { status, bytes };
    }
    operation(operation, body = new Writer(), origin = 0n) {
        const { bytes } = this.call(operation, body, origin);
        this.runtime.filesystemChanged();
        return bytes;
    }
    readFile(path) { return this.operation(1, new Writer().str(path)); }
    writeFile(path, content, origin = 0n) {
        const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
        this.operation(2, new Writer().str(path).blob(bytes), origin);
    }
    mkdir(path, origin = 0n) { this.operation(3, new Writer().str(path), origin); }
    remove(path, origin = 0n) { this.operation(4, new Writer().str(path), origin); }
    rename(oldPath, newPath, origin = 0n) { this.operation(5, new Writer().str(oldPath).str(newPath), origin); }
    listDirectory(path = "") {
        const reader = new Reader(this.operation(6, new Writer().str(path)));
        const count = reader.u32();
        const entries = [];
        for (let index = 0; index < count; index++)
            entries.push({ name: reader.str(), inode: reader.u64(), kind: kind(reader), cookie: reader.u64() });
        reader.end();
        return entries;
    }
    listFiles() {
        const reader = new Reader(this.operation(7));
        const count = reader.u32();
        const paths = [];
        for (let index = 0; index < count; index++)
            paths.push(reader.str());
        reader.end();
        return paths;
    }
    stat(path) {
        const reader = new Reader(this.operation(8, new Writer().str(path)));
        const inode = reader.u64();
        const fileKind = kind(reader);
        const mode = reader.u32(), uid = reader.u32(), gid = reader.u32(), version = reader.u32(), linkCount = reader.u32();
        const size = reader.u64();
        const time = () => ({ seconds: reader.u64(), nanoseconds: reader.u32() });
        const result = { inode, kind: fileKind, mode, uid, gid, version, linkCount, size, atime: time(), mtime: time(), ctime: time() };
        reader.end();
        return result;
    }
    symlink(path, target, origin = 0n) { this.operation(9, new Writer().str(path).str(target), origin); }
    readlink(path) { return new TextDecoder().decode(this.operation(10, new Writer().str(path))); }
    link(existing, path, origin = 0n) { this.operation(11, new Writer().str(existing).str(path), origin); }
    clear() { this.operation(12); }
    // Restored attributes preserve nanoseconds; inode identity and ctime are new.
    setAttributes(path, attributes, origin = 0n) {
        const { mode, uid, gid, atime, mtime } = attributes;
        if (mode > 0o7777 || atime.nanoseconds >= 1_000_000_000 || mtime.nanoseconds >= 1_000_000_000)
            throw new RangeError("invalid filesystem attributes");
        this.operation(14, new Writer().str(path).u32(mode).u32(uid).u32(gid)
            .u64(atime.seconds).u32(atime.nanoseconds).u64(mtime.seconds).u32(mtime.nanoseconds), origin);
    }
    subscribe(listener) {
        if (this.closed)
            throw new FilesystemError(9);
        if (this.listeners.size === 0)
            this.call(13, new Writer().u32(1));
        this.listeners.add(listener);
        this.runtime.serviceStorage();
        return () => {
            this.listeners.delete(listener);
            if (!this.closed && this.listeners.size === 0)
                this.call(13, new Writer().u32(0));
        };
    }
    invalidate() { this.closed = true; this.listeners.clear(); }
    poll() {
        if (this.closed)
            return;
        // Capture recipients with each copied event, then leave the synchronous service path.
        for (;;) {
            const status = this.runtime.exports.riscbox_fs_next_change(this.handle);
            checked(status);
            if (status === 0)
                break;
            const reader = new Reader(this.snapshot());
            const changeKind = changes[reader.u32()];
            const inode = reader.u64();
            const source = sources[reader.u32()];
            const origin = reader.u64();
            const path = reader.str();
            const oldPath = reader.u32() === 0 ? undefined : reader.str();
            const aliases = [];
            const count = reader.u32();
            for (let index = 0; index < count; index++)
                aliases.push(reader.str());
            reader.end();
            if (changeKind === undefined || source === undefined)
                throw new Error("Invalid filesystem event");
            const change = { kind: changeKind, inode, source, origin, path, aliases, ...(oldPath === undefined ? {} : { oldPath }) };
            const recipients = [...this.listeners];
            queueMicrotask(() => {
                for (const listener of recipients) {
                    if (!this.listeners.has(listener))
                        continue;
                    try {
                        listener(change);
                    }
                    catch (error) {
                        this.runtime.reportFilesystemError(error);
                    }
                }
            });
        }
    }
}
class BlockError extends Error {
    errno;
    constructor(errno) {
        super(`Block operation failed (errno ${errno})`);
        this.errno = errno;
        this.name = "BlockError";
    }
}
class BlockDisk {
    runtime;
    index;
    closed = false;
    pending = new Map();
    constructor(runtime, index) {
        this.runtime = runtime;
        this.index = index;
    }
    check() { if (this.closed)
        throw new BlockError(9); }
    checked(status) { if (status < 0)
        throw new BlockError(-status); }
    snapshot() {
        return this.runtime.bytes(this.runtime.exports.riscbox_disk_data_address(), this.runtime.exports.riscbox_disk_data_length());
    }
    address(sector) {
        this.check();
        if (typeof sector !== "bigint" || sector < 0n || sector > 0xffffffffffffffffn)
            throw new RangeError("invalid disk sector");
        return [Number(sector & 0xffffffffn), Number(sector >> 32n)];
    }
    // Resident reads return directly. A cache miss retains only a Rust request
    // ID and promise callbacks; the eventual result is copied from WASM.
    read(sector, length) {
        const [low, high] = this.address(sector);
        if (!Number.isInteger(length) || length <= 0 || length > 0xffff_ffff || length % 512 !== 0)
            throw new RangeError("disk reads need whole sectors");
        const status = this.runtime.exports.riscbox_disk_read(this.index, low, high, length);
        this.checked(status);
        if (status === 0)
            return this.snapshot();
        const promise = new Promise((resolve, reject) => this.pending.set(status, { resolve, reject }));
        this.runtime.drainActions();
        return promise;
    }
    write(sector, bytes) {
        const [low, high] = this.address(sector);
        this.checked(this.runtime.withBytes(bytes, (address, length) => this.runtime.exports.riscbox_disk_write(this.index, low, high, address, length)));
        // A write can make a waiting read entirely resident before its base
        // fetch returns. Poll copied results and dispatch any remaining misses.
        this.runtime.drainActions();
    }
    get capacitySectors() {
        this.check();
        const low = this.runtime.exports.riscbox_disk_capacity(this.index, 0);
        const high = this.runtime.exports.riscbox_disk_capacity(this.index, 1);
        const capacity = BigInt(low) | (BigInt(high) << 32n);
        if (capacity === 0n)
            throw new BlockError(16);
        return capacity;
    }
    discardChanges() {
        this.check();
        this.checked(this.runtime.exports.riscbox_disk_discard(this.index));
        this.poll();
    }
    poll() {
        if (this.closed)
            return false;
        const polled = this.pending.size !== 0;
        for (const [id, pending] of this.pending) {
            const status = this.runtime.exports.riscbox_disk_finish(id);
            if (status === 1)
                continue;
            this.pending.delete(id);
            if (status < 0)
                pending.reject(new BlockError(-status));
            else
                pending.resolve(this.snapshot());
        }
        return polled;
    }
    invalidate() {
        this.closed = true;
        for (const pending of this.pending.values())
            pending.reject(new BlockError(9));
        this.pending.clear();
    }
}

root.RiscboxStorage = { Filesystem, FilesystemError, BlockDisk, BlockError };
}(globalThis));
(function (root) {
    "use strict";

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    // Guest timer deadlines use 10 MHz ticks; host wakeup delays use milliseconds.
    const GUEST_TICKS_PER_MILLISECOND = 10_000;
    const QUANTUM_BUDGET_REACHED = 0;
    const QUANTUM_WFI_SLEEP = 1;
    const QUANTUM_HOST_SERVICE_REQUIRED = 2;
    const QUANTUM_VM_INACTIVE = 3;
    const QUANTUM_START_VM_INACTIVE = -1;
    const LIFECYCLE_CAUSES = [
        "guest-poweroff", "guest-reboot", "host-halt", "host-reset",
        "host-boot", "guest-failure",
    ];

    function parseConfig(source) {
        let offset = 0;
        const fail = (message) => { throw new SyntaxError(`${message} at offset ${offset}`); };
        const space = () => {
            for (;;) {
                while (/\s/.test(source[offset] ?? "") && offset < source.length) offset++;
                if (source.startsWith("//", offset)) {
                    offset = source.indexOf("\n", offset + 2);
                    if (offset < 0) offset = source.length;
                } else if (source.startsWith("/*", offset)) {
                    const end = source.indexOf("*/", offset + 2);
                    if (end < 0) fail("unterminated comment");
                    offset = end + 2;
                } else return;
            }
        };
        const quoted = () => {
            offset++;
            let result = "";
            for (;;) {
                const ch = source[offset++];
                if (ch === undefined || ch === "\n" || ch === "\r") fail("unterminated string");
                if (ch === '"') return result;
                if (ch !== "\\") { result += ch; continue; }
                const escape = source[offset++];
                if (escape === "x") {
                    const hex = source.slice(offset, offset + 2);
                    if (!/^[0-9a-fA-F]{2}$/.test(hex)) fail("invalid hex escape");
                    result += String.fromCharCode(parseInt(hex, 16));
                    offset += 2;
                } else if (escape === "n") result += "\n";
                else if (escape === "r") result += "\r";
                else if (escape === "t") result += "\t";
                else if (escape === "\\" || escape === '"' || escape === "'") result += escape;
                else fail("unknown escape code");
            }
        };
        const identifier = () => {
            const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(offset));
            if (!match) fail("invalid identifier");
            offset += match[0].length;
            return match[0];
        };
        const value = () => {
            space();
            if (source[offset] === '"') return quoted();
            if (source[offset] === "{") {
                offset++;
                const object = Object.create(null);
                space();
                while (source[offset] !== "}") {
                    const key = source[offset] === '"' ? quoted() : identifier();
                    space();
                    if (source[offset++] !== ":") fail("expected ':'");
                    object[key] = value();
                    space();
                    if (source[offset] === "}") break;
                    if (source[offset++] !== ",") fail("expected ','");
                    space();
                }
                offset++;
                return object;
            }
            if (source[offset] === "[") {
                offset++;
                const array = [];
                space();
                while (source[offset] !== "]") {
                    array.push(value());
                    space();
                    if (source[offset] === "]") break;
                    if (source[offset++] !== ",") fail("expected ','");
                    space();
                }
                offset++;
                return array;
            }
            const number = /^(?:0[xX][0-9a-fA-F]+|0[0-7]*|[1-9][0-9]*)/.exec(source.slice(offset));
            if (number) {
                offset += number[0].length;
                return number[0].startsWith("0") && !/^0[xX]/.test(number[0])
                    ? parseInt(number[0], 8) : Number(number[0]);
            }
            const word = identifier();
            if (word === "true") return true;
            if (word === "false") return false;
            if (word === "null") return null;
            fail("unknown identifier");
        };
        const result = value();
        space();
        if (offset !== source.length) fail("unexpected characters after value");
        return result;
    }

    function resolveConfig(source, baseUrl, commandLine = "") {
        if (!source || typeof source !== "object" || Array.isArray(source))
            throw new TypeError("configuration must be an object");
        const required = (name, type) => {
            if (typeof source[name] !== type) throw new TypeError(`${name} must be ${type}`);
            return source[name];
        };
        const optional = (name, type, fallback) => {
            if (source[name] === undefined) return fallback;
            return required(name, type);
        };
        const path = (name) => {
            const value = optional(name, "string", null);
            if (value === null || !baseUrl || value.includes(":") || value.startsWith("/"))
                return value;
            const slash = baseUrl.lastIndexOf("/");
            return slash < 0 ? value : baseUrl.slice(0, slash + 1) + value;
        };
        if (required("version", "number") !== 1) throw new RangeError("unsupported configuration version");
        const resolved = {
            version: 1,
            machine: required("machine", "string"),
            memory_size: required("memory_size", "number"),
            console: optional("console", "string", "virtio"),
            uart_output: optional("uart_output", "boolean", false),
            rtc_local_time: optional("rtc_local_time", "boolean", false),
            cmdline: optional("cmdline", "string", ""),
        };
        if (commandLine) resolved.cmdline = commandLine.startsWith("!")
            ? commandLine.slice(1) : `${resolved.cmdline} ${commandLine}`;
        for (const name of ["bios", "kernel", "initrd"]) {
            const url = path(name);
            if (url !== null) resolved[name] = url;
        }
        for (const name of ["bios_address", "kernel_address", "initrd_address", "fdt_address"]) {
            if (source[name] !== undefined) resolved[name] = source[name];
        }
        for (const [prefix, limit] of [["drive", 4], ["fs", 4], ["eth", 1]]) {
            if (source[`${prefix}${limit}`] !== undefined)
                throw new RangeError(`too many ${prefix} entries`);
            for (let index = 0; index < limit; index++) {
                const name = `${prefix}${index}`;
                if (source[name] === undefined) break;
                const entry = source[name];
                if (!entry || typeof entry !== "object" || Array.isArray(entry))
                    throw new TypeError(`${name} must be an object`);
                resolved[name] = prefix === "drive"
                    ? (entry.capacity_sectors === undefined && entry.bytes === undefined && entry.provider === undefined
                        ? { ...entry, file: resolveConfigPath(entry.file, baseUrl) }
                        : resolveArrayDrive(entry))
                    : entry;
            }
        }
        for (const name of ["display0", "input_device"]) {
            if (source[name] !== undefined) resolved[name] = source[name];
        }
        return resolved;
    }

    function resolveConfigPath(value, baseUrl) {
        if (typeof value !== "string") throw new TypeError("drive file must be a string");
        if (!baseUrl || value.includes(":") || value.startsWith("/")) return value;
        const slash = baseUrl.lastIndexOf("/");
        return slash < 0 ? value : baseUrl.slice(0, slash + 1) + value;
    }

    function resolveArrayDrive(entry) {
        if (entry.provider !== undefined) throw new TypeError("block providers were removed");
        const bytes = entry.bytes;
        if (bytes !== undefined && (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length % 512 !== 0))
            throw new TypeError("array drives need a whole-sector Uint8Array");
        const capacity = entry.capacity_sectors ?? (bytes ? BigInt(bytes.length / 512) : undefined);
        if (typeof capacity === "number" && !Number.isSafeInteger(capacity) ||
            !["number", "bigint", "string"].includes(typeof capacity) || entry.file !== undefined)
            throw new TypeError("array drive needs sector capacity or initial bytes");
        if (bytes && BigInt(capacity) !== BigInt(bytes.length / 512)) throw new RangeError("array capacity does not match bytes");
        return { capacity_sectors: String(capacity), ...(bytes === undefined ? {} : { bytes }) };
    }

    class Riscbox {
        constructor(exports, options = {}) {
            if (Object.hasOwn(options, "p9Servers"))
                throw new TypeError("p9Servers was removed; configure named shares and populate them after preparation");
            if (!(exports.memory instanceof WebAssembly.Memory))
                throw new TypeError("Riscbox WASM must export memory");
            if (typeof exports.riscbox_configure_quantum !== "function" ||
                typeof exports.riscbox_wake_delay_ms !== "function" ||
                typeof exports.riscbox_quantum_begin !== "function" ||
                typeof exports.riscbox_quantum_run !== "function" ||
                typeof exports.riscbox_quantum_finish !== "function" ||
                typeof exports.riscbox_quantum_abort !== "function" ||
                typeof exports.riscbox_timing_stat !== "function")
                throw new TypeError("Riscbox WASM has an incompatible run interface");
            if (Object.hasOwn(options, "timesliceMs"))
                throw new TypeError("timesliceMs has been renamed to targetQuantumMs");
            const targetQuantumMs = options.targetQuantumMs ?? 20;
            if (!Number.isFinite(targetQuantumMs) || targetQuantumMs <= 0 || targetQuantumMs > 100)
                throw new RangeError("targetQuantumMs must be greater than zero and at most 100");
            if (Object.hasOwn(options, "guestClockSkew"))
                throw new TypeError("guestClockSkew is now adaptive and cannot be configured");
            this.exports = exports;
            this.options = options;
            if (exports.riscbox_configure_quantum(targetQuantumMs, options.debugTiming ? 1 : 0) !== 0)
                throw new Error("Riscbox WASM timing configuration failed");
            this.timing = options.debugTiming ? {
                nextReport: performance.now() + 1_000,
                quanta: 0, cpuRuns: 0, cycles: 0, activeMs: 0,
                timerReprogrammingExits: 0, wfiQuanta: 0, wfiMs: 0,
                carriedGuestMs: 0,
                rateSamples: 0, rateMean: 0, rateM2: 0,
                timerIntervals: [],
                intervalNoCatchUpSkew: 0,
                sessionCatchUpSkews: [],
            } : null;
            this.filesystems = new Map();
            this.servicingFilesystems = false;
            this.quantumRunning = false;
            this.wakeupTimer = null;
            this.wakeupToken = 0;
            this.wakeupChannel = null;
            this.started = false;
            this.pendingControls = [];
            this.disks = new Map();
            this.diskCount = 0;
            this.preparation = null;
            this.httpGeneration = 0;
        }

        static hostImports(options = {}) {
            let runtime = null;
            const bytes = (ptr, len) => runtime.bytes(ptr, len);
            const imports = {
                vm_started() {
                    options.onVmStarted?.();
                },
                random_fill(ptr, len) {
                    try {
                        const crypto = globalThis.crypto;
                        if (!crypto || typeof crypto.getRandomValues !== "function")
                            return -1;
                        const destination = new Uint8Array(
                            runtime.exports.memory.buffer, ptr, len,
                        );
                        crypto.getRandomValues(destination);
                        return 0;
                    } catch (error) {
                        options.onError?.(error);
                        return -1;
                    }
                },
                console_write(ptr, len) {
                    const data = bytes(ptr, len);
                    options.consoleWrite?.(decoder.decode(data));
                },
                framebuffer_refresh(ptr, x, y, width, height, stride) {
                    options.framebufferRefresh?.(
                        bytes(ptr, stride * height),
                        { x, y, width, height, stride },
                    );
                },
                network_write(ptr, len) {
                    options.networkWrite?.(bytes(ptr, len));
                },
            };
            return {
                imports,
                attach(exports) {
                    runtime = new Riscbox(exports, options);
                    return runtime;
                },
            };
        }

        static async instantiate(source, options = {}) {
            const host = Riscbox.hostImports(options);
            const result = await WebAssembly.instantiate(source, {
                riscbox_host: host.imports,
            });
            return host.attach(result.instance?.exports ?? result.exports);
        }

        bytes(ptr, len) {
            if (!Number.isInteger(ptr) || !Number.isInteger(len) || ptr < 0 || len < 0)
                throw new RangeError("invalid WASM byte range");
            const end = ptr + len;
            const memory = new Uint8Array(this.exports.memory.buffer);
            if (!Number.isSafeInteger(end) || end > memory.length)
                throw new RangeError("WASM byte range is outside memory");
            return memory.slice(ptr, end);
        }

        withBytes(value, callback) {
            const data = typeof value === "string" ? encoder.encode(value) : value;
            if (!(data instanceof Uint8Array))
                throw new TypeError("expected a string or Uint8Array");
            if (data.length === 0)
                return callback(0, 0);
            const ptr = this.exports.riscbox_alloc(data.length);
            if (!Number.isInteger(ptr) || ptr <= 0)
                throw new Error("Riscbox WASM allocation failed");
            try {
                new Uint8Array(this.exports.memory.buffer, ptr, data.length).set(data);
                return callback(ptr, data.length);
            } finally {
                this.exports.riscbox_free(ptr, data.length);
            }
        }

        async start(configUrl, ramMiB, commandLine = "", width = 0, height = 0, hasNetwork = false) {
            return this.startFromUrl(configUrl, ramMiB, commandLine, width, height, hasNetwork);
        }

        async startResolved(config, ramMiB = 0, width = 0, height = 0, hasNetwork = false) {
            await this.prepareResolved(config, ramMiB, width, height, hasNetwork);
            await this.boot();
        }

        prepareResolved(config, ramMiB = 0, width = 0, height = 0, hasNetwork = false) {
            if (this.preparation) throw new Error("VM preparation is already active");
            const resolved = resolveConfig(config, null);
            const initial = [];
            let diskCount = 0;
            for (let index = 0; index < 4; index++) {
                const drive = resolved[`drive${index}`];
                if (!drive) break;
                diskCount++;
                if (drive.bytes !== undefined) {
                    initial.push([index, drive.bytes.slice()]);
                    delete drive.bytes;
                }
            }
            return new Promise((resolve, reject) => {
                this.preparation = { resolve, reject, initial, diskCount };
                try {
                    const result = this.withBytes(JSON.stringify(resolved), (ptr, length) =>
                        this.exports.riscbox_prepare_resolved(ptr, length, ramMiB, width, height, hasNetwork ? 1 : 0));
                    if (result !== 0) throw new Error("Riscbox rejected resolved configuration");
                    this.drainActions();
                } catch (error) { this.failPreparation(error); }
            });
        }

        async prepareFromUrl(configUrl, ramMiB = 0, commandLine = "", width = 0, height = 0, hasNetwork = false) {
            const generation = this.httpGeneration;
            const resolved = await Riscbox.loadResolvedConfig(configUrl, commandLine, this.options.fetch ?? globalThis.fetch);
            if (generation !== this.httpGeneration) throw new Error("VM preparation was cancelled");
            this.configUrl = configUrl;
            await this.prepareResolved(resolved, ramMiB, width, height, hasNetwork);
        }

        filesystem(name) { return root.RiscboxStorage.Filesystem.open(this, name); }

        block(index) {
            if (!Number.isInteger(index) || index < 0 || index >= this.diskCount) throw new RangeError("unknown disk index");
            if (!this.disks.has(index)) this.disks.set(index, new root.RiscboxStorage.BlockDisk(this, index));
            return this.disks.get(index);
        }

        failPreparation(error) {
            const preparation = this.preparation;
            this.preparation = null;
            preparation?.reject(error);
        }

        static async loadResolvedConfig(configUrl, commandLine = "", fetchRequest = globalThis.fetch) {
            if (typeof fetchRequest !== "function")
                throw new Error("Riscbox HTTP fetch is not available");
            const response = await fetchRequest(configUrl, { cache: "no-store" });
            if (response.status < 200 || response.status >= 300)
                throw new Error(`configuration HTTP status ${response.status}`);
            const source = decoder.decode(await response.arrayBuffer());
            return resolveConfig(parseConfig(source), configUrl, commandLine);
        }

        async startFromUrl(configUrl, ramMiB = 0, commandLine = "", width = 0,
                           height = 0, hasNetwork = false) {
            await this.prepareFromUrl(configUrl, ramMiB, commandLine, width, height, hasNetwork);
            await this.boot();
        }

        control(name) {
            return new Promise((resolve, reject) => {
                const run = () => {
                    try {
                        const command = this.exports[`riscbox_${name}`];
                        if (typeof command !== "function" || command() !== 0)
                            throw new Error(`Riscbox could not ${name} the VM`);
                        if (name === "reset" || name === "request_shutdown" ||
                            name === "request_reboot") this.scheduleWakeup(0);
                        if (name === "cold_reset") {
                            this.httpGeneration++;
                            this.options.consoleReset?.();
                            this.options.framebufferClear?.();
                            this.serviceStorage();
                        }
                        if (name === "destroy") {
                            this.failPreparation(new Error("VM preparation was cancelled"));
                            for (const filesystem of this.filesystems.values()) filesystem.invalidate();
                            for (const disk of this.disks.values()) disk.invalidate();
                            this.filesystems.clear(); this.disks.clear(); this.diskCount = 0;
                            this.httpGeneration++;
                            this.started = false;
                            this.cancelWakeup();
                            this.options.onVmDestroyed?.();
                        }
                        this.drainActions();
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                };
                if (this.quantumRunning) this.pendingControls.push(run);
                else run();
            });
        }

        halt() { return this.control("halt"); }
        reset() { return this.control("reset"); }
        coldReset() { return this.control("cold_reset"); }
        boot() { return this.control("reset"); }
        destroy() { return this.control("destroy"); }
        requestShutdown() { return this.control("request_shutdown"); }
        requestReboot() { return this.control("request_reboot"); }

        scheduleWakeup(delay) {
            // The machine preserves the requested wake delay between quanta.
            if (this.quantumRunning)
                return;
            const now = Date.now();
            const adjusted = this.exports.riscbox_wake_delay_ms(
                now >>> 0, Math.floor(now / 0x1_0000_0000) >>> 0, delay,
            );
            this.cancelWakeup();
            const token = this.wakeupToken;
            if (adjusted === 0) {
                // A message is a new browser task without nested timer clamping.
                if (this.wakeupChannel === null) {
                    const channel = new MessageChannel();
                    channel.port1.onmessage = ({ data }) => {
                        if (data !== this.wakeupToken)
                            return;
                        void this.runQuantum().catch((error) => this.options.onError?.(error));
                    };
                    channel.port1.unref?.();
                    channel.port2.unref?.();
                    this.wakeupChannel = channel;
                }
                this.wakeupChannel.port2.postMessage(token);
            } else {
                this.wakeupTimer = setTimeout(() => {
                    this.wakeupTimer = null;
                    if (token === this.wakeupToken)
                        void this.runQuantum().catch((error) => this.options.onError?.(error));
                }, adjusted);
            }
        }

        cancelWakeup() {
            this.wakeupToken++;
            if (this.wakeupTimer !== null) {
                clearTimeout(this.wakeupTimer);
                this.wakeupTimer = null;
            }
        }

        reportTiming(now) {
            // Only diagnostic mode accumulates and formats interval statistics.
            const timing = this.timing;
            if (!timing || now < timing.nextReport)
                return;
            const cpuRunsPerQuantum = timing.quanta ? timing.cpuRuns / timing.quanta : 0;
            const activeMCyclesPerSecond = timing.activeMs
                ? timing.cycles / timing.activeMs / 1_000 : 0;
            const rateStdDev = timing.rateSamples > 0
                ? Math.sqrt(timing.rateM2 / timing.rateSamples) : 0;
            const intervals = timing.timerIntervals;
            const medianTicks = intervals.length
                ? intervals.slice().sort((a, b) => a - b)[Math.floor(intervals.length / 2)] : 0;
            const skews = timing.sessionCatchUpSkews.slice().sort((a, b) => a - b);
            const skewPercentile = (fraction) => skews.length
                ? skews[Math.ceil(fraction * skews.length) - 1] * 100 : 0;
            console.log("Riscbox timing", {
                estimatedEmulatedMCyclesPerSecond: this.exports.riscbox_timing_stat(0) / 1_000_000,
                intervalEmulatedMCyclesPerSecondMean: timing.rateMean,
                intervalEmulatedMCyclesPerSecondStdDev: rateStdDev,
                activeEmulatedMCyclesPerSecond: activeMCyclesPerSecond,
                cpuRunsPerQuantum, timerReprogrammingExits: timing.timerReprogrammingExits,
                medianTimerIntervalMs: medianTicks / GUEST_TICKS_PER_MILLISECOND,
                wfiQuanta: timing.wfiQuanta, wfiMs: timing.wfiMs,
                carriedGuestMs: timing.carriedGuestMs,
                adaptiveGuestClockSkewPercent: this.exports.riscbox_timing_stat(6) * 100,
                intervalNoCatchUpSkewPercent: timing.intervalNoCatchUpSkew * 100,
                sessionPotentialCatchUpSkewP50Percent: skewPercentile(0.50),
                sessionPotentialCatchUpSkewP90Percent: skewPercentile(0.90),
                sessionPotentialCatchUpSkewP99Percent: skewPercentile(0.99),
            });
            timing.nextReport = now + 5_000;
            timing.quanta = timing.cpuRuns = timing.cycles = timing.activeMs = 0;
            timing.timerReprogrammingExits = timing.wfiQuanta = timing.wfiMs = 0;
            timing.carriedGuestMs = 0;
            timing.rateSamples = timing.rateMean = timing.rateM2 = 0;
            timing.timerIntervals = [];
            timing.intervalNoCatchUpSkew = 0;
        }

        async runQuantum() {
            // Host service drains copied queues before the same quantum resumes.
            if (this.quantumRunning)
                return;
            const now = Date.now();
            const begin = this.exports.riscbox_quantum_begin(
                now >>> 0, Math.floor(now / 0x1_0000_0000) >>> 0,
            );
            if (begin === QUANTUM_START_VM_INACTIVE)
                return;
            if (begin !== 0)
                throw new Error(`Riscbox WASM could not begin a quantum: ${begin}`);
            this.cancelWakeup();
            if (this.timing && this.wfiStartedAt !== undefined) {
                this.timing.wfiMs += performance.now() - this.wfiStartedAt;
                this.wfiStartedAt = undefined;
            }
            this.quantumRunning = true;
            const startedAt = performance.now();
            let nextDelay = 0;
            let wfiSleep = false;
            let vmInactive = false;
            let completed = false;
            try {
                for (;;) {
                    const reason = this.exports.riscbox_quantum_run();
                    if (reason < 0 || reason > QUANTUM_VM_INACTIVE)
                        throw new Error(`Riscbox WASM returned invalid quantum outcome ${reason}`);
                    this.drainActions();
                    if (reason === QUANTUM_BUDGET_REACHED ||
                        reason === QUANTUM_WFI_SLEEP || reason === QUANTUM_VM_INACTIVE) {
                        wfiSleep = reason === QUANTUM_WFI_SLEEP;
                        vmInactive = reason === QUANTUM_VM_INACTIVE;
                        break;
                    }

                }
                const end = Date.now();
                const elapsedMs = performance.now() - startedAt;
                nextDelay = this.exports.riscbox_quantum_finish(
                    elapsedMs,
                    end >>> 0, Math.floor(end / 0x1_0000_0000) >>> 0,
                );
                if (nextDelay < 0)
                    throw new Error("Riscbox WASM could not finish the quantum");
                completed = true;
                if (this.timing) {
                    const timing = this.timing;
                    timing.quanta++;
                    timing.cpuRuns += this.exports.riscbox_timing_stat(1);
                    timing.timerReprogrammingExits += this.exports.riscbox_timing_stat(2);
                    const cycles = this.exports.riscbox_timing_stat(4);
                    timing.cycles += cycles;
                    timing.carriedGuestMs = this.exports.riscbox_timing_stat(7)
                        / GUEST_TICKS_PER_MILLISECOND;
                    if (!wfiSleep && !vmInactive && elapsedMs > 0 && cycles > 0) {
                        const rate = cycles / elapsedMs / 1_000;
                        timing.rateSamples++;
                        const delta = rate - timing.rateMean;
                        timing.rateMean += delta / timing.rateSamples;
                        timing.rateM2 += delta * (rate - timing.rateMean);
                    }
                    const interval = this.exports.riscbox_timing_stat(3);
                    if (interval > 0 && timing.timerIntervals.length < 10_000)
                        timing.timerIntervals.push(interval);
                    if (!wfiSleep && !vmInactive) {
                        const requiredSkew = this.exports.riscbox_timing_stat(5);
                        if (requiredSkew > 0) {
                            timing.intervalNoCatchUpSkew = Math.max(
                                timing.intervalNoCatchUpSkew, requiredSkew,
                            );
                            timing.sessionCatchUpSkews.push(requiredSkew);
                        }
                    }
                    timing.activeMs += performance.now() - startedAt;
                    if (wfiSleep) timing.wfiQuanta++;
                    if (!vmInactive && this.started)
                        this.reportTiming(performance.now());
                }
            } finally {
                if (!completed)
                    this.exports.riscbox_quantum_abort();
                this.quantumRunning = false;
                for (const control of this.pendingControls.splice(0)) control();
            }
            if (wfiSleep && this.timing)
                this.wfiStartedAt = performance.now();
            if (!vmInactive && this.started)
                this.scheduleWakeup(nextDelay);
        }

        drainActions() {
            if (!this.exports.riscbox_next_action)
                return;
            let serviced = false;
            for (;;) {
                const kind = this.exports.riscbox_next_action();
                if (kind === 0) {
                    if (serviced) return;
                    if (!this.serviceStorage()) return;
                    serviced = true;
                    continue;
                }
                serviced = false;
                const value = this.exports.riscbox_action_value();
                const ptr = this.exports.riscbox_action_data_address();
                const len = this.exports.riscbox_action_data_length();
                if (kind === 15) {
                    const preparation = this.preparation;
                    if (!preparation) throw new Error("unexpected prepared platform");
                    try {
                        this.diskCount = preparation.diskCount;
                        for (const [index, bytes] of preparation.initial) this.block(index).write(0n, bytes);
                        this.preparation = null;
                        preparation.resolve();
                    } catch (error) { this.failPreparation(error); }
                } else if (kind === 1) {
                    const generation = this.httpGeneration;
                    const url = decoder.decode(this.bytes(ptr, len));
                    const fetchRequest = this.options.fetch ?? globalThis.fetch;
                    if (typeof fetchRequest !== "function")
                        throw new Error("Riscbox HTTP fetch is not available");
                    const hashedPath = /(?:^|\/)[^/?#]*-[0-9a-f]{8,64}(?:\.|\/|[?#]|$)/i.test(url);
                    const cache = url === this.configUrl ? "no-store"
                        : hashedPath ? "force-cache" : "default";
                    const disk = this.exports.riscbox_action_disk();
                    let completed = false;
                    const load = async () => {
                        if (disk !== 0 && this.options.fetchBlock) {
                            const data = await this.options.fetchBlock({ disk: disk - 1, url, cache });
                            if (!(data instanceof Uint8Array)) throw new TypeError("fetchBlock must return Uint8Array");
                            return { data, status: 200 };
                        }
                        const response = await fetchRequest(url, { cache });
                        return { data: new Uint8Array(await response.arrayBuffer()), status: response.status ?? 200 };
                    };
                    load().then(({ data, status }) => {
                        if (generation !== this.httpGeneration) return;
                        this.withBytes(data, (dataPtr, dataLen) => {
                            const result = this.exports.riscbox_http_complete(
                                value, status, dataPtr, dataLen,
                            );
                            completed = true;
                            if (result !== 0)
                                throw new Error(`Riscbox rejected HTTP response ${value}`);
                        });
                        this.drainActions();
                        if (this.started)
                            this.scheduleWakeup(0);
                    }).catch((error) => {
                        if (generation !== this.httpGeneration) return;
                        if (disk !== 0 && !completed) {
                            const result = this.exports.riscbox_http_complete(value, 500, 0, 0);
                            this.drainActions();
                            if (this.started) this.scheduleWakeup(0);
                            if (result === 0) return;
                        }
                        this.failPreparation(error);
                        this.options.onError?.(error);
                    });
                } else if (kind === 2) {
                    this.started = true;
                    this.options.onVmStarted?.();
                    this.scheduleWakeup(0);
                } else if (kind === 3) {
                    this.options.consoleWrite?.(decoder.decode(this.bytes(ptr, len)));
                } else if (kind === 4) {
                    this.options.networkWrite?.(this.bytes(ptr, len));
                } else if (kind === 6) {
                    const x = this.exports.riscbox_action_x();
                    const y = this.exports.riscbox_action_y();
                    const width = this.exports.riscbox_action_width();
                    const height = this.exports.riscbox_action_height();
                    const stride = this.exports.riscbox_action_stride();
                    const end = ptr + len;
                    const memory = new Uint8Array(this.exports.memory.buffer);
                    if (!Number.isSafeInteger(end) || ptr < 0 || len < 0 || end > memory.length)
                        throw new RangeError("framebuffer range is outside WASM memory");
                    this.options.framebufferRefresh?.(
                        memory.subarray(ptr, end),
                        { x, y, width, height, stride },
                    );
                } else if (kind === 10) {
                    const cause = LIFECYCLE_CAUSES[value];
                    if (cause === undefined)
                        throw new Error(`invalid VM halt cause ${value}`);
                    this.started = false;
                    this.cancelWakeup();
                    this.options.onVmHalted?.(cause);
                } else if (kind === 11) {
                    this.httpGeneration++;
                    const cause = LIFECYCLE_CAUSES[value];
                    if (cause === undefined)
                        throw new Error(`invalid VM reset cause ${value}`);
                    this.started = true;
                    this.options.consoleReset?.();
                    this.options.framebufferClear?.();
                    this.options.onVmReset?.(cause);
                    if (cause === "host-boot") this.options.onVmStarted?.();
                } else {
                    throw new Error(`unknown Riscbox host action ${kind}`);
                }
            }
        }

        reportFilesystemError(error) {
            if (this.options.onError) this.options.onError(error);
            else console.error(error);
        }

        // Events and disk completions are serviced after WASM releases its borrows.
        serviceStorage() {
            if (this.servicingFilesystems) return false;
            this.servicingFilesystems = true;
            let polled = false;
            try {
                for (const filesystem of this.filesystems.values()) filesystem.poll();
                for (const disk of this.disks.values()) polled = disk.poll() || polled;
            } finally { this.servicingFilesystems = false; }
            return polled;
        }

        filesystemChanged() {
            this.serviceStorage();
            if (this.started && !this.quantumRunning) this.scheduleWakeup(0);
        }

        consoleInput(data) {
            return this.withBytes(data, (ptr, len) =>
                this.exports.riscbox_console_input(ptr, len));
        }

        consoleResize(width, height) {
            return this.exports.riscbox_console_resize(width, height);
        }

        keyEvent(isDown, keyCode) {
            return this.exports.riscbox_key_event(isDown ? 1 : 0, keyCode);
        }

        pointerEvent(x, y, buttons) {
            return this.exports.riscbox_pointer_event(x, y, buttons);
        }

        wheelEvent(delta) {
            return this.exports.riscbox_wheel_event(delta);
        }

        networkInput(packet) {
            return this.withBytes(packet, (ptr, len) =>
                this.exports.riscbox_network_input(ptr, len));
        }

        networkCarrier(up) {
            return this.exports.riscbox_network_carrier(up ? 1 : 0);
        }

    }

    root.Riscbox = Riscbox;
    if (typeof module === "object" && module.exports)
        module.exports = { Riscbox, ...root.RiscboxStorage };
}(globalThis));
