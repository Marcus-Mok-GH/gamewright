/**
 * Gamewright — share links + personal shelf.
 *
 * Wire format of a share payload:
 *
 *   #g=<prefix><base64url>
 *     prefix "1" -> raw DEFLATE stream of the UTF-8 JSON body
 *     prefix "0" -> plain UTF-8 JSON body
 *     body   -> { title, prompt, html, cover }
 *
 * base64url is standard base64 with "+"->"-", "/"->"_" and no "=" padding, so
 * the payload survives in a URL fragment untouched.
 *
 * The module is dependency-free and side-effect-free: every browser API it
 * touches (localStorage, btoa/atob, TextEncoder/TextDecoder,
 * crypto.getRandomValues, location) is called from inside a function, never at
 * module scope, so importing it is safe in a browser, in Node or in a test
 * runner.
 *
 * encodeGame()/decodeGame() are synchronous by contract, while the
 * CompressionStream API is asynchronous, so the module carries its own small
 * raw-DEFLATE codec. The bytes it emits are a standard raw-deflate stream
 * (any zlib or browser inflater reads them) and its reader understands streams
 * produced by CompressionStream("deflate-raw").
 */

const SHELF_KEY = "gamewright.shelf.v1";
const SHELF_LIMIT = 40;
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const B64_CHUNK = 0x8000;

let memoryShelf = [];
let shelfBroken = false;

function text(value) {
    return value === undefined || value === null ? "" : String(value);
}

function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

/* ------------------------------------------------------------------ *
 * base64url
 * ------------------------------------------------------------------ */

function bytesToBase64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += B64_CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + B64_CHUNK));
    }
    return btoa(binary);
}

function base64ToBytes(b64) {
    let s = String(b64).replace(/-/g, "+").replace(/_/g, "/");
    const rem = s.length % 4;
    if (rem === 1) throw new Error("bad base64url");
    if (rem > 0) s += "=".repeat(4 - rem);
    const binary = atob(s);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i) & 0xff;
    return out;
}

function toBase64Url(bytes) {
    return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value) {
    return base64ToBytes(value);
}

/* ------------------------------------------------------------------ *
 * raw DEFLATE — encoder (fixed Huffman blocks + LZ77)
 * ------------------------------------------------------------------ */

const LENGTH_BASE = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
    163, 195, 227, 258,
];
const LENGTH_EXTRA = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
    3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
    13,
];

class BitWriter {
    constructor() {
        this.out = [];
        this.acc = 0;
        this.bits = 0;
    }

    writeBits(value, count) {
        for (let i = 0; i < count; i += 1) {
            this.acc |= ((value >>> i) & 1) << this.bits;
            this.bits += 1;
            if (this.bits === 8) {
                this.out.push(this.acc);
                this.acc = 0;
                this.bits = 0;
            }
        }
    }

    writeCode(code, count) {
        for (let i = count - 1; i >= 0; i -= 1) {
            this.acc |= ((code >>> i) & 1) << this.bits;
            this.bits += 1;
            if (this.bits === 8) {
                this.out.push(this.acc);
                this.acc = 0;
                this.bits = 0;
            }
        }
    }

    finish() {
        if (this.bits > 0) {
            this.out.push(this.acc);
            this.acc = 0;
            this.bits = 0;
        }
        return Uint8Array.from(this.out);
    }
}

function writeFixedLiteral(writer, symbol) {
    if (symbol < 144) writer.writeCode(0x30 + symbol, 8);
    else if (symbol < 256) writer.writeCode(0x190 + symbol - 144, 9);
    else if (symbol < 280) writer.writeCode(symbol - 256, 7);
    else writer.writeCode(0xc0 + symbol - 280, 8);
}

function lengthSymbol(length) {
    for (let i = LENGTH_BASE.length - 1; i >= 0; i -= 1) {
        if (length >= LENGTH_BASE[i]) return i;
    }
    return 0;
}

function distanceSymbol(distance) {
    for (let i = DIST_BASE.length - 1; i >= 0; i -= 1) {
        if (distance >= DIST_BASE[i]) return i;
    }
    return 0;
}

function deflateRaw(input) {
    const source = input instanceof Uint8Array ? input : Uint8Array.from(input || []);
    const size = source.length;
    const writer = new BitWriter();

    writer.writeBits(1, 1); // BFINAL
    writer.writeBits(1, 2); // BTYPE = 01 (fixed Huffman)

    const HASH_BITS = 15;
    const HASH_SIZE = 1 << HASH_BITS;
    const MAX_CHAIN = 32;
    const head = new Int32Array(HASH_SIZE).fill(-1);
    const prev = new Int32Array(Math.max(size, 1)).fill(-1);

    function hashAt(at) {
        return ((source[at] << 10) ^ (source[at + 1] << 5) ^ source[at + 2]) & (HASH_SIZE - 1);
    }

    function insert(at) {
        if (at + 2 >= size) return;
        const h = hashAt(at);
        prev[at] = head[h];
        head[h] = at;
    }

    let pos = 0;
    while (pos < size) {
        let bestLength = 0;
        let bestDistance = 0;

        if (pos + 2 < size) {
            const maxLength = Math.min(258, size - pos);
            let candidate = head[hashAt(pos)];
            let chain = 0;
            while (candidate >= 0 && chain < MAX_CHAIN) {
                const distance = pos - candidate;
                if (distance <= 0 || distance > 32768) break;
                if (
                    bestLength < maxLength &&
                    source[candidate + bestLength] === source[pos + bestLength]
                ) {
                    let length = 0;
                    while (
                        length < maxLength &&
                        source[candidate + length] === source[pos + length]
                    ) {
                        length += 1;
                    }
                    if (length > bestLength) {
                        bestLength = length;
                        bestDistance = distance;
                        if (length >= maxLength) break;
                    }
                }
                candidate = prev[candidate];
                chain += 1;
            }
        }

        if (bestLength >= 3) {
            const ls = lengthSymbol(bestLength);
            writeFixedLiteral(writer, 257 + ls);
            if (LENGTH_EXTRA[ls]) {
                writer.writeBits(bestLength - LENGTH_BASE[ls], LENGTH_EXTRA[ls]);
            }
            const ds = distanceSymbol(bestDistance);
            writer.writeCode(ds, 5);
            if (DIST_EXTRA[ds]) {
                writer.writeBits(bestDistance - DIST_BASE[ds], DIST_EXTRA[ds]);
            }
            for (let i = 0; i < bestLength; i += 1) insert(pos + i);
            pos += bestLength;
        } else {
            writeFixedLiteral(writer, source[pos]);
            insert(pos);
            pos += 1;
        }
    }

    writeFixedLiteral(writer, 256); // end of block
    return writer.finish();
}

/* ------------------------------------------------------------------ *
 * raw DEFLATE — decoder (stored / fixed / dynamic Huffman blocks)
 * ------------------------------------------------------------------ */

const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function buildHuffman(lengths, count) {
    const counts = new Int32Array(16);
    for (let i = 0; i < count; i += 1) counts[lengths[i]] += 1;
    counts[0] = 0;
    const offsets = new Int32Array(16);
    for (let len = 1; len < 16; len += 1) {
        offsets[len] = offsets[len - 1] + counts[len - 1];
    }
    const symbols = new Int32Array(count);
    for (let i = 0; i < count; i += 1) {
        if (lengths[i]) symbols[offsets[lengths[i]]] = i;
        offsets[lengths[i]] += 1;
    }
    return { counts, symbols };
}

function inflateRaw(input) {
    const source = input instanceof Uint8Array ? input : Uint8Array.from(input || []);
    let pos = 0;
    let bitBuf = 0;
    let bitCount = 0;

    let out = new Uint8Array(Math.max(1024, source.length * 4));
    let outLen = 0;

    function ensure(extra) {
        if (outLen + extra <= out.length) return;
        let size = out.length * 2;
        while (size < outLen + extra) size *= 2;
        const next = new Uint8Array(size);
        next.set(out.subarray(0, outLen));
        out = next;
    }

    function push(byte) {
        ensure(1);
        out[outLen] = byte;
        outLen += 1;
    }

    function needBits(count) {
        while (bitCount < count) {
            if (pos >= source.length) throw new Error("unexpected end of deflate stream");
            bitBuf |= source[pos] << bitCount;
            pos += 1;
            bitCount += 8;
        }
    }

    function getBits(count) {
        if (count === 0) return 0;
        needBits(count);
        const value = bitBuf & ((1 << count) - 1);
        bitBuf >>>= count;
        bitCount -= count;
        return value;
    }

    function decodeSymbol(table) {
        let code = 0;
        let first = 0;
        let index = 0;
        for (let len = 1; len < 16; len += 1) {
            code |= getBits(1);
            const count = table.counts[len];
            if (code - first < count) return table.symbols[index + (code - first)];
            index += count;
            first = (first + count) << 1;
            code <<= 1;
        }
        throw new Error("invalid huffman code");
    }

    function fixedTables() {
        const litLengths = new Uint8Array(288);
        for (let i = 0; i < 144; i += 1) litLengths[i] = 8;
        for (let i = 144; i < 256; i += 1) litLengths[i] = 9;
        for (let i = 256; i < 280; i += 1) litLengths[i] = 7;
        for (let i = 280; i < 288; i += 1) litLengths[i] = 8;
        const distLengths = new Uint8Array(30).fill(5);
        return {
            litLength: buildHuffman(litLengths, 288),
            distance: buildHuffman(distLengths, 30),
        };
    }

    function decodeBlock(litLengthTable, distanceTable) {
        for (;;) {
            const symbol = decodeSymbol(litLengthTable);
            if (symbol < 256) {
                push(symbol);
            } else if (symbol === 256) {
                return;
            } else {
                const li = symbol - 257;
                if (li >= LENGTH_BASE.length) throw new Error("invalid length symbol");
                const length = LENGTH_BASE[li] + getBits(LENGTH_EXTRA[li]);
                const ds = decodeSymbol(distanceTable);
                if (ds >= DIST_BASE.length) throw new Error("invalid distance symbol");
                const distance = DIST_BASE[ds] + getBits(DIST_EXTRA[ds]);
                if (distance <= 0 || distance > outLen) throw new Error("invalid distance");
                ensure(length);
                for (let i = 0; i < length; i += 1) {
                    out[outLen] = out[outLen - distance];
                    outLen += 1;
                }
            }
        }
    }

    let final = 0;
    do {
        final = getBits(1);
        const type = getBits(2);
        if (type === 0) {
            bitBuf >>>= bitCount & 7;
            bitCount -= bitCount & 7;
            const buffered = bitCount >> 3;
            pos -= buffered;
            bitBuf = 0;
            bitCount = 0;
            if (pos + 4 > source.length) throw new Error("truncated stored block");
            const len = source[pos] | (source[pos + 1] << 8);
            const nlen = source[pos + 2] | (source[pos + 3] << 8);
            pos += 4;
            if ((len ^ 0xffff) !== nlen) throw new Error("corrupt stored block");
            if (pos + len > source.length) throw new Error("truncated stored block");
            ensure(len);
            out.set(source.subarray(pos, pos + len), outLen);
            outLen += len;
            pos += len;
        } else if (type === 1) {
            const tables = fixedTables();
            decodeBlock(tables.litLength, tables.distance);
        } else if (type === 2) {
            const hlit = getBits(5) + 257;
            const hdist = getBits(5) + 1;
            const hclen = getBits(4) + 4;
            const codeLengths = new Uint8Array(19);
            for (let i = 0; i < hclen; i += 1) codeLengths[CL_ORDER[i]] = getBits(3);
            const codeTable = buildHuffman(codeLengths, 19);
            const lengths = new Uint8Array(hlit + hdist);
            let index = 0;
            while (index < hlit + hdist) {
                const symbol = decodeSymbol(codeTable);
                if (symbol < 16) {
                    lengths[index] = symbol;
                    index += 1;
                } else if (symbol === 16) {
                    if (index === 0) throw new Error("invalid repeat");
                    const previous = lengths[index - 1];
                    let repeat = 3 + getBits(2);
                    while (repeat > 0) {
                        lengths[index] = previous;
                        index += 1;
                        repeat -= 1;
                    }
                } else if (symbol === 17) {
                    let repeat = 3 + getBits(3);
                    while (repeat > 0) {
                        lengths[index] = 0;
                        index += 1;
                        repeat -= 1;
                    }
                } else {
                    let repeat = 11 + getBits(7);
                    while (repeat > 0) {
                        lengths[index] = 0;
                        index += 1;
                        repeat -= 1;
                    }
                }
            }
            decodeBlock(
                buildHuffman(lengths.subarray(0, hlit), hlit),
                buildHuffman(lengths.subarray(hlit), hdist),
            );
        } else {
            throw new Error("invalid block type");
        }
    } while (!final);

    return out.slice(0, outLen);
}

/* ------------------------------------------------------------------ *
 * share payload
 * ------------------------------------------------------------------ */

function normaliseGame(raw) {
    return {
        title: text(raw?.title),
        prompt: text(raw?.prompt),
        html: text(raw?.html),
        cover: text(raw?.cover),
    };
}

/**
 * Pack a finished game into a compact, ASCII-safe payload string.
 *
 * The body is JSON -> UTF-8 -> raw DEFLATE -> base64url, prefixed with "1".
 * Compression uses the module's own raw-DEFLATE encoder rather than
 * CompressionStream: this API is synchronous and the stream API is not, and
 * the bytes it produces are interchangeable with CompressionStream
 * ("deflate-raw") output. When no compression is possible at all the body
 * stays plain UTF-8 and the payload is prefixed with "0" instead.
 *
 * @param {{title?:string,prompt?:string,html?:string,cover?:string}} game
 * @returns {string}
 */
export function encodeGame(game) {
    const body = normaliseGame(game);
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    if (typeof CompressionStream === "undefined") {
        return `0${toBase64Url(bytes)}`;
    }
    try {
        return `1${toBase64Url(deflateRaw(bytes))}`;
    } catch (_error) {
        return `0${toBase64Url(bytes)}`;
    }
}

/**
 * Unpack a share payload. Accepts the payload with or without a leading
 * "#g=". Returns null for anything malformed.
 * @param {string} fragment
 * @returns {{title:string,prompt:string,html:string,cover:string}|null}
 */
export function decodeGame(fragment) {
    try {
        if (typeof fragment !== "string") return null;
        let value = fragment.trim();
        if (value.startsWith("#g=")) value = value.slice(3);
        if (!value) return null;

        const prefix = value[0];
        const body = value.slice(1);
        if (prefix !== "0" && prefix !== "1") return null;
        if (!/^[A-Za-z0-9\-_]*$/.test(body)) return null;

        const bytes = fromBase64Url(body);
        const raw = prefix === "1" ? inflateRaw(bytes) : bytes;
        const json = new TextDecoder("utf-8", { fatal: true }).decode(raw);
        const parsed = JSON.parse(json);
        if (!isPlainObject(parsed)) return null;
        return normaliseGame(parsed);
    } catch (_error) {
        return null;
    }
}

/**
 * Build the shareable URL for a payload: base URL with the fragment replaced.
 * @param {string} baseHref
 * @param {string} payload
 * @returns {string}
 */
export function buildShareUrl(baseHref, payload) {
    let base = baseHref;
    if (!base && typeof location !== "undefined" && location?.href) {
        base = location.href;
    }
    const clean = text(base).split("#")[0];
    return `${clean}#g=${text(payload)}`;
}

/**
 * Read a shared game out of a location-like object.
 * @param {{hash?:string}} loc
 * @returns {{title:string,prompt:string,html:string,cover:string}|null}
 */
export function readShareFromLocation(loc) {
    try {
        const hash = loc && typeof loc.hash === "string" ? loc.hash : "";
        if (!hash.startsWith("#g=")) return null;
        return decodeGame(hash.slice(3));
    } catch (_error) {
        return null;
    }
}

/* ------------------------------------------------------------------ *
 * shelf (localStorage)
 * ------------------------------------------------------------------ */

function shelfStorage() {
    if (shelfBroken) return null;
    try {
        if (typeof localStorage === "undefined" || !localStorage) return null;
        return localStorage;
    } catch (_error) {
        return null;
    }
}

function readShelf() {
    const store = shelfStorage();
    if (!store) return memoryShelf.slice();
    let raw = null;
    try {
        raw = store.getItem(SHELF_KEY);
    } catch (_error) {
        return memoryShelf.slice();
    }
    if (raw === null || raw === undefined) return memoryShelf.slice();
    let entries = [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            entries = parsed
                .filter((entry) => isPlainObject(entry))
                .map((entry) => ({
                    id: text(entry.id),
                    title: text(entry.title),
                    prompt: text(entry.prompt),
                    html: text(entry.html),
                    cover: text(entry.cover),
                    createdAt: text(entry.createdAt),
                }));
        }
    } catch (_error) {
        entries = [];
    }
    memoryShelf = entries;
    return entries.slice();
}

function writeShelf(entries) {
    memoryShelf = entries.slice();
    const store = shelfStorage();
    if (!store) return;
    try {
        store.setItem(SHELF_KEY, JSON.stringify(entries));
    } catch (_error) {
        /* quota exceeded or storage blocked: keep the in-memory shelf working */
        shelfBroken = true;
    }
}
/**
 * Newest-first ordering. The shelf is stored in write order (oldest write
 * first); reversing puts the most recently written game in front, and the
 * stable sort by createdAt keeps that order for games saved inside the same
 * millisecond.
 * @param {Array<object>} entries
 * @returns {Array<object>}
 */
function newestFirst(entries) {
    return entries
        .slice()
        .reverse()
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

function makeId() {
    let random = "";
    try {
        const bytes = new Uint8Array(8);
        crypto.getRandomValues(bytes);
        for (let i = 0; i < bytes.length; i += 1) {
            random += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
        }
    } catch (_error) {
        random = Math.random().toString(36).slice(2, 10);
    }
    return `g_${random}`;
}

/**
 * Save (or update) a game on the shelf.
 * @param {{id?:string,title?:string,prompt?:string,html?:string,cover?:string,createdAt?:string}} game
 * @returns {{id:string,title:string,prompt:string,html:string,cover:string,createdAt:string}}
 */
export function saveGame(game) {
    const source = isPlainObject(game) ? game : {};
    const entry = {
        id: text(source.id) || makeId(),
        title: text(source.title),
        prompt: text(source.prompt),
        html: text(source.html),
        cover: text(source.cover),
        createdAt: text(source.createdAt) || new Date().toISOString(),
    };

    const shelf = readShelf().filter((item) => item.id !== entry.id);
    shelf.push(entry);

    const kept = newestFirst(shelf).slice(0, SHELF_LIMIT);
    writeShelf(kept.slice().reverse());
    return entry;
}

/**
 * All saved games, newest first.
 * @returns {Array<object>}
 */
export function listGames() {
    return newestFirst(readShelf());
}

/**
 * Remove one saved game by id.
 * @param {string} id
 * @returns {void}
 */
export function deleteGame(id) {
    const target = text(id);
    const shelf = readShelf().filter((item) => item.id !== target);
    writeShelf(shelf);
}

/**
 * Remove every saved game.
 * @returns {void}
 */
export function clearGames() {
    writeShelf([]);
}
