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

// Matches are ranked on score alone; balance left at the end is worthless.
// So the bot paces itself to spend everything, counting on word income
// (strong bots earn about 1.5-2 per auction) to fund part of it.
const EXPECTED_INCOME_PER_AUCTION = 1.5;
const EXPECTED_WIN_SHARE = 0.25;
const TYPICAL_PRICE = 12;
const DEFAULT_LETTERS_LEFT = 40;
const ENDGAME_LETTERS = 8;

/**
 * Bid what a letter is worth to this rack, paced so the balance is spent
 * by the time the bag runs out.
 */
export function decideBid(ctx: BidContext): number {
  const letter = ctx.letter.toUpperCase();
  const base = BASE_BID[letter];
  const balance = Math.floor(ctx.myBalance);
  if (!base || !Number.isFinite(balance) || balance <= 0) return 0;

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

  let value = base * duplicateFactor * mixFactor;
  if (letter === "Q") value *= (ctx.myRack.get("U") ?? 0) > 0 ? 1.1 : 0.5;

  const left = Math.max(0, ctx.lettersLeft ?? DEFAULT_LETTERS_LEFT);
  const auctionsLeft = left + 1;
  const spendable = balance + auctionsLeft * EXPECTED_INCOME_PER_AUCTION;
  const perWin = spendable / Math.max(1, auctionsLeft * EXPECTED_WIN_SHARE);
  const pace = Math.min(1.8, Math.max(0.7, perWin / TYPICAL_PRICE));

  // Before the endgame, never sink most of the balance into one letter.
  const cap =
    left <= ENDGAME_LETTERS ? balance : Math.max(1, Math.floor(balance * 0.4));
  return Math.max(0, Math.min(Math.round(value * pace), cap, balance));
}

export interface PlayContext {
  word: string;
  lettersLeft?: number; // Letters still in the bag
  myBalance?: number;
}

/**
 * Whether to cash in `word` now. Words of 6+ letters pay 2.5-3x, so hold
 * letters for them while the match has time, and play whatever spells a
 * word before the bag runs out: letters still held at the end score nothing.
 */
export function shouldPlayWord(ctx: PlayContext): boolean {
  const left = ctx.lettersLeft;
  if (left === undefined) return true;
  const length = ctx.word.length;
  const balance = ctx.myBalance ?? Number.POSITIVE_INFINITY;
  if (left <= 5) return true;
  if (length >= 6 || wordReward(ctx.word) >= 24) return true;
  if (length === 5) return left <= 20 || balance < 15;
  return left <= 10 || balance < 8;
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
    if (word.length < 2 || word.length > tiles || !canSpell(word, available)) {
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

function wordReward(word: string): number {
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
