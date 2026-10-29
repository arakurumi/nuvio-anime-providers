import { loadHtml } from "../shared/dom.js";
import {
	episodeNumberFromText,
	episodeNumberFromUrl,
} from "../shared/episodes.js";
import { absoluteUrl } from "../shared/media.js";
import { cleanText, toPositiveInt } from "../shared/text.js";
import { OPLOVERZ } from "./config.js";

/**
 * Recovers the series slug from a `/series/<slug>/` url.
 *
 * @param {string} seriesUrl
 * @returns {string}
 */
export function seriesSlug(seriesUrl) {
	const match = String(seriesUrl || "").match(/\/series\/([^/?#]+)/i);
	return match ? match[1] : "";
}

/**
 * Site client for Oploverz. Search and episode lists are public pages; the
 * episode page exposes the site's own player buttons.
 *
 * @param {object} options
 * @param {ReturnType<import('../shared/http.js').createHttpClient>} options.http
 * @param {ReturnType<import('../shared/log.js').createLogger>} options.log
 */
export function createOploverzClient({ http, log }) {
	const baseUrl = OPLOVERZ.baseUrl;
	const siteReferer = `${baseUrl}/`;

	/**
	 * @param {string} query
	 * @returns {Promise<Array<{ title: string, url: string }>>}
	 */
	async function search(query) {
		const html = await http.text(`${baseUrl}/?s=${encodeURIComponent(query)}`, {
			headers: { Referer: siteReferer },
		});
		if (!html) return [];

		const $ = loadHtml(html);
		const results = [];
		const seen = {};

		$("div.listupd article.bs").each((_index, element) => {
			const item = $(element);
			const link = item.find(".bsx a[title]").first();
			if (!link?.length) return;

			const url = absoluteUrl(link.attr("href"), baseUrl);
			if (!url || seen[url]) return;

			const title = cleanText(link.attr("title") || link.text());
			if (!title) return;

			seen[url] = true;
			results.push({ title, url });
		});

		log.debug(`Search "${query}" returned ${results.length} result(s).`);
		return results;
	}

	/**
	 * @param {string} animeUrl
	 * @returns {Promise<Array<{ number: number, url: string, title: string }>>}
	 */
	async function getEpisodes(animeUrl) {
		const html = await http.text(animeUrl, {
			headers: { Referer: siteReferer },
		});
		if (!html) return [];

		const $ = loadHtml(html);
		const entries = [];
		const seen = {};

		$(".eplister li").each((_index, element) => {
			const item = $(element);
			const link = item.find("a").first();
			if (!link?.length) return;

			const url = absoluteUrl(link.attr("href"), baseUrl);
			if (!url || seen[url]) return;

			const number =
				toPositiveInt(cleanText(item.find(".epl-num").text())) ||
				episodeNumberFromText(link.text()) ||
				episodeNumberFromUrl(url);
			if (!number) return;

			seen[url] = true;
			entries.push({ number, title: cleanText(link.text()), url });
		});

		log.debug(`${animeUrl} exposes ${entries.length} episode(s).`);
		return entries;
	}

	/**
	 * Collects the player candidates of an episode page. Oploverz exposes the
	 * default player in `#pembed` and the alternates as `.dsu-server` buttons.
	 *
	 * @param {string} episodeUrl
	 * @returns {Promise<Array<{ label: string, url: string }>>}
	 */
	async function getCandidates(episodeUrl) {
		const html = await http.text(episodeUrl, {
			headers: { Referer: siteReferer },
		});
		if (!html) return [];

		const $ = loadHtml(html);
		const candidates = [];
		const seen = {};

		function add(url, label) {
			if (!url) return;
			const decoded = String(url).replace(/&amp;/g, "&").trim();
			if (!decoded || decoded.indexOf("url=none") !== -1) return;

			const absolute = absoluteUrl(decoded, baseUrl);
			if (!absolute || seen[absolute]) return;

			seen[absolute] = true;
			candidates.push({ label: cleanText(label) || "Player", url: absolute });
		}

		$("#pembed iframe").each((_index, element) => {
			add($(element).attr("src"), "Player");
		});

		$(".dsu-server").each((_index, element) => {
			const item = $(element);
			const label = item.attr("data-label") || "Server";
			add(item.attr("data-url"), label);

			const embedded = item.attr("data-embed");
			if (embedded) {
				try {
					const decoded = atob(String(embedded).replace(/\s+/g, ""));
					const match = decoded.match(/src=["']([^"']+)/i);
					if (match) add(match[1], label);
				} catch (_error) {
					log.debug(`Could not decode ${label} embed.`);
				}
			}
		});

		log.debug(`${episodeUrl} exposes ${candidates.length} player(s).`);
		return candidates;
	}

	return { getCandidates, getEpisodes, search };
}
