/**
 * SHA-256 as lowercase hex, wherever the page was loaded from.
 *
 * Web Crypto's `crypto.subtle` exists only in a secure context: HTTPS, or
 * `localhost`. Stream Keepr is also opened over plain HTTP on a LAN address (a
 * phone, a tablet or the broadcast machine against a bypassed launcher, README
 * § Local auth bypass), and there `crypto.subtle` is undefined. So the digest
 * comes from Web Crypto where it exists, which is faster on a large upload,
 * and is computed here where it does not.
 *
 * Browser code takes a digest through this and nothing else: the lint refuses
 * `crypto.subtle` and `crypto.randomUUID` in `app/` and `shared/`.
 */
export async function sha256Hex(bytes: ArrayBuffer | ArrayBufferView): Promise<string> {
	const subtle = globalThis.crypto?.subtle;
	const view = ArrayBuffer.isView(bytes)
		? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
		: new Uint8Array(bytes);
	return subtle
		? hex(new Uint8Array(await subtle.digest('SHA-256', view as BufferSource)))
		: sha256HexWithoutWebCrypto(view);
}

function hex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const ROUND_CONSTANTS = Uint32Array.of(
	0x428a2f98,
	0x71374491,
	0xb5c0fbcf,
	0xe9b5dba5,
	0x3956c25b,
	0x59f111f1,
	0x923f82a4,
	0xab1c5ed5,
	0xd807aa98,
	0x12835b01,
	0x243185be,
	0x550c7dc3,
	0x72be5d74,
	0x80deb1fe,
	0x9bdc06a7,
	0xc19bf174,
	0xe49b69c1,
	0xefbe4786,
	0x0fc19dc6,
	0x240ca1cc,
	0x2de92c6f,
	0x4a7484aa,
	0x5cb0a9dc,
	0x76f988da,
	0x983e5152,
	0xa831c66d,
	0xb00327c8,
	0xbf597fc7,
	0xc6e00bf3,
	0xd5a79147,
	0x06ca6351,
	0x14292967,
	0x27b70a85,
	0x2e1b2138,
	0x4d2c6dfc,
	0x53380d13,
	0x650a7354,
	0x766a0abb,
	0x81c2c92e,
	0x92722c85,
	0xa2bfe8a1,
	0xa81a664b,
	0xc24b8b70,
	0xc76c51a3,
	0xd192e819,
	0xd6990624,
	0xf40e3585,
	0x106aa070,
	0x19a4c116,
	0x1e376c08,
	0x2748774c,
	0x34b0bcb5,
	0x391c0cb3,
	0x4ed8aa4a,
	0x5b9cca4f,
	0x682e6ff3,
	0x748f82ee,
	0x78a5636f,
	0x84c87814,
	0x8cc70208,
	0x90befffa,
	0xa4506ceb,
	0xbef9a3f7,
	0xc67178f2,
);

function rotateRight(value: number, bits: number): number {
	return (value >>> bits) | (value << (32 - bits));
}

/** The same digest with no platform help. Exported for its test; call `sha256Hex`. */
export function sha256HexWithoutWebCrypto(bytes: Uint8Array): string {
	// The message, a 1 bit, zeros, then its length in bits as 64 bits: a whole number of 64-byte blocks.
	const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
	const padded = new Uint8Array(paddedLength);
	padded.set(bytes);
	padded[bytes.length] = 0x80;
	const blocks = new DataView(padded.buffer);
	blocks.setUint32(paddedLength - 8, Math.floor(bytes.length / 0x20000000));
	blocks.setUint32(paddedLength - 4, (bytes.length * 8) >>> 0);

	const state = Uint32Array.of(
		0x6a09e667,
		0xbb67ae85,
		0x3c6ef372,
		0xa54ff53a,
		0x510e527f,
		0x9b05688c,
		0x1f83d9ab,
		0x5be0cd19,
	);
	const schedule = new Uint32Array(64);
	for (let offset = 0; offset < paddedLength; offset += 64) {
		for (let index = 0; index < 16; index++) schedule[index] = blocks.getUint32(offset + index * 4);
		for (let index = 16; index < 64; index++) {
			const before15 = schedule[index - 15]!;
			const before2 = schedule[index - 2]!;
			const small0 = rotateRight(before15, 7) ^ rotateRight(before15, 18) ^ (before15 >>> 3);
			const small1 = rotateRight(before2, 17) ^ rotateRight(before2, 19) ^ (before2 >>> 10);
			schedule[index] = (schedule[index - 16]! + small0 + schedule[index - 7]! + small1) >>> 0;
		}

		let [a, b, c, d, e, f, g, h] = state as unknown as [
			number,
			number,
			number,
			number,
			number,
			number,
			number,
			number,
		];
		for (let index = 0; index < 64; index++) {
			const big1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
			const choice = (e & f) ^ (~e & g);
			const first = (h + big1 + choice + ROUND_CONSTANTS[index]! + schedule[index]!) >>> 0;
			const big0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
			const majority = (a & b) ^ (a & c) ^ (b & c);
			const second = (big0 + majority) >>> 0;
			h = g;
			g = f;
			f = e;
			e = (d + first) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (first + second) >>> 0;
		}
		state[0] = (state[0]! + a) >>> 0;
		state[1] = (state[1]! + b) >>> 0;
		state[2] = (state[2]! + c) >>> 0;
		state[3] = (state[3]! + d) >>> 0;
		state[4] = (state[4]! + e) >>> 0;
		state[5] = (state[5]! + f) >>> 0;
		state[6] = (state[6]! + g) >>> 0;
		state[7] = (state[7]! + h) >>> 0;
	}

	const digest = new Uint8Array(32);
	const out = new DataView(digest.buffer);
	state.forEach((word, index) => out.setUint32(index * 4, word));
	return hex(digest);
}
