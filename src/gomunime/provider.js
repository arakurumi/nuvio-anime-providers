import { pickEpisode } from "../shared/episodes.js";
import { createHttpClient } from "../shared/http.js";
import { createLogger } from "../shared/log.js";
import { collectStreams } from "../shared/playback.js";
import { findBestMatch } from "../shared/selection.js";
import { toPositiveInt } from "../shared/text.js";
import { resolveTitles } from "../shared/tmdb.js";
import { createGomunimeClient } from "./client.js";
import { GOMUNIME } from "./config.js";

/**
 * Gomunime provider entry point.
 *
 * Site data comes from gomunime.top and the players the site embeds.
 *
 * @param {string} contentId
 * @param {string} mediaType
 * @param {number|null} season
 * @param {number|null} episode
 * @returns {Promise<Array<Record<string, any>>>}
 */
export async function getStreams(contentId, mediaType, season, episode) {
	const log = createLogger(GOMUNIME.label);
	const http = createHttpClient({
		budgetMs: GOMUNIME.budgetMs,
		log,
		startedAt: Date.now(),
		userAgent: GOMUNIME.userAgent,
	});
	const client = createGomunimeClient({ http, log });

	const type = mediaType === "movie" ? "movie" : "tv";
	const seasonNumber = toPositiveInt(season);
	const episodeNumber = toPositiveInt(episode) || 1;

	log.info(
		`Request id=${contentId} type=${type} season=${seasonNumber} episode=${episodeNumber}`,
	);

	const meta = await resolveTitles({
		contentId,
		http,
		locale: GOMUNIME.locale,
		log,
		mediaType: type,
		season: seasonNumber,
	});

	if (!meta.titles.length) {
		log.warn("No title candidates available; cannot search the site.");
		return [];
	}

	const match = await findBestMatch({
		log,
		maxQueries: 5,
		search: client.search,
		season: seasonNumber,
		titles: meta.titles,
	});

	if (!match) {
		log.warn("No matching series found on Gomunime.");
		return [];
	}

	const episodes = await client.getEpisodes(match.item.url);
	const picked = pickEpisode(
		episodes,
		episodeNumber,
		seasonNumber,
		meta.seasonCounts,
	);

	const baseHref = match.item.url.replace(/[?#].*$/, "").replace(/\/+$/, "");
	let pageUrl = picked ? picked.url : `${baseHref}-episode-${episodeNumber}`;
	const resolvedNumber = picked ? picked.number : episodeNumber;

	let candidates = await client.getCandidates(pageUrl);

	// Movies and specials sometimes play on the series page itself.
	if (!candidates.length && pageUrl !== match.item.url) {
		pageUrl = match.item.url;
		candidates = await client.getCandidates(pageUrl);
	}

	if (!candidates.length) {
		log.warn(`No players returned for episode ${resolvedNumber}.`);
		return [];
	}

	const label = type === "movie" ? "Movie" : `Episode ${resolvedNumber}`;

	return collectStreams(candidates, {
		http,
		language: "id",
		log,
		maxStreams: 2,
		mp4Quality: "360p",
		name: GOMUNIME.label,
		providerId: GOMUNIME.providerId,
		siteReferer: `${GOMUNIME.baseUrl}/`,
		title: (candidate) => `${match.item.title} • ${label} • ${candidate.label}`,
		userAgent: GOMUNIME.userAgent,
	});
}
