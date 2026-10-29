import { absoluteUrl, isHttpUrl, originOf } from "../shared/media.js";
import { HIANIME } from "./config.js";

const DECODE_KEY = "otaku-embed-v1";
const PAYLOAD_PATTERN = /window\.__P\s*=\s*["']([^"']+)["']/;

/**
 * Decodes a byte string (each charCode is one byte) into UTF-8 text.
 *
 * @param {string} input
 * @returns {string}
 */
export function decodeUtf8(input) {
	let output = "";
	let index = 0;

	while (index < input.length) {
		const first = input.charCodeAt(index) & 0xff;
		index += 1;

		if (first < 0x80) {
			output += String.fromCharCode(first);
		} else if (first >= 0xc0 && first < 0xe0) {
			output += String.fromCharCode(
				((first & 0x1f) << 6) | (input.charCodeAt(index) & 0x3f),
			);
			index += 1;
		} else if (first >= 0xe0 && first < 0xf0) {
			output += String.fromCharCode(
				((first & 0x0f) << 12) |
					((input.charCodeAt(index) & 0x3f) << 6) |
					(input.charCodeAt(index + 1) & 0x3f),
			);
			index += 2;
		} else if (first >= 0xf0 && first < 0xf8) {
			let codePoint =
				((first & 0x07) << 18) |
				((input.charCodeAt(index) & 0x3f) << 12) |
				((input.charCodeAt(index + 1) & 0x3f) << 6) |
				(input.charCodeAt(index + 2) & 0x3f);
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

/**
 * The ZokoAnime player embeds its configuration as base64(XOR(json)).
 *
 * @param {string} encoded
 * @returns {any|null}
 */
export function deobfuscate(encoded) {
	try {
		const raw = atob(encoded);
		let xored = "";

		for (let index = 0; index < raw.length; index += 1) {
			xored += String.fromCharCode(
				raw.charCodeAt(index) ^
					DECODE_KEY.charCodeAt(index % DECODE_KEY.length),
			);
		}

		const json = decodeUtf8(xored);
		try {
			return JSON.parse(json);
		} catch (_error) {
			return JSON.parse(xored);
		}
	} catch (_error) {
		return null;
	}
}

/**
 * @param {any} config
 * @returns {string|null}
 */
function pickSource(config) {
	if (!config) return null;

	let source = config.src;
	if (!source && Array.isArray(config.sources) && config.sources.length) {
		const first = config.sources[0];
		source = first && (first.file || first.url);
	}
	if (!source && config.file) source = config.file;
	if (!source || typeof source !== "string") return null;

	const normalized = absoluteUrl(source, HIANIME.embedBaseUrl);
	return isHttpUrl(normalized) ? normalized : null;
}

/**
 * @param {any[]} entries
 * @param {string} origin
 * @returns {Array<{ url: string, language: string, name: string, headers: Record<string, string> }>}
 */
function mapSubtitles(entries, origin) {
	const subtitles = [];
	if (!Array.isArray(entries)) return subtitles;

	for (const entry of entries) {
		if (!entry?.src) continue;

		const url = absoluteUrl(entry.src, origin);
		if (!isHttpUrl(url)) continue;

		subtitles.push({
			headers: {
				Origin: origin,
				Referer: `${origin}/`,
				"User-Agent": HIANIME.userAgent,
			},
			language: String(entry.lang || "und").toLowerCase(),
			name: entry.label || entry.lang || "Subtitle",
			url,
		});
	}

	return subtitles;
}

/**
 * Opens a site player embed and returns the HLS url + subtitles.
 *
 * @param {string} embedUrl
 * @param {{ http: ReturnType<import('../shared/http.js').createHttpClient>, log: ReturnType<import('../shared/log.js').createLogger> }} options
 * @returns {Promise<{ url: string, origin: string, subtitles: any[] }|null>}
 */
export async function resolveEmbed(embedUrl, { http, log }) {
	const siteOrigin = HIANIME.baseUrl;
	const html = await http.text(embedUrl, {
		headers: { Origin: siteOrigin, Referer: `${siteOrigin}/` },
	});

	if (!html) return null;

	const payload = html.match(PAYLOAD_PATTERN);
	if (!payload) {
		log.debug(`No player payload at ${embedUrl}`);
		return null;
	}

	const config = deobfuscate(payload[1]);
	const source = pickSource(config);
	if (!source) {
		log.debug(`Player payload has no stream url at ${embedUrl}`);
		return null;
	}

	const origin = originOf(embedUrl);
	return {
		origin,
		subtitles: mapSubtitles(config ? config.subtitles : null, origin),
		url: source,
	};
}
