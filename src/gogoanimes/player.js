import {
	aesCbcDecrypt,
	decodeBase64,
	padBytes,
	utf8Decode,
} from "../shared/aes.js";
import { absoluteUrl } from "../shared/media.js";
import { GOGOANIMES } from "./config.js";

const MEGA_ORIGIN = "https://megaplay.buzz";

// MegaPlay ships these as defaults in `newclient.min.js`. They are the
// player's own values, not a third-party API key.
const MEGA_KEY = "i?LMTAx0Q6,:}50U";
const MEGA_IV = "W0;27ToaUpl_P%'c";

/**
 * Resolves a MegaPlay embed (directly or through the site's streaming page).
 *
 * Flow: streaming page -> MegaPlay page -> `data-mediaid` -> getSources.
 * The response carries an intentionally encrypted `enc` field and the
 * subtitle tracks. `enc` is AES-256-CBC with the player's defaults.
 *
 * @param {string} embedUrl
 * @param {{ http: ReturnType<import('../shared/http.js').createHttpClient>, log: ReturnType<import('../shared/log.js').createLogger> }} options
 * @returns {Promise<{ url: string, referer: string, origin: string, subtitles: any[] }|null>}
 */
export async function resolveMegaplay(embedUrl, { http, log }) {
	const siteReferer = `${GOGOANIMES.baseUrl}/`;
	let page = await http.text(embedUrl, { headers: { Referer: siteReferer } });
	if (!page) return null;

	let megaUrl = embedUrl;

	if (!/megaplay\.buzz/i.test(megaUrl)) {
		const iframe = page.match(
			/<iframe[^>]+src=["']([^"']*megaplay[^"']*)["']/i,
		);
		const direct = page.match(
			/https?:\/\/[^"'\s]+megaplay\.buzz\/stream\/[^"'\s]+/i,
		);
		const target = iframe ? iframe[1] : direct ? direct[0] : "";

		if (!target) {
			log.warn(`No MegaPlay player found at ${embedUrl}`);
			return null;
		}

		megaUrl = absoluteUrl(target.replace(/&amp;/g, "&"), embedUrl);
		page = await http.text(megaUrl, { headers: { Referer: embedUrl } });
		if (!page) return null;
	}

	const idMatch = page.match(/data-mediaid=["'](\d+)["']/i);
	const mediaId = idMatch ? idMatch[1] : "";

	if (!mediaId) {
		log.warn("MegaPlay page has no media id.");
		return null;
	}

	const data = await http.json(
		`${MEGA_ORIGIN}/stream/getSources?id=${encodeURIComponent(mediaId)}`,
		{
			headers: {
				Accept: "application/json",
				Referer: megaUrl,
				"X-Requested-With": "XMLHttpRequest",
			},
		},
	);

	if (!data?.enc) {
		log.warn(`MegaPlay sources are unavailable for ${mediaId}.`);
		return null;
	}

	let payload = null;

	try {
		const decrypted = aesCbcDecrypt(
			decodeBase64(data.enc),
			padBytes(MEGA_KEY, 32),
			padBytes(MEGA_IV, 16),
		);
		payload = JSON.parse(utf8Decode(decrypted));
	} catch (error) {
		log.warn(
			`MegaPlay payload could not be decrypted: ${error?.message ? error.message : error}`,
		);
		return null;
	}

	const firstSource =
		payload && Array.isArray(payload.sources) && payload.sources.length
			? payload.sources[0]
			: null;
	const file =
		payload?.file ||
		(firstSource && (firstSource.file || firstSource.url)) ||
		"";

	if (!file) {
		log.warn("MegaPlay payload has no stream url.");
		return null;
	}

	const subtitles = (Array.isArray(data.tracks) ? data.tracks : [])
		.filter((track) => track && track.kind === "captions" && track.file)
		.map((track) => ({
			headers: {
				Referer: `${MEGA_ORIGIN}/`,
				"User-Agent": GOGOANIMES.userAgent,
			},
			language: "en",
			name: track.label || "English",
			url: track.file,
		}));

	return {
		origin: MEGA_ORIGIN,
		referer: MEGA_ORIGIN,
		subtitles,
		url: file,
	};
}
