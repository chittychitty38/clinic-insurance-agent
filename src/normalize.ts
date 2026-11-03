/**
 * Turning speech into identifiers. Everything a caller says arrives as a speech-to-text
 * transcript, so "A-E-T-N-A nine W C S U", "double five" and "July 14th, 2001" all have
 * to become the exact strings a payer expects.
 */

export function normalizeText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitFullName(full: string): { first: string; last: string } {
  const cleaned = full.includes(',')
    ? full.split(',').reverse().join(' ') // "Doe, Jane" -> "Jane Doe"
    : full;
  const parts = normalizeText(cleaned).split(' ').filter(Boolean);
  return { first: parts[0] ?? '', last: parts.length > 1 ? parts[parts.length - 1]! : '' };
}

const NICKNAMES: Record<string, string[]> = {
  james: ['jim', 'jimmy', 'jamie'],
  john: ['jon', 'johnny', 'jack'],
  richard: ['rich', 'rick', 'ricky', 'dick'],
  rich: ['richard', 'rick', 'ricky'],
  david: ['dave', 'davey'],
  rod: ['rodney', 'roderick'],
  frank: ['francis', 'franklin', 'frankie'],
  casey: ['kasey', 'kc'],
  jane: ['janie'],
  jordan: ['jordy'],
  rolando: ['roland', 'orlando'],
};

export function firstNamesMatch(a: string, b: string): boolean {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (x === y) return true;
  return (NICKNAMES[x] ?? []).includes(y) || (NICKNAMES[y] ?? []).includes(x);
}

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/** Speech-to-text often mangles surnames ("Arrojo" -> "Arroyo"). Allow one edit, two for long names. */
export function lastNamesClose(a: string, b: string): boolean {
  const x = normalizeText(a).replace(/ /g, '');
  const y = normalizeText(b).replace(/ /g, '');
  if (x === y) return true;
  const budget = Math.max(x.length, y.length) >= 7 ? 2 : 1;
  return levenshtein(x, y) <= budget;
}

const DIGIT_WORDS: Record<string, string> = {
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', for: '4', five: '5',
  six: '6', seven: '7', eight: '8', ate: '8', nine: '9', niner: '9',
};

const NATO: Record<string, string> = {
  alpha: 'A', alfa: 'A', bravo: 'B', charlie: 'C', delta: 'D', echo: 'E', foxtrot: 'F', golf: 'G',
  hotel: 'H', india: 'I', juliet: 'J', juliett: 'J', kilo: 'K', lima: 'L', mike: 'M', november: 'N',
  oscar: 'O', papa: 'P', quebec: 'Q', romeo: 'R', sierra: 'S', tango: 'T', uniform: 'U',
  victor: 'V', whiskey: 'W', xray: 'X', yankee: 'Y', zulu: 'Z',
};

const TEENS: Record<string, string> = {
  ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15',
  sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19',
};
const TENS: Record<string, string> = {
  twenty: '2', thirty: '3', forty: '4', fifty: '5', sixty: '6', seventy: '7', eighty: '8', ninety: '9',
};

/**
 * "U H C inactive" -> "UHCINACTIVE", "one A A two C C" -> "1AA2CC",
 * "W as in William" -> "W", "double five" -> "55", "forty two" -> "42".
 */
export function memberIdFromSpeech(spoken: string): string {
  const tokens = spoken
    .replace(/\bas in\s+\w+/gi, ' ')
    .replace(/[-–—_.,/#:]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  // Only treat "Oscar", "Delta"... as phonetic letters when the caller is clearly spelling
  // phonetically. Otherwise "OSCAR123456" (a real Oscar Health ID) would become "O123456".
  const phonetic = tokens.filter((t) => NATO[t]).length >= 2;

  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if ((t === 'double' || t === 'triple') && tokens[i + 1]) {
      const next = convertToken(tokens[++i]!, phonetic);
      out += next.repeat(t === 'double' ? 2 : 3);
      continue;
    }
    if (TENS[t]) {
      const unit = tokens[i + 1] && DIGIT_WORDS[tokens[i + 1]!] && tokens[i + 1] !== 'zero' && tokens[i + 1] !== 'oh';
      out += TENS[t] + (unit ? DIGIT_WORDS[tokens[++i]!] : '0');
      continue;
    }
    out += convertToken(t, phonetic);
  }
  return out;
}

function convertToken(t: string, phonetic: boolean): string {
  if (DIGIT_WORDS[t]) return DIGIT_WORDS[t]!;
  if (TEENS[t]) return TEENS[t]!;
  if (phonetic && NATO[t]) return NATO[t]!;
  return t.replace(/[^a-z0-9]/g, '').toUpperCase();
}

/** Compare member IDs the way a human would read them: ignore case, separators, and O/0 confusion. */
export function memberIdKey(id: string): string {
  return id.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0');
}

export function memberIdsMatch(spoken: string, onFile: string): boolean {
  return memberIdKey(memberIdFromSpeech(spoken)) === memberIdKey(onFile);
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Accepts 2001-07-14, 07/14/2001, 7-14-2001, "July 14th 2001", "14 July 2001". Returns YYYY-MM-DD or null. */
export function parseDateOfBirth(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ');
  let y: number | undefined, m: number | undefined, d: number | undefined;

  let match = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];

  match ??= null;
  if (y === undefined && (match = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) {
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  if (y === undefined && /^\d{8}$/.test(s)) {
    [y, m, d] = [Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8))];
  }
  if (y === undefined) {
    const words = s.split(/\s+/);
    const monthIdx = words.findIndex((w) => MONTHS.some((name) => name.startsWith(w) && w.length >= 3));
    const nums = words.filter((w) => /^\d+$/.test(w)).map(Number);
    if (monthIdx >= 0 && nums.length >= 2) {
      m = MONTHS.findIndex((name) => name.startsWith(words[monthIdx]!)) + 1;
      y = nums.find((n) => n > 31);
      d = nums.find((n) => n <= 31);
    }
  }
  if (!y || !m || !d) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (y < 1900 || date.getTime() > Date.now()) return null;
  return date.toISOString().slice(0, 10);
}

/** "$35.00" -> "35 dollars", "12.5" -> "12 dollars and 50 cents". TTS engines read this reliably. */
export function spokenDollars(amount: number): string {
  const dollars = Math.floor(amount);
  const cents = Math.round((amount - dollars) * 100);
  const d = `${dollars.toLocaleString('en-US')} dollar${dollars === 1 ? '' : 's'}`;
  return cents ? `${d} and ${cents} cents` : d;
}

export function spokenPercent(fraction: number): string {
  const pct = Math.round(fraction * 1000) / 10;
  return `${pct} percent`;
}

export function spokenDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]!.replace(/^./, (c) => c.toUpperCase())} ${d}, ${y}`;
}
