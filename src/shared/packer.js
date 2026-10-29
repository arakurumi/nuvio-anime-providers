/**
 * Dean Edwards packer unpacker used by vidhide (odvidhide.com).
 *
 * The packed markup looks like:
 *   eval(function(p,a,c,k,e,d){...}('PACKED',36,607,'WORDS'.split('|'),0,{}))
 *
 * This implementation only performs string replacement; it never calls eval().
 */

/**
 * @param {string} source
 * @param {number} position
 * @returns {{ value: string, end: number }|null}
 */
function readJsString(source, position) {
  const quote = source.charAt(position);
  if (quote !== "'" && quote !== '"') return null;

  let index = position + 1;
  let value = '';

  while (index < source.length) {
    const char = source.charAt(index);

    if (char === '\\') {
      const next = source.charAt(index + 1);

      if (next === 'x') {
        value += String.fromCharCode(Number.parseInt(source.substr(index + 2, 2), 16));
        index += 4;
        continue;
      }
      if (next === 'u') {
        value += String.fromCharCode(Number.parseInt(source.substr(index + 2, 4), 16));
        index += 6;
        continue;
      }

      const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
      value += escapes[next] !== undefined ? escapes[next] : next;
      index += 2;
      continue;
    }

    if (char === quote) return { value, end: index + 1 };
    value += char;
    index += 1;
  }

  return null;
}

/**
 * @param {string} source
 * @param {number} position
 * @returns {{ value: number, end: number }|null}
 */
function readInt(source, position) {
  const match = source.slice(position).match(/^\s*(\d+)/);
  if (!match) return null;
  return { value: Number.parseInt(match[1], 10), end: position + match[0].length };
}

/**
 * @param {string} source
 * @param {string} token
 * @param {string} replacement
 * @returns {string}
 */
function replaceToken(source, token, replacement) {
  try {
    return source.replace(new RegExp(`\\b${token}\\b`, 'g'), replacement);
  } catch (error) {
    return source;
  }
}

/**
 * @param {unknown} input
 * @returns {string}
 */
export function unpackPacker(input) {
  const source = String(input || '');
  const marker = source.indexOf('eval(function(p,a,c,k,e,d)');
  if (marker === -1) return source;

  const call = source.indexOf('}(', marker);
  if (call === -1) return source;

  let position = call + 2;

  const payload = readJsString(source, position);
  if (!payload) return source;
  position = payload.end;

  while (position < source.length && /[\s,]/.test(source.charAt(position))) position += 1;
  const radix = readInt(source, position);
  if (!radix) return source;
  position = radix.end;

  while (position < source.length && /[\s,]/.test(source.charAt(position))) position += 1;
  const count = readInt(source, position);
  if (!count) return source;
  position = count.end;

  while (position < source.length && /[\s,]/.test(source.charAt(position))) position += 1;
  const words = readJsString(source, position);
  if (!words) return source;

  const tokens = words.value.split('|');
  let result = payload.value;

  for (let index = count.value - 1; index >= 0; index -= 1) {
    if (!tokens[index]) continue;
    result = replaceToken(result, index.toString(radix.value), tokens[index]);
  }

  return result;
}
