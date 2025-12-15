export const GRID_SIZE = 6;
export const MIN_WORD_LENGTH = 3;
export const MAX_WORD_LENGTH = 10;

// Comic book color palette - Updated to avoid clash with status highlights (Red/Green/Orange)
export const TILE_COLORS = [
  'PINK',   // pink-500
  'BLUE',   // blue-500
  'TEAL',   // teal-600
  'PURPLE', // purple-500
  'INDIGO', // indigo-500
];

export const WILD_COLOR = 'GOLD';

// Weighted distribution similar to Scrabble
// E:12, A:9, I:9, O:8, N:6, R:6, T:6, L:4, S:4, U:4
// D:4, G:3, B:2, C:2, M:2, P:2, F:2, H:2, V:2, W:2, Y:2
// K:1, J:1, X:1, Q:1, Z:1
export const LETTER_POOL = 
  "EEEEEEEEEEEEAAAAAAAAAIIIIIIIIIOOOOOOOONNNNNNRRRRRRTTTTTTLLLLSSSSUUUUDDDDGGGBBCCMMPPFFHHVVWWYYKJXQZ";

export const SCORES: Record<number, number> = {
  3: 10,
  4: 20,
  5: 40,
  6: 80,
  7: 150,
  8: 300,
  9: 500,
  10: 1000
};

// URL for a comprehensive English word list (approx 4MB, filtered client-side)
export const DICTIONARY_URL = "https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt";