import {
	canonicalSeason,
	cleanCandidate,
	cleanText,
	normalize,
} from "./text.js";

/**
 * Scores how well a site result matches a title candidate.
 *
 * @param {string} candidate Title shown by the site.
 * @param {string} query Title candidate resolved from the content id.
 * @param {number|null} season Requested season (null for movies).
 * @returns {number} 0 when unrelated; higher is better.
 */
export function scoreTitle(candidate, query, season) {
	const c = canonicalSeason(normalize(cleanCandidate(candidate)));
	const q = canonicalSeason(normalize(query));
	if (!c || !q) return 0;

	let score = 0;
	if (c === q) {
		score = 100;
	} else if (c.indexOf(q) === 0) {
		score = 70 - Math.min(20, (c.length - q.length) / 4);
	} else if (q.indexOf(c) === 0) {
		score = 65;
	} else {
		const queryTokens = q.split(" ");
		const candidateTokens = c.split(" ");
		const tokens = {};
		for (const token of candidateTokens) tokens[token] = true;

		let hits = 0;
		for (const token of queryTokens) if (tokens[token]) hits += 1;

		const ratio = hits / Math.max(1, queryTokens.length);
		if (ratio >= 0.6) score = Math.round(ratio * 55);
	}

	if (!score) return 0;

	const seasonMatch =
		c.match(/(?:season|part)\s*(\d+)/) || c.match(/\bs(\d+)\b/);
	if (seasonMatch) {
		const candidateSeason = Number.parseInt(seasonMatch[1], 10);
		if (season && candidateSeason !== season) score -= 30;
		else score += 10;
	} else if (season && season > 1) {
		// A result without a season marker for an S2+ request is suspicious,
		// but it may still be the only entry for long-running shows.
		score -= 30;
	}

	return Math.max(0, score);
}

/**
 * Runs the site searches in priority order and returns the best match.
 *
 * @param {object} options
 * @param {string[]} options.titles Candidate titles, best first.
 * @param {number|null} options.season
 * @param {number} [options.maxQueries]
 * @param {(query: string) => Promise<Array<{ title: string, jname?: string }>>} options.search
 * @param {ReturnType<import('./log.js').createLogger>} [options.log]
 * @returns {Promise<{ item: any, score: number }|null>}
 */
export async function findBestMatch({
	titles,
	season,
	maxQueries = 4,
	search,
	log,
}) {
	const queries = [];
	const seen = {};

	for (const title of titles) {
		const value = cleanText(title);
		if (!value) continue;

		const key = normalize(value);
		if (!key || seen[key]) continue;

		seen[key] = true;
		queries.push(value);
		if (queries.length >= maxQueries) break;
	}

	let best = null;

	for (let index = 0; index < queries.length; index += 1) {
		const results = await search(queries[index]);

		for (const result of results) {
			const score = Math.max(
				scoreTitle(result.title, queries[index], season),
				result.jname ? scoreTitle(result.jname, queries[index], season) : 0,
			);

			if (score > 0 && (!best || score > best.score)) {
				best = { item: result, score };
			}
		}

		if (best && best.score >= 90) break;
		if (index >= 1 && best && best.score >= 75) break;
	}

	if (log && best) {
		log.debug(
			`Matched "${best.item.title}" with score ${best.score.toFixed(2)}`,
		);
	}

	return best && best.score >= 55 ? best : null;
}
