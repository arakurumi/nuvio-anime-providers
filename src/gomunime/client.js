import { loadHtml } from '../shared/dom.js';
import { episodeNumberFromUrl } from '../shared/episodes.js';
import { absoluteUrl, originOf } from '../shared/media.js';
import { cleanText } from '../shared/text.js';
import { GOMUNIME } from './config.js';

const AD_HOST = /googleads|doubleclick|googletagmanager|googlesyndication|facebook|twitter|disqus|histats|analytics/i;

/**
 * @param {string} url
 * @returns {number}
 */
function rank(url) {
  if (/blogger\.com|video\.g\?token/i.test(url)) return 0;
  if (/mp4upload/i.test(url)) return 1;
  if (/yourupload|yup\.php/i.test(url)) return 2;
  if (/gdriveplayer|xtwap|gdplayer/i.test(url)) return 3;
  return 4;
}

/**
 * Site client for Gomunime.
 *
 * @param {object} options
 * @param {ReturnType<import('../shared/http.js').createHttpClient>} options.http
 * @param {ReturnType<import('../shared/log.js').createLogger>} options.log
 */
export function createGomunimeClient({ http, log }) {
  const baseUrl = GOMUNIME.baseUrl;
  const siteReferer = `${baseUrl}/`;

  /**
   * @param {string} query
   * @returns {Promise<Array<{ title: string, url: string }>>}
   */
  async function search(query) {
    const html = await http.text(`${baseUrl}/search?q=${encodeURIComponent(query)}`, {
      headers: { Referer: siteReferer },
    });
    if (!html) return [];

    const $ = loadHtml(html);
    const results = [];
    const seen = {};

    $('a.card-netflix').each(function (index, element) {
      const link = $(element);
      const url = absoluteUrl(link.attr('href'), baseUrl);
      if (!url || seen[url]) return;

      const title = cleanText(link.find('img').attr('alt') || link.text());
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
    const html = await http.text(animeUrl, { headers: { Referer: siteReferer } });
    if (!html) return [];

    const $ = loadHtml(html);
    const baseHref = String(animeUrl).replace(/[?#].*$/, '').replace(/\/+$/, '');
    const prefix = `${baseHref}-episode-`;
    const entries = [];
    const seen = {};

    $('a[href]').each(function (index, element) {
      const link = $(element);
      const url = absoluteUrl(link.attr('href'), baseUrl);
      if (!url || url.indexOf(prefix) !== 0 || seen[url]) return;

      const number = episodeNumberFromUrl(url);
      if (!number) return;

      seen[url] = true;
      entries.push({ number, url, title: cleanText(link.text()) });
    });

    entries.sort((left, right) => left.number - right.number);
    log.debug(`${animeUrl} exposes ${entries.length} episode(s).`);
    return entries;
  }

  /**
   * @param {string} pageUrl
   * @returns {Promise<Array<{ label: string, url: string }>>}
   */
  async function getCandidates(pageUrl) {
    const html = await http.text(pageUrl, { headers: { Referer: siteReferer } });
    if (!html) return [];

    const $ = loadHtml(html);
    const candidates = [];
    const seen = {};

    $('iframe').each(function (index, element) {
      const src = $(element).attr('src');
      if (!src) return;

      const url = absoluteUrl(src, baseUrl);
      if (!url || AD_HOST.test(url) || seen[url]) return;

      seen[url] = true;
      candidates.push({ label: originOf(url).replace(/^https?:\/\//i, ''), url });
    });

    candidates.sort((left, right) => rank(left.url) - rank(right.url));
    log.debug(`${pageUrl} exposes ${candidates.length} player(s).`);
    return candidates;
  }

  return { search, getEpisodes, getCandidates };
}
