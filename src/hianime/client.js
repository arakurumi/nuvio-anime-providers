import { loadHtml } from '../shared/dom.js';
import { cleanText } from '../shared/text.js';
import { HIANIME } from './config.js';

/**
 * Extracts the site's numeric anime id and slug from a result link.
 * Handles both `/watch/slug-123` and `/slug-123`.
 *
 * @param {string} href
 * @returns {{ slug: string, id: string }|null}
 */
function parseAnimeHref(href) {
  const path = String(href || '')
    .replace(/^https?:\/\/[^/]+/i, '')
    .split('?')[0]
    .split('#')[0];

  const match = path.match(/\/(?:watch\/)?([^/]+?)-(\d+)\/?$/);
  if (!match) return null;
  return { slug: match[1], id: match[2] };
}

/**
 * @param {Array<{ name: string, type: string, url: string }>} servers
 * @returns {Array<{ name: string, type: string, url: string }>}
 */
function sortServers(servers) {
  const preference = {};
  HIANIME.preferredServers.forEach((name, index) => {
    preference[name] = index;
  });

  return servers.slice().sort((a, b) => {
    if (a.type !== b.type) return a.type === 'sub' ? -1 : 1;
    const left = preference[a.name] === undefined ? 99 : preference[a.name];
    const right = preference[b.name] === undefined ? 99 : preference[b.name];
    return left - right;
  });
}

/**
 * Site client for HiAnime. Search uses the public search page; episode lists
 * and server lists use the same JSON endpoints the website's player calls.
 *
 * @param {object} options
 * @param {ReturnType<import('../shared/http.js').createHttpClient>} options.http
 * @param {ReturnType<import('../shared/log.js').createLogger>} options.log
 */
export function createHianimeClient({ http, log }) {
  const baseUrl = HIANIME.baseUrl;
  const siteReferer = `${baseUrl}/`;

  /**
   * @param {string} query
   * @returns {Promise<Array<{ title: string, jname: string, id: string, slug: string, pageUrl: string }>>}
   */
  async function search(query) {
    const html = await http.text(`${baseUrl}/search?keyword=${encodeURIComponent(query)}`, {
      headers: { Referer: siteReferer },
    });
    if (!html) return [];

    const $ = loadHtml(html);
    const results = [];

    $('.flw-item').each(function (index, element) {
      const item = $(element);
      const link = item.find('.film-name a').first();
      if (!link || !link.length) return;

      const info = parseAnimeHref(link.attr('href'));
      if (!info) return;

      const title = cleanText(link.attr('title') || link.text());
      if (!title) return;

      results.push({
        title,
        jname: cleanText(link.attr('data-jname')),
        id: info.id,
        slug: info.slug,
        pageUrl: `${baseUrl}/watch/${info.slug}-${info.id}`,
      });
    });

    log.debug(`Search "${query}" returned ${results.length} result(s).`);
    return results;
  }

  /**
   * @param {{ id: string, pageUrl: string }} anime
   * @returns {Promise<{ byNumber: Record<number, string>, total: number }|null>}
   */
  async function getEpisodes(anime) {
    const data = await http.json(`${baseUrl}/api/theme/episode/list/${anime.id}`, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Referer: anime.pageUrl,
      },
    });

    if (!data || !data.html) {
      log.warn(`Episode list is unavailable for anime ${anime.id}.`);
      return null;
    }

    const $ = loadHtml(data.html);
    const byNumber = {};
    let total = 0;

    $('.ep-item').each(function (index, element) {
      const item = $(element);
      const episodeId = cleanText(item.attr('data-id'));
      const number = Number.parseInt(item.attr('data-number'), 10);

      if (!episodeId || !(number > 0) || byNumber[number]) return;
      byNumber[number] = episodeId;
      total += 1;
    });

    log.debug(`Anime ${anime.id} exposes ${total} episode(s).`);
    return { byNumber, total };
  }

  /**
   * @param {string} episodeId
   * @returns {Promise<Array<{ name: string, type: string, url: string }>>}
   */
  async function getServers(episodeId) {
    const data = await http.json(
      `${baseUrl}/api/theme/episode/servers?episodeId=${encodeURIComponent(episodeId)}`,
      {
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Referer: siteReferer,
        },
      }
    );

    if (!data || !data.html) {
      log.warn(`Server list is unavailable for episode ${episodeId}.`);
      return [];
    }

    const $ = loadHtml(data.html);
    const servers = [];
    const seen = {};

    $('.server-item').each(function (index, element) {
      const item = $(element);
      const hash = item.attr('data-hash');
      if (!hash) return;

      let url = null;
      try {
        url = atob(hash);
      } catch (error) {
        url = null;
      }
      if (!url || !/^https?:\/\//i.test(url)) return;

      const type = (item.attr('data-type') || 'sub').toLowerCase();
      const name = cleanText(item.attr('data-server-name') || 'Server');
      const key = `${url}|${type}`;
      if (seen[key]) return;

      seen[key] = true;
      servers.push({ name, type, url });
    });

    return sortServers(servers);
  }

  return { search, getEpisodes, getServers };
}
