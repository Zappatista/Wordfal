export interface Coordinate {
  r: number;
  c: number;
}

export enum TileStatus {
  IDLE = 'IDLE',
  SELECTED = 'SELECTED',
  VALID = 'VALID',
  REJECT = 'REJECT',   // New: Red highlight for invalid prefixes
  INVALID = 'INVALID', // Red + Shake for invalid submission
  MATCHED = 'MATCHED',
  EXPLODED = 'EXPLODED',
}

export interface TileData {
  id: string;
  letter: string;
  status: TileStatus;
  key: number;
  color: string;
  isNew: boolean;
  isBlocked: boolean;
  isBomb: boolean;
}

export enum GameMode {
  CASUAL = 'CASUAL',
  TIMED = 'TIMED',
}

export enum Difficulty {
  EASY = 'EASY',
  NORMAL = 'NORMAL',
  HARD = 'HARD',
}

export enum Screen {
  MENU = 'MENU',
  GAME = 'GAME',
  GAMEOVER = 'GAMEOVER',
  LEVEL_UP = 'LEVEL_UP',
  LEADERBOARD = 'LEADERBOARD',
}

export interface GameState {
  score: number;
  wordCount: number;
  bestWord: string;
  lastScoreAdded: number | null;
  // Timed Mode specific
  level: number;
  timeLeft: number;
  targetScore: number;
  // Difficulty Streaks
  streakShort: number;
  streakLong: number;
}

export interface FlyingTile {
  id: string;
  letter: string;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  color: string;
}

export interface HighScoreEntry {
  score: number;
  bestWord: string;
  date: number;
  level?: number;
}