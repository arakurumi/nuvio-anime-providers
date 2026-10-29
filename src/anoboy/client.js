import { loadHtml } from "../shared/dom.js";
import {
	episodeNumberFromText,
	episodeNumberFromUrl,
} from "../shared/episodes.js";
import { absoluteUrl } from "../shared/media.js";
import { cleanText, normalize } from "../shared/text.js";
import { ANOBOY } from "./config.js";

const EPISODE_TITLE = /\bepisode\s*\d+/i;
const NON_EPISODE =
	/\b(?:sampai|batch|download|movie|spesial|special|filler|single\s+link)\b/i;

/**
 * Site client for Anoboy.
 *
 * Episode posts are per-episode WordPress posts with date based urls, while
 * series pages list their newest episodes. The site's own WordPress REST API
 * is used to resolve a title to its series page without crawling the large
 * anime list.
 *
 * @param {object} options
 * @param {ReturnType<import('../shared/http.js').createHttpClient>} options.http
 * @param {ReturnType<import('../shared/log.js').createLogger>} options.log
 */
export function createAnoboyClient({ http, log }) {
	const baseUrl = ANOBOY.baseUrl;
	const siteReferer = `${baseUrl}/`;
	const apiBase = `${baseUrl}/wp-json/wp/v2`;

	/**
	 * @param {string} query
	 * @returns {Promise<Array<{ title: string, url: string }>>}
	 */
	async function search(query) {
		// Series pages are created before their episodes, so ordering by date
		// ascending keeps the series page inside the result window even when
		// relevance would rank recent episode posts first.
		const data = await http.json(
			`${apiBase}/posts?search=${encodeURIComponent(query)}&per_page=100&orderby=date&order=asc&_fields=link,title`,
		);
		if (!Array.isArray(data) || !data.length) {
			log.debug(`WordPress search for "${query}" returned nothing.`);
			return [];
		}

		const results = [];
		const seen = {};

		for (const post of data) {
			const title = cleanText(post?.title?.rendered);
			const url = post?.link ? String(post.link) : "";
			if (!title || !url || seen[url]) continue;

			// Keep series pages only; episode posts cannot provide an episode list.
			if (EPISODE_TITLE.test(title)) continue;

			seen[url] = true;
			results.push({ title, url });
		}

		log.debug(
			`Search "${query}" returned ${results.length} series candidate(s).`,
		);
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

		$("ul.lcp_catlist li a").each((_index, element) => {
			const link = $(element);
			const title = cleanText(link.text());
			const url = absoluteUrl(link.attr("href"), baseUrl);
			if (!title || !url || seen[url]) return;

			// Batch/special/download posts also live in this list.
			if (NON_EPISODE.test(title)) return;

			const number = episodeNumberFromText(title) || episodeNumberFromUrl(url);
			if (!number) return;

			seen[url] = true;
			entries.push({ number, title, url });
		});

		log.debug(`${animeUrl} exposes ${entries.length} episode(s).`);
		return entries;
	}

	/**
	 * Finds a single episode post through the WordPress REST API. Used when the
	 * series page does not list the requested (older) episode.
	 *
	 * @param {string} animeTitle
	 * @param {number} episode
	 * @returns {Promise<{ number: number, url: string, title: string }|null>}
	 */
	async function findEpisode(animeTitle, episode) {
		const query = `${animeTitle} episode ${episode}`;
		const data = await http.json(
			`${apiBase}/posts?search=${encodeURIComponent(query)}&per_page=100&_fields=link,title`,
		);
		if (!Array.isArray(data) || !data.length) return null;

		const wanted = normalize(`${animeTitle} episode ${episode}`);

		for (const post of data) {
			const title = cleanText(post?.title?.rendered);
			const url = post?.link ? String(post.link) : "";
			if (!title || !url) continue;

			const candidate = normalize(title);
			if (candidate === wanted || candidate.indexOf(wanted) === 0) {
				return { number: episode, title, url };
			}
		}

		return null;
	}

	/**
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
			candidates.push({ label: cleanText(label) || "Mirror", url: absolute });
		}

		$("a#allmiror").each((_index, element) => {
			const item = $(element);
			add(item.attr("data-video"), item.text() || "Mirror");
		});

		add($("#mediaplayer").attr("src"), "Player");

		log.debug(`${episodeUrl} exposes ${candidates.length} player(s).`);
		return candidates;
	}

	return { findEpisode, getCandidates, getEpisodes, search };
}
