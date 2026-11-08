// Edit this file to implement your bidding and word-forming strategy.

// Standard Scrabble letter values — useful for valuation.
export const LETTER_VALUE: Record<string, number> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};

export interface BidContext {
  letter: string;        // Letter being auctioned, e.g. "Q"
  myBalance: number;     // Current balance
  myRack: Map<string, number>; // Letters you currently own, letter -> count
  lettersLeft?: number;  // Letters still in the bag (auctions after this one)
  dictionary?: string[]; // When given, bids follow the words the rack is near
}

const VOWELS = new Set(["A", "E", "I", "O", "U"]);

// What a first copy of each letter is worth paying. Live Vickrey prices are
// about 10 at the median and 14 at the 75th percentile, and the strongest
// bots buy 14-23 letters a match, so bids have to reach that range to win.
const BASE_BID: Record<string, number> = {
  A: 13, B: 12, C: 14, D: 14, E: 14, F: 13, G: 12, H: 15, I: 12, J: 12,
  K: 14, L: 12, M: 14, N: 13, O: 12, P: 14, Q: 12, R: 14, S: 16, T: 13,
  U: 9, V: 10, W: 12, X: 20, Y: 14, Z: 18,
};

export interface StrategyParams {
  // Bidding. A letter's generic price is `usability × (bidBase + bidPerPoint
  // × letter value)`: in a long word every letter point is worth up to 3, so
  // high-value letters are worth far more than common ones. When `bidPerPoint`
  // is negative the old flat table (`BASE_BID`) is used instead.
  bidBase: number;
  bidPerPoint: number;
  // Bidding. A letter's value is a generic per-letter price (`BASE_BID`,
  // scaled by `tableWeight`) plus, when the dictionary is given, how much
  // closer it brings the rack to its best reachable word (`potentialWeight`
  // money per point of expected reward).
  tableWeight: number;
  potentialWeight: number;
  potentialChance: number; // Chance of later winning each missing letter
  maxMissing: number; // Words needing more letters than this are ignored
  // Matches are ranked on score alone; balance left at the end is worthless.
  // So the bot paces itself to spend everything, counting on word income to
  // fund part of it.
  incomePerAuction: number;
  winShare: number;
  typicalPrice: number;
  paceMin: number;
  paceMax: number;
  capShare: number; // Most of the balance one letter may take before the endgame
  endgameLetters: number; // From here on, spread the whole balance over the rest
  // Word play: when to cash in instead of holding letters for a longer word.
  earlyMinLength: number;
  earlyMinReward: number;
  fiveLetterBy: number; // Play 5-letter words once this few letters remain
  anyWordBy: number; // Play any word once this few letters remain
  cashShort: number; // Play short words when the balance falls below this
}

export const DEFAULT_PARAMS: StrategyParams = {
  bidBase: 6,
  bidPerPoint: 3,
  tableWeight: 1,
  potentialWeight: 0,
  potentialChance: 0.35,
  maxMissing: 3,
  incomePerAuction: 1.5,
  winShare: 0.25,
  typicalPrice: 12,
  paceMin: 0.7,
  paceMax: 1.8,
  capShare: 0.5,
  endgameLetters: 16,
  earlyMinLength: 8,
  earlyMinReward: 40,
  fiveLetterBy: 2,
  anyWordBy: 2,
  cashShort: 8,
};

// How readily a letter fits into words, relative to an average letter.
const USABILITY: Record<string, number> = {
  A: 1, B: 0.9, C: 0.95, D: 1, E: 1.05, F: 0.85, G: 0.9, H: 0.95, I: 0.95,
  J: 0.7, K: 0.8, L: 1, M: 0.95, N: 1, O: 0.95, P: 0.95, Q: 0.55, R: 1.05,
  S: 1.15, T: 1, U: 0.75, V: 0.75, W: 0.85, X: 0.85, Y: 0.9, Z: 0.8,
};

const DEFAULT_LETTERS_LEFT = 40;

function letterPrice(letter: string, params: StrategyParams): number {
  if (params.bidPerPoint < 0) return BASE_BID[letter] ?? 0;
  const value = LETTER_VALUE[letter];
  if (!value) return 0;
  return USABILITY[letter]! * (params.bidBase + params.bidPerPoint * value);
}

/**
 * Bid what a letter is worth to this rack, paced so the balance is spent
 * by the time the bag runs out.
 */
export function decideBid(
  ctx: BidContext,
  params: StrategyParams = DEFAULT_PARAMS,
): number {
  const letter = ctx.letter.toUpperCase();
  const base = letterPrice(letter, params);
  const balance = Math.floor(ctx.myBalance);
  if (!base || !Number.isFinite(balance) || balance <= 0) return 0;
  const left = Math.max(0, ctx.lettersLeft ?? DEFAULT_LETTERS_LEFT);
  // The match ends as the last auction closes, before its letter can be
  // played, so the last letter is worth nothing to anyone.
  if (ctx.lettersLeft !== undefined && left === 0) return 0;

  let tiles = 0;
  let vowels = 0;
  for (const [l, n] of ctx.myRack) {
    tiles += n;
    if (VOWELS.has(l)) vowels += n;
  }
  const have = ctx.myRack.get(letter) ?? 0;
  const isVowel = VOWELS.has(letter);

  const duplicateFactors =
    isVowel || letter === "S" ? [1, 0.85, 0.55, 0.25] : [1, 0.7, 0.35, 0.1];
  const duplicateFactor = duplicateFactors[Math.min(have, 3)]!;

  const vowelShare = tiles > 0 ? vowels / tiles : 0.4;
  let mixFactor = 1;
  if (isVowel) {
    if (vowelShare < 0.3) mixFactor = 1.25;
    else if (vowelShare > 0.5) mixFactor = 0.6;
  } else if (vowelShare > 0.5) {
    mixFactor = 1.15;
  } else if (vowelShare < 0.25 && tiles >= 4) {
    mixFactor = 0.75;
  }

  let tableValue = base * duplicateFactor * mixFactor;
  if (letter === "Q") tableValue *= (ctx.myRack.get("U") ?? 0) > 0 ? 1.1 : 0.5;

  let value = tableValue * params.tableWeight;
  if (ctx.dictionary && params.potentialWeight > 0) {
    value +=
      params.potentialWeight *
      potentialGain(ctx.myRack, letter, ctx.dictionary, left, params);
  }

  const auctionsLeft = left + 1;
  const spendable = balance + auctionsLeft * params.incomePerAuction;
  const perWin = spendable / Math.max(1, auctionsLeft * params.winShare);
  const pace = Math.min(
    params.paceMax,
    Math.max(params.paceMin, perWin / params.typicalPrice),
  );
  let bid = Math.round(value * pace);

  // Before the endgame, never sink most of the balance into one letter.
  // In it, money left over will be worth nothing, so spread it over what's
  // left: letters the bot can't use still cost its rivals the letter.
  let cap = Math.max(1, Math.floor(balance * params.capShare));
  if (left <= params.endgameLetters) {
    cap = balance;
    bid = Math.max(bid, Math.floor(balance / Math.max(1, left)));
  }
  return Math.max(0, Math.min(bid, cap, balance));
}

interface WordIndex {
  codes: Uint8Array; // Every word's letters as 0-25, back to back
  starts: Uint32Array; // Word i is codes[starts[i]..starts[i + 1])
  rewards: Float64Array;
  count: number;
}

// Racks rarely get past this many letters, and longer words would make
// every valuation slower.
const MAX_POTENTIAL_LENGTH = 10;
const wordIndexes = new WeakMap<string[], WordIndex>();

function wordIndex(dictionary: string[]): WordIndex {
  const cached = wordIndexes.get(dictionary);
  if (cached) return cached;
  const words = dictionary.filter(
    (w) => w.length >= 2 && w.length <= MAX_POTENTIAL_LENGTH && /^[A-Z]+$/.test(w),
  );
  const starts = new Uint32Array(words.length + 1);
  let total = 0;
  for (let i = 0; i < words.length; i++) {
    starts[i] = total;
    total += words[i]!.length;
  }
  starts[words.length] = total;
  const codes = new Uint8Array(total);
  const rewards = new Float64Array(words.length);
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    for (let j = 0; j < w.length; j++) codes[starts[i]! + j] = w.charCodeAt(j) - 65;
    rewards[i] = wordReward(w);
  }
  const index = { codes, starts, rewards, count: words.length };
  wordIndexes.set(dictionary, index);
  return index;
}

/**
 * How much `letter` raises the rack's best reachable word: each word is
 * worth its reward, discounted by the chance of winning the letters it
 * still needs.
 */
export function potentialGain(
  rack: Map<string, number>,
  letter: string,
  dictionary: string[],
  lettersLeft: number,
  params: Pick<StrategyParams, "potentialChance" | "maxMissing">,
): number {
  const index = wordIndex(dictionary);
  const have = new Int16Array(26);
  for (const [l, n] of rack) {
    const c = l.charCodeAt(0) - 65;
    if (c >= 0 && c < 26 && n > 0) have[c] += n;
  }
  const target = letter.charCodeAt(0) - 65;
  const maxMissing = params.maxMissing;
  const chance =
    params.potentialChance * Math.min(1, Math.max(0.2, lettersLeft / 30));
  const weight = new Float64Array(maxMissing + 1);
  for (let m = 0; m <= maxMissing; m++) {
    weight[m] = m > lettersLeft ? 0 : chance ** m;
  }

  const used = new Int16Array(26);
  const { codes, starts, rewards } = index;
  let before = 0;
  let after = 0;
  for (let w = 0; w < index.count; w++) {
    const s = starts[w]!;
    const e = starts[w + 1]!;
    let missing = 0;
    let missingTarget = 0;
    let k = s;
    for (; k < e; k++) {
      const c = codes[k]!;
      if (used[c]! < have[c]!) {
        used[c]!++;
      } else {
        missing++;
        if (c === target) missingTarget++;
        if (missing > maxMissing + 1) break;
      }
    }
    for (let j = s; j < k && j < e; j++) used[codes[j]!] = 0;
    if (missing > maxMissing + 1) continue;
    const reward = rewards[w]!;
    if (missing <= maxMissing) {
      const v = reward * weight[missing]!;
      if (v > before) before = v;
    }
    const withLetter = missingTarget > 0 ? missing - 1 : missing;
    if (withLetter <= maxMissing) {
      const v = reward * weight[withLetter]!;
      if (v > after) after = v;
    }
  }
  return Math.max(0, after - before);
}

export interface PlayContext {
  word: string;
  lettersLeft?: number; // Letters still in the bag
  myBalance?: number;
}

/**
 * Whether to cash in `word` now. Long words pay up to 3x, so hold letters
 * for them while the match has time, and play whatever spells a word before
 * the bag runs out: letters still held at the end score nothing.
 */
export function shouldPlayWord(
  ctx: PlayContext,
  params: StrategyParams = DEFAULT_PARAMS,
): boolean {
  const left = ctx.lettersLeft;
  if (left === undefined) return true;
  const length = ctx.word.length;
  const balance = ctx.myBalance ?? Number.POSITIVE_INFINITY;
  if (left <= params.anyWordBy) return true;
  if (length >= params.earlyMinLength) return true;
  if (wordReward(ctx.word) >= params.earlyMinReward) return true;
  if (length >= 5 && left <= params.fiveLetterBy) return true;
  return balance < params.cashShort;
}

export interface PlaysContext extends WordContext {
  lettersLeft?: number;
  myBalance?: number;
}

/**
 * Every word to play now, best first, each spelled from what the earlier
 * ones leave. Submitting them together matters at the end of a match, when
 * there may be one or two auctions left to empty the rack.
 */
export function choosePlays(
  ctx: PlaysContext,
  params: StrategyParams = DEFAULT_PARAMS,
): string[] {
  const rack = new Map(ctx.myRack);
  let balance = ctx.myBalance;
  const plays: string[] = [];
  while (plays.length < 6) {
    const word = bestWordMatching(
      { myRack: rack, dictionary: ctx.dictionary },
      (candidate) =>
        shouldPlayWord(
          { word: candidate, lettersLeft: ctx.lettersLeft, myBalance: balance },
          params,
        ),
    );
    if (!word) break;
    plays.push(word);
    for (const c of word) rack.set(c, (rack.get(c) ?? 0) - 1);
    if (balance !== undefined) balance += wordReward(word);
  }
  return plays;
}

export interface WordContext {
  myRack: Map<string, number>;
  dictionary: string[]; // Sorted uppercase list, shared at startup
}

/**
 * Try to form a word using letters from `myRack`.
 * Return the word (uppercase) to play, or null to skip.
 *
 * Select the playable word with the highest immediate game reward.
 *
 * Keep this fast. The bot runs it on every rack change, and while it runs
 * the bot can't see the match move on: a search that takes longer than an
 * auction means bids on closed auctions and words from spent letters.
 */
export function chooseWord(ctx: WordContext): string | null {
  return bestWordMatching(ctx, () => true);
}

function bestWordMatching(
  ctx: WordContext,
  accept: (word: string) => boolean,
): string | null {
  const available = new Int16Array(26);
  let tiles = 0;
  for (const [letter, count] of ctx.myRack) {
    const index = letter.charCodeAt(0) - 65;
    if (index < 0 || index >= 26 || count <= 0) continue;
    available[index] += count;
    tiles += count;
  }

  let bestWord: string | null = null;
  let bestReward = -1;
  for (const word of ctx.dictionary) {
    if (
      word.length < 2 ||
      word.length > tiles ||
      !canSpell(word, available) ||
      !accept(word)
    ) {
      continue;
    }

    const reward = wordReward(word);
    if (
      reward > bestReward ||
      (reward === bestReward && word.length > (bestWord?.length ?? 0))
    ) {
      bestWord = word;
      bestReward = reward;
    }
  }
  return bestWord;
}

export function wordReward(word: string): number {
  let baseScore = 0;
  for (const letter of word) {
    baseScore += LETTER_VALUE[letter] ?? 0;
  }

  switch (word.length) {
    case 4:
      return Math.floor((baseScore * 3) / 2);
    case 5:
      return baseScore * 2;
    case 6:
      return Math.floor((baseScore * 5) / 2);
    default:
      return word.length >= 7 ? baseScore * 3 : baseScore;
  }
}

// Temporarily consume letters and restore them so each dictionary candidate
// is checked against the original rack without allocating per candidate.
function canSpell(word: string, available: Int16Array): boolean {
  let used = 0;
  for (; used < word.length; used++) {
    const index = word.charCodeAt(used) - 65;
    if (index < 0 || index >= 26 || available[index] === 0) break;
    available[index]--;
  }
  for (let i = 0; i < used; i++) {
    available[word.charCodeAt(i) - 65]++;
  }
  return used === word.length;
}
