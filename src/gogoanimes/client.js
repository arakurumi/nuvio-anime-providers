import { loadHtml } from '../shared/dom.js';
import { episodeNumberFromUrl } from '../shared/episodes.js';
import { absoluteUrl } from '../shared/media.js';
import { cleanText, toPositiveInt } from '../shared/text.js';
import { GOGOANIMES } from './config.js';

/**
 * Site client for GogoAnimes.
 *
 * The anime page loads its episode list through the site's own WordPress
 * AJAX action (`load_episode_range`). Search and playback pages are public
 * HTML pages.
 *
 * @param {object} options
 * @param {ReturnType<import('../shared/http.js').createHttpClient>} options.http
 * @param {ReturnType<import('../shared/log.js').createLogger>} options.log
 */
export function createGogoanimesClient({ http, log }) {
  const baseUrl = GOGOANIMES.baseUrl;
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

    $('div.last_episodes ul.items li').each(function (index, element) {
      const item = $(element);
      const link = item.find('p.name a').first();
      if (!link || !link.length) return;

      const href = link.attr('href') || '';
      if (href.indexOf('/anime/') === -1) return;

      const url = absoluteUrl(href, baseUrl);
      if (!url || seen[url]) return;

      const title = cleanText(link.attr('title') || link.text());
      if (!title) return;

      seen[url] = true;
      results.push({ title, url });
    });

    log.debug(`Search "${query}" returned ${results.length} result(s).`);
    return results;
  }

  /**
   * @param {string} animeUrl
   * @param {number} episode
   * @returns {Promise<{ number: number, url: string }|null>}
   */
  async function getEpisode(animeUrl, episode) {
    const html = await http.text(animeUrl, { headers: { Referer: siteReferer } });
    if (!html) return null;

    const $ = loadHtml(html);
    const ranges = [];

    $('#episode_page a').each(function (index, element) {
      const item = $(element);
      const start = Number.parseInt(item.attr('data-range-start'), 10);
      const end = Number.parseInt(item.attr('data-range-end'), 10);
      const seriId = cleanText(item.attr('data-seri'));

      if (Number.isFinite(start) && Number.isFinite(end) && seriId) {
        ranges.push({ start, end, seriId });
      }
    });

    const nonceMatch = html.match(/nonce\s*:\s*['"]([a-zA-Z0-9]+)['"]/);
    const nonce = nonceMatch ? nonceMatch[1] : '';
    const range = ranges.find((item) => episode >= item.start && episode <= item.end) || ranges[0];

    if (range && nonce) {
      const body =
        'action=load_episode_range' +
        `&range_start=${encodeURIComponent(range.start)}` +
        `&range_end=${encodeURIComponent(range.end)}` +
        `&seri_id=${encodeURIComponent(range.seriId)}` +
        `&nonce=${encodeURIComponent(nonce)}`;

      const data = await http.json(`${baseUrl}/wp-admin/admin-ajax.php`, {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: animeUrl,
        },
      });

      const payload = data && data.success && typeof data.data === 'string' ? data.data : '';

      if (payload) {
        const $$ = loadHtml(payload);
        let found = null;

        $$('a[href]').each(function (index, element) {
          if (found) return;

          const url = absoluteUrl($$(element).attr('href'), baseUrl);
          if (!url) return;

          const number = episodeNumberFromUrl(url);
          if (number === episode) found = { number, url };
        });

        if (found) {
          log.debug(`AJAX episode list resolved episode ${episode}.`);
          return found;
        }
      }
    }

    // Fallback: episode urls follow `/{series-slug}-episode-{n}/`.
    const slugMatch = String(animeUrl).match(/\/anime\/([^/?#]+)/i);
    const slug = slugMatch ? slugMatch[1] : '';
    if (!slug) return null;

    log.debug(`Falling back to the constructed episode url for episode ${episode}.`);
    return { number: episode, url: `${baseUrl}/${slug}-episode-${episode}/` };
  }

  /**
   * @param {string} episodeUrl
   * @returns {Promise<Array<{ label: string, url: string }>>}
   */
  async function getCandidates(episodeUrl) {
    const html = await http.text(episodeUrl, { headers: { Referer: siteReferer } });
    if (!html) return [];

    const $ = loadHtml(html);
    const candidates = [];
    const seen = {};

    function add(url, label) {
      if (!url) return;
      const decoded = String(url).replace(/&amp;/g, '&').trim();
      if (!decoded) return;

      const absolute = absoluteUrl(decoded, baseUrl);
      if (!absolute || seen[absolute]) return;

      seen[absolute] = true;
      candidates.push({ label: cleanText(label) || 'Server', url: absolute });
    }

    $('.anime_muti_link a').each(function (index, element) {
      const item = $(element);
      const video = item.attr('data-video');
      if (!video) return;

      const match = String(video).match(/src=["']([^"']+)/i);
      const label = cleanText(item.text()).replace(/choose this server/i, '');
      add(match ? match[1] : video, label);
    });

    $('#pembed iframe').each(function (index, element) {
      add($(element).attr('src'), 'Player');
    });

    log.debug(`${episodeUrl} exposes ${candidates.length} player(s).`);
    return candidates;
  }

  return { search, getEpisode, getCandidates };
}
