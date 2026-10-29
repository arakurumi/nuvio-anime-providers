import { loadHtml } from "../shared/dom.js";
import {
	episodeNumberFromText,
	episodeNumberFromUrl,
} from "../shared/episodes.js";
import { absoluteUrl } from "../shared/media.js";
import { cleanText, toPositiveInt } from "../shared/text.js";
import { ANICHIN } from "./config.js";

const AD_SERVER = /\[(?:ads|setting dns)\]/i;

/**
 * Site client for Anichin (donghua with Indonesian subtitles).
 *
 * @param {object} options
 * @param {ReturnType<import('../shared/http.js').createHttpClient>} options.http
 * @param {ReturnType<import('../shared/log.js').createLogger>} options.log
 */
export function createAnichinClient({ http, log }) {
	const baseUrl = ANICHIN.baseUrl;
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
		let cards = $("div.listupd article.bs");
		if (!cards.length) cards = $("article.bs");

		const results = [];
		const seen = {};

		cards.each((_index, element) => {
			const item = $(element);
			const card = item.find(".bsx a[title]").first();
			const heading = item.find("h4 a").first();
			const series = item.find("a.series").first();
			const link = card.length ? card : heading.length ? heading : series;
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
	 * Anichin stores every mirror as a base64 encoded iframe in the `mirror`
	 * select. ok.ru is the first option and the most reliable source.
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
			const absolute = absoluteUrl(String(url).trim(), baseUrl);
			if (!absolute || seen[absolute]) return;

			seen[absolute] = true;
			candidates.push({ label: cleanText(label) || "Server", url: absolute });
		}

		$("select.mirror option").each((_index, element) => {
			const option = $(element);
			const encoded = cleanText(option.attr("value"));
			if (!encoded) return;

			const label = cleanText(option.text());
			if (AD_SERVER.test(label)) return;

			try {
				const decoded = atob(String(encoded).replace(/\s+/g, ""));
				const match = decoded.match(/src=["']([^"']+)/i);
				if (match) add(match[1], label);
			} catch (_error) {
				log.debug(`Could not decode the ${label} server.`);
			}
		});

		$("iframe").each((_index, element) => {
			add($(element).attr("src"), "Player");
		});

		// ok.ru first, then the remaining mirrors.
		candidates.sort((a, b) => {
			const left = /ok\.ru/i.test(a.url) ? 0 : 1;
			const right = /ok\.ru/i.test(b.url) ? 0 : 1;
			return left - right;
		});

		log.debug(`${episodeUrl} exposes ${candidates.length} player(s).`);
		return candidates;
	}

	return { getCandidates, getEpisodes, search };
}
