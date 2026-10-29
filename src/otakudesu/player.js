import { resolveEmbeddedVideo } from "../shared/player.js";
import { OTAKUDESU } from "./config.js";

/**
 * OtakuDesu wraps the shared iframe resolver so the provider keeps its
 * original call signature.
 *
 * @param {string} embedUrl
 * @param {{ http: ReturnType<import('../shared/http.js').createHttpClient>, log: ReturnType<import('../shared/log.js').createLogger> }} options
 * @returns {Promise<{ url: string, referer: string, subtitles: any[] }|null>}
 */
export function resolveVideo(embedUrl, { http, log }) {
	return resolveEmbeddedVideo(embedUrl, {
		http,
		log,
		referer: `${OTAKUDESU.baseUrl}/`,
	});
}
