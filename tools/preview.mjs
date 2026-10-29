import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cheerio = require('cheerio');

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const positional = args.filter((value) => value !== '--json');
const [providerName, contentId, mediaType = 'tv', seasonArg, episodeArg] = positional;

const PROVIDERS = [
  'hianime',
  'otakudesu',
  'oploverz',
  'anoboy',
  'anichin',
  'gomunime',
  'gogoanimes',
];

if (!providerName || !contentId) {
  console.error(`Usage: npm run preview -- <${PROVIDERS.join('|')}> <content-id> [movie|tv] [season] [episode]`);
  console.error('Example: npm run preview -- hianime 95479 tv 1 1');
  process.exit(1);
}

const code = await readFile(new URL(`../providers/${providerName}.js`, import.meta.url), 'utf8');

const season = seasonArg === undefined || seasonArg === 'null' ? null : Number(seasonArg);
const episode = episodeArg === undefined || episodeArg === 'null' ? null : Number(episodeArg);

const sandbox = {
  fetch,
  cheerio,
  atob,
  btoa,
  console,
  setTimeout,
  clearTimeout,
  URL,
  TextEncoder,
  TextDecoder,
};

// Nuvio wraps the bundle like this and reads module.exports.getStreams.
const pluginModule = { exports: {} };
sandbox.module = pluginModule;
sandbox.exports = pluginModule.exports;

// Nuvio injects its own key; set TMDB_API_KEY in the environment to mirror it.
if (process.env.TMDB_API_KEY) sandbox.TMDB_API_KEY = process.env.TMDB_API_KEY;

vm.createContext(sandbox);
vm.runInContext(`(function () {\n${code}\n})();`, sandbox, { filename: `${providerName}.js` });

const getStreams = pluginModule.exports.getStreams || sandbox.getStreams;

if (typeof getStreams !== 'function') {
  console.error('Provider did not export getStreams.');
  process.exit(1);
}

const started = Date.now();
const streams = await getStreams(contentId, mediaType, season, episode);

console.log(`\n${providerName}: ${streams.length} stream(s) in ${Date.now() - started}ms`);
for (const stream of streams) {
  console.log(`- ${stream.quality} | ${stream.type} | ${stream.title}`);
  console.log(`  ${String(stream.url).slice(0, 110)}`);
}

if (jsonOutput) console.log(JSON.stringify(streams, null, 2));
