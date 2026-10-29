/**
 * Minimal AES-256-CBC decryption.
 *
 * Nuvio's plugin sandbox exposes no WebCrypto, so the MegaPlay player
 * (used by GogoAnimes) payload is decrypted here with a small, dependency
 * free implementation. Only decryption is implemented.
 */

const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);

function xtime(value) {
	return ((value << 1) ^ (value & 0x80 ? 0x1b : 0)) & 0xff;
}

function multiply(a, b) {
	let product = 0;
	let left = a;
	let right = b;

	for (let index = 0; index < 8; index += 1) {
		if (right & 1) product ^= left;
		const high = left & 0x80;
		left = (left << 1) & 0xff;
		if (high) left ^= 0x1b;
		right >>= 1;
	}

	return product;
}

function inverse(value) {
	if (!value) return 0;
	for (let candidate = 1; candidate < 256; candidate += 1) {
		if (multiply(value, candidate) === 1) return candidate;
	}
	return 0;
}

function rotateLeft(value, shift) {
	return ((value << shift) | (value >> (8 - shift))) & 0xff;
}

(function buildTables() {
	for (let value = 0; value < 256; value += 1) {
		const inv = inverse(value);
		const substituted =
			(inv ^
				rotateLeft(inv, 1) ^
				rotateLeft(inv, 2) ^
				rotateLeft(inv, 3) ^
				rotateLeft(inv, 4) ^
				0x63) &
			0xff;
		SBOX[value] = substituted;
		INV_SBOX[substituted] = value;
	}
})();

function expandKey(key) {
	const keyBytes = key.length;
	const rounds = keyBytes / 4 + 6;
	const expanded = new Uint8Array(16 * (rounds + 1));
	expanded.set(key);

	let generated = keyBytes;
	let rcon = 1;
	const temp = new Uint8Array(4);

	while (generated < expanded.length) {
		for (let index = 0; index < 4; index += 1)
			temp[index] = expanded[generated - 4 + index];

		if (generated % keyBytes === 0) {
			const first = temp[0];
			temp[0] = temp[1];
			temp[1] = temp[2];
			temp[2] = temp[3];
			temp[3] = first;

			for (let index = 0; index < 4; index += 1)
				temp[index] = SBOX[temp[index]];
			temp[0] ^= rcon;
			rcon = xtime(rcon);
		} else if (keyBytes > 24 && generated % keyBytes === 16) {
			for (let index = 0; index < 4; index += 1)
				temp[index] = SBOX[temp[index]];
		}

		for (let index = 0; index < 4; index += 1) {
			expanded[generated] = expanded[generated - keyBytes] ^ temp[index];
			generated += 1;
		}
	}

	return { expanded, rounds };
}

function addRoundKey(state, expanded, round) {
	const offset = round * 16;
	for (let index = 0; index < 16; index += 1)
		state[index] ^= expanded[offset + index];
}

function invSubBytes(state) {
	for (let index = 0; index < 16; index += 1)
		state[index] = INV_SBOX[state[index]];
}

function invShiftRows(state) {
	for (let row = 1; row < 4; row += 1) {
		const values = [
			state[row],
			state[row + 4],
			state[row + 8],
			state[row + 12],
		];
		for (let column = 0; column < 4; column += 1) {
			state[row + 4 * ((column + row) % 4)] = values[column];
		}
	}
}

function invMixColumns(state) {
	for (let column = 0; column < 4; column += 1) {
		const offset = column * 4;
		const a0 = state[offset];
		const a1 = state[offset + 1];
		const a2 = state[offset + 2];
		const a3 = state[offset + 3];

		state[offset] =
			multiply(a0, 14) ^ multiply(a1, 11) ^ multiply(a2, 13) ^ multiply(a3, 9);
		state[offset + 1] =
			multiply(a0, 9) ^ multiply(a1, 14) ^ multiply(a2, 11) ^ multiply(a3, 13);
		state[offset + 2] =
			multiply(a0, 13) ^ multiply(a1, 9) ^ multiply(a2, 14) ^ multiply(a3, 11);
		state[offset + 3] =
			multiply(a0, 11) ^ multiply(a1, 13) ^ multiply(a2, 9) ^ multiply(a3, 14);
	}
}

function decryptBlock(block, expanded, rounds) {
	const state = new Uint8Array(block);

	addRoundKey(state, expanded, rounds);

	for (let round = rounds - 1; round >= 1; round -= 1) {
		invShiftRows(state);
		invSubBytes(state);
		addRoundKey(state, expanded, round);
		invMixColumns(state);
	}

	invShiftRows(state);
	invSubBytes(state);
	addRoundKey(state, expanded, 0);

	return state;
}

function stripPadding(bytes) {
	if (!bytes.length) return bytes;

	const padding = bytes[bytes.length - 1];
	if (padding < 1 || padding > 16 || padding > bytes.length) return bytes;

	for (let index = bytes.length - padding; index < bytes.length; index += 1) {
		if (bytes[index] !== padding) return bytes;
	}

	return bytes.subarray(0, bytes.length - padding);
}

/**
 * @param {Uint8Array} cipher
 * @param {Uint8Array} key 16, 24 or 32 bytes
 * @param {Uint8Array} iv 16 bytes
 * @returns {Uint8Array}
 */
export function aesCbcDecrypt(cipher, key, iv) {
	if (!cipher?.length || cipher.length % 16 !== 0) {
		throw new Error("AES-CBC ciphertext length must be a multiple of 16");
	}
	if (!key || (key.length !== 16 && key.length !== 24 && key.length !== 32)) {
		throw new Error("AES key must be 16, 24 or 32 bytes");
	}
	if (iv?.length !== 16) throw new Error("AES-CBC needs a 16 byte IV");

	const { expanded, rounds } = expandKey(key);
	const output = new Uint8Array(cipher.length);
	let previous = iv;

	for (let offset = 0; offset < cipher.length; offset += 16) {
		const block = cipher.subarray(offset, offset + 16);
		const decrypted = decryptBlock(block, expanded, rounds);

		for (let index = 0; index < 16; index += 1) {
			output[offset + index] = decrypted[index] ^ previous[index];
		}

		previous = block;
	}

	return stripPadding(output);
}

/**
 * Decodes a standard or URL-safe base64 string into bytes without relying on
 * the runtime `atob` implementation.
 *
 * @param {unknown} value
 * @returns {Uint8Array}
 */
export function decodeBase64(value) {
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	const input = String(value || "")
		.replace(/-/g, "+")
		.replace(/_/g, "/")
		.replace(/[^A-Za-z0-9+/=]/g, "");

	const output = [];
	let buffer = 0;
	let bits = 0;

	for (let index = 0; index < input.length; index += 1) {
		const character = input.charAt(index);
		if (character === "=") break;

		const valueAtIndex = alphabet.indexOf(character);
		if (valueAtIndex === -1) continue;

		buffer = (buffer << 6) | valueAtIndex;
		bits += 6;

		if (bits >= 8) {
			bits -= 8;
			output.push((buffer >> bits) & 0xff);
		}
	}

	return new Uint8Array(output);
}

/**
 * Pads a short ASCII/UTF-8 key or IV with zero bytes, matching the player's
 * `padKeyBytes` helper.
 *
 * @param {string} text
 * @param {number} size
 * @returns {Uint8Array}
 */
export function padBytes(text, size) {
	const output = new Uint8Array(size);
	const source = utf8Encode(String(text));
	output.set(source.subarray(0, Math.min(size, source.length)));
	return output;
}

/**
 * @param {string} text
 * @returns {Uint8Array}
 */
export function utf8Encode(text) {
	const bytes = [];

	for (let index = 0; index < text.length; index += 1) {
		let code = text.charCodeAt(index);

		if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
			const low = text.charCodeAt(index + 1);
			if (low >= 0xdc00 && low <= 0xdfff) {
				code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
				index += 1;
			}
		}

		if (code < 0x80) {
			bytes.push(code);
		} else if (code < 0x800) {
			bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
		} else if (code < 0x10000) {
			bytes.push(
				0xe0 | (code >> 12),
				0x80 | ((code >> 6) & 0x3f),
				0x80 | (code & 0x3f),
			);
		} else {
			bytes.push(
				0xf0 | (code >> 18),
				0x80 | ((code >> 12) & 0x3f),
				0x80 | ((code >> 6) & 0x3f),
				0x80 | (code & 0x3f),
			);
		}
	}

	return new Uint8Array(bytes);
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function utf8Decode(bytes) {
	let output = "";
	let index = 0;

	while (index < bytes.length) {
		const first = bytes[index];
		index += 1;

		if (first < 0x80) {
			output += String.fromCharCode(first);
		} else if (first >= 0xc0 && first < 0xe0) {
			output += String.fromCharCode(
				((first & 0x1f) << 6) | (bytes[index] & 0x3f),
			);
			index += 1;
		} else if (first >= 0xe0 && first < 0xf0) {
			output += String.fromCharCode(
				((first & 0x0f) << 12) |
					((bytes[index] & 0x3f) << 6) |
					(bytes[index + 1] & 0x3f),
			);
			index += 2;
		} else if (first >= 0xf0) {
			let codePoint =
				((first & 0x07) << 18) |
				((bytes[index] & 0x3f) << 12) |
				((bytes[index + 1] & 0x3f) << 6) |
				(bytes[index + 2] & 0x3f);
			index += 3;
			codePoint -= 0x10000;
			output += String.fromCharCode(
				0xd800 + (codePoint >> 10),
				0xdc00 + (codePoint & 0x3ff),
			);
		} else {
			output += String.fromCharCode(first);
		}
	}

	return output;
}
