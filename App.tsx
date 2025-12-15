import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TileData, TileStatus, Coordinate, GameState, FlyingTile, GameMode, Screen, HighScoreEntry, Difficulty } from './types';
import { GRID_SIZE, LETTER_POOL, SCORES, DICTIONARY_URL, MIN_WORD_LENGTH, MAX_WORD_LENGTH, TILE_COLORS, WILD_COLOR } from './constants';

// --- Sound Engine ---
let audioCtx: AudioContext | null = null;

const getAudioCtx = () => {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioCtx;
};

const playTone = (freq: number, type: OscillatorType, duration: number, delay = 0) => {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
    
    gain.gain.setValueAtTime(0.1, ctx.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + duration);
};

const playSound = (type: 'success' | 'error' | 'bonus' | 'gameover' | 'tick' | 'gold' | 'explode' | 'levelup' | 'highscore') => {
    try {
        const ctx = getAudioCtx();
        if (ctx.state === 'suspended') ctx.resume();

        if (type === 'success') {
            playTone(523.25, 'sine', 0.2, 0);   // C5
            playTone(659.25, 'sine', 0.2, 0.1); // E5
            playTone(783.99, 'sine', 0.3, 0.2); // G5
        } else if (type === 'bonus') {
            playTone(523.25, 'sine', 0.1, 0);
            playTone(659.25, 'sine', 0.1, 0.05);
            playTone(783.99, 'sine', 0.1, 0.1);
            playTone(1046.50, 'sine', 0.3, 0.15);
            playTone(1318.51, 'square', 0.1, 0.2);
        } else if (type === 'gold') {
            playTone(880.00, 'sine', 0.1, 0);    // A5
            playTone(1108.73, 'sine', 0.1, 0.05); // C#6
            playTone(1318.51, 'sine', 0.2, 0.1);  // E6
            playTone(1760.00, 'triangle', 0.4, 0.15); // A6
        } else if (type === 'explode') {
            // White noise burst
            const bufferSize = ctx.sampleRate * 0.5; // 0.5 seconds
            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            const noise = ctx.createBufferSource();
            noise.buffer = buffer;
            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(0.5, ctx.currentTime);
            noiseGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
            noise.connect(noiseGain);
            noiseGain.connect(ctx.destination);
            noise.start();
        } else if (type === 'levelup') {
            playTone(440, 'triangle', 0.1, 0);
            playTone(554, 'triangle', 0.1, 0.1);
            playTone(659, 'triangle', 0.1, 0.2);
            playTone(880, 'square', 0.4, 0.3);
            playTone(1108, 'square', 0.6, 0.4);
        } else if (type === 'error') {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(150, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(100, ctx.currentTime + 0.3);
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.3);
        } else if (type === 'gameover') {
             playTone(300, 'sawtooth', 0.5, 0);
             playTone(250, 'sawtooth', 0.5, 0.4);
             playTone(200, 'sawtooth', 1.0, 0.8);
        } else if (type === 'tick') {
             playTone(800, 'square', 0.05, 0);
        } else if (type === 'highscore') {
            // Fanfare
            playTone(523.25, 'triangle', 0.1, 0);
            playTone(523.25, 'triangle', 0.1, 0.1);
            playTone(523.25, 'triangle', 0.1, 0.2);
            playTone(698.46, 'triangle', 0.6, 0.3); // F5
            playTone(523.25, 'triangle', 0.2, 0.7);
            playTone(698.46, 'triangle', 0.8, 0.9);
        }
    } catch (e) {
        console.error("Audio play failed", e);
    }
};

// --- Trie Implementation ---
class TrieNode {
    children: Record<string, TrieNode> = {};
    isEndOfWord: boolean = false;
}

class Trie {
    root: TrieNode = new TrieNode();

    insert(word: string) {
        let node = this.root;
        for (const char of word) {
            if (!node.children[char]) {
                node.children[char] = new TrieNode();
            }
            node = node.children[char];
        }
        node.isEndOfWord = true;
    }

    search(word: string): number {
        let node = this.root;
        for (const char of word) {
            if (!node.children[char]) return 0;
            node = node.children[char];
        }
        return node.isEndOfWord ? 2 : 1;
    }
}

// --- High Score Logic ---
const STORAGE_KEYS = {
  [GameMode.CASUAL]: 'wordfall_casual_scores_v1',
  [GameMode.TIMED]: 'wordfall_timed_scores_v1',
};

const getLeaderboard = (mode: GameMode): HighScoreEntry[] => {
    try {
        const data = localStorage.getItem(STORAGE_KEYS[mode]);
        return data ? JSON.parse(data) : [];
    } catch { return []; }
};

const saveScore = (mode: GameMode, entry: HighScoreEntry): boolean => {
    const scores = getLeaderboard(mode);
    scores.push(entry);
    scores.sort((a, b) => b.score - a.score);
    const topScores = scores.slice(0, 10); // Keep top 10
    localStorage.setItem(STORAGE_KEYS[mode], JSON.stringify(topScores));
    // Check if the specific entry object reference exists in the top scores to determine if it qualified
    return topScores.some(s => s.date === entry.date && s.score === entry.score);
};

// --- Game Logic ---

const getRandomLetter = () => LETTER_POOL[Math.floor(Math.random() * LETTER_POOL.length)];
const generateId = () => Math.random().toString(36).substr(2, 9);

const generateTile = (level: number, mode: GameMode, isNew: boolean = false, forcedType?: 'BLOCKED' | 'BOMB'): TileData => {
    // 0. Check Forced Types
    if (forcedType === 'BLOCKED') {
        return {
            id: generateId(),
            letter: '', // No letter
            status: TileStatus.IDLE,
            key: Math.random(),
            color: 'GRAY',
            isNew: isNew,
            isBlocked: true,
            isBomb: false
        };
    }

    if (forcedType === 'BOMB') {
         return {
            id: generateId(),
            letter: getRandomLetter(),
            status: TileStatus.IDLE,
            key: Math.random(),
            color: 'RAINBOW',
            isNew: isNew,
            isBlocked: false,
            isBomb: true
        };
    }

    // Difficulty calculation for blocked tiles
    let blockedChance = 0;
    
    if (mode === GameMode.TIMED) {
        // Starts at level 1 now. Level 1: 3%. Cap at 25%
        blockedChance = Math.min(0.25, level * 0.03);
    } else {
        // Casual Mode: Scaling difficulty.
        // Starts at 4%. Increases by 1% per level. Cap at 20%.
        blockedChance = Math.min(0.20, 0.04 + (level * 0.01));
    }

    const roll = Math.random();
    
    // 1. Check for Blocked Tile
    if (roll < blockedChance) {
        return {
            id: generateId(),
            letter: '', // No letter
            status: TileStatus.IDLE,
            key: Math.random(),
            color: 'GRAY',
            isNew: isNew,
            isBlocked: true,
            isBomb: false
        };
    }

    // 2. Check for Bomb Tile 
    // Increased probability to 8% to provide more fun and counterplay to blocks
    if (roll < blockedChance + 0.08) {
        return {
            id: generateId(),
            letter: getRandomLetter(),
            status: TileStatus.IDLE,
            key: Math.random(),
            color: 'RAINBOW',
            isNew: isNew,
            isBlocked: false,
            isBomb: true
        };
    }

    // 3. Regular or Wild Tile
    // Increased Wild chance to 8% to make them fall "sometimes"
    const isWild = Math.random() < 0.08;
    const color = isWild ? WILD_COLOR : TILE_COLORS[Math.floor(Math.random() * TILE_COLORS.length)];
    
    return {
        id: generateId(),
        letter: getRandomLetter(),
        status: TileStatus.IDLE,
        key: Math.random(),
        color: color,
        isNew: isNew,
        isBlocked: false,
        isBomb: false
    };
};

const createInitialGrid = (level: number, mode: GameMode): TileData[][] => {
  const grid: TileData[][] = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    const row: TileData[] = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      // Allow special tiles (bombs/blocks) on initial grid
      row.push(generateTile(1, mode, false));
    }
    grid.push(row);
  }
  return grid;
};

const isAdjacent = (c1: Coordinate, c2: Coordinate): boolean => {
  const dr = Math.abs(c1.r - c2.r);
  const dc = Math.abs(c1.c - c2.c);
  return dr <= 1 && dc <= 1 && !(dr === 0 && dc === 0);
};

const getColorClasses = (tile: TileData) => {
    if (tile.status === TileStatus.MATCHED || tile.status === TileStatus.EXPLODED) return "bg-transparent text-transparent border-transparent opacity-0";
    if (tile.status === TileStatus.INVALID) return "bg-red-600 text-white border-red-800 animate-shake";
    
    // New Highlight Logic
    if (tile.status === TileStatus.REJECT) return "bg-red-500 text-white border-red-800";
    if (tile.status === TileStatus.VALID) return "bg-green-500 text-white border-green-800";
    if (tile.status === TileStatus.SELECTED) return "bg-orange-400 text-white border-orange-600";
    
    if (tile.isBlocked) return "blocked-tile";
    if (tile.isBomb) return "bomb-tile";
    if (tile.color === WILD_COLOR) return "gold-tile text-black border-yellow-600";

    switch (tile.color) {
        case 'PINK': return "bg-pink-500 text-white border-pink-800";
        case 'BLUE': return "bg-blue-500 text-white border-blue-800";
        case 'TEAL': return "bg-teal-600 text-white border-teal-800";
        case 'PURPLE': return "bg-purple-500 text-white border-purple-800";
        case 'INDIGO': return "bg-indigo-500 text-white border-indigo-800";
        default: return "bg-gray-200 text-black border-gray-400";
    }
};

const findFirstWord = (grid: TileData[][], trie: Trie): Coordinate[] | null => {
    const rows = grid.length;
    const cols = grid[0].length;
    
    const search = (r: number, c: number, path: Coordinate[], currentStr: string): Coordinate[] | null => {
        if (grid[r][c].isBlocked) return null; // Cannot traverse blocked tiles
        
        const str = currentStr + grid[r][c].letter;
        const lookup = trie.search(str);
        
        if (lookup === 0) return null;
        if (lookup === 2 && str.length >= MIN_WORD_LENGTH) return [...path, {r,c}];
        if (str.length >= 8) return null;

        const neighbors = [
            {r: r-1, c: c-1}, {r: r-1, c}, {r: r-1, c: c+1},
            {r, c: c-1},                 {r, c: c+1},
            {r: r+1, c: c-1}, {r: r+1, c}, {r: r+1, c: c+1}
        ];

        for (const n of neighbors) {
            if (n.r >= 0 && n.r < rows && n.c >= 0 && n.c < cols) {
                if (!path.some(p => p.r === n.r && p.c === n.c)) {
                    const res = search(n.r, n.c, [...path, {r,c}], str);
                    if (res) return res;
                }
            }
        }
        return null;
    };

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const res = search(r, c, [], "");
            if (res) return res;
        }
    }
    return null;
};

// Helpers for timer visuals
const getTimerColor = (time: number) => {
    if (time > 30) return 'bg-green-500';
    if (time > 15) return 'bg-orange-500';
    return 'bg-red-600';
};

const getTimerTextColor = (time: number) => {
    if (time > 30) return 'text-green-600';
    if (time > 15) return 'text-orange-600';
    return 'text-red-600';
};

const getTimerScale = (time: number) => {
    if (time <= 5) return 'scale-125';
    if (time <= 15) return 'scale-110';
    return 'scale-100';
};

export default function App() {
  const [screen, setScreen] = useState<Screen>(Screen.MENU);
  const [mode, setMode] = useState<GameMode>(GameMode.CASUAL);
  const [difficulty, setDifficulty] = useState<Difficulty>(Difficulty.NORMAL);
  
  const [grid, setGrid] = useState<TileData[][]>([]);
  const [selection, setSelection] = useState<Coordinate[]>([]);
  const [gameState, setGameState] = useState<GameState>({
    score: 0,
    wordCount: 0,
    bestWord: '',
    lastScoreAdded: null,
    level: 1,
    timeLeft: 60,
    targetScore: 500,
    streakShort: 0,
    streakLong: 0
  });

  const [animating, setAnimating] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' | 'gold' | '' }>({ text: '', type: '' });
  const [flyingTiles, setFlyingTiles] = useState<FlyingTile[]>([]);
  const [flyingTrigger, setFlyingTrigger] = useState(0); 
  
  const [dictionary, setDictionary] = useState<Set<string>>(new Set());
  const [trie, setTrie] = useState<Trie | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // High Score State
  const [isHighScore, setIsHighScore] = useState(false);
  const [leaderboardTab, setLeaderboardTab] = useState<GameMode>(GameMode.CASUAL);

  // Special Spawn Queue for forced drops
  const specialSpawnQueue = useRef<('BLOCKED' | 'BOMB')[]>([]);

  const gridRef = useRef<HTMLDivElement>(null);
  const scoreRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const loadDictionary = async () => {
      try {
        const response = await fetch(DICTIONARY_URL);
        const text = await response.text();
        const words = text.split(/\r?\n/)
            .map(w => w.trim().toUpperCase())
            .filter(w => w.length >= MIN_WORD_LENGTH && w.length <= MAX_WORD_LENGTH);
        
        const dictSet = new Set(words);
        const newTrie = new Trie();
        words.forEach(w => newTrie.insert(w));

        setDictionary(dictSet);
        setTrie(newTrie);
        setIsLoading(false);
      } catch (error) {
        console.error("Failed to load dictionary", error);
        setFeedback({ text: "Error loading words.", type: 'error' });
        setIsLoading(false);
      }
    };
    loadDictionary();
  }, []);

  // Timer
  useEffect(() => {
    if (screen === Screen.GAME && mode === GameMode.TIMED) {
        timerRef.current = window.setInterval(() => {
            setGameState(prev => {
                if (prev.timeLeft <= 0) {
                    endGame();
                    return prev;
                }
                if (prev.timeLeft <= 5 && prev.timeLeft > 0) playSound('tick');
                return { ...prev, timeLeft: prev.timeLeft - 1 };
            });
        }, 1000);
    }
    return () => {
        if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [screen, mode]);

  // Game Over Check (Casual)
  useEffect(() => {
    if (screen === Screen.GAME && mode === GameMode.CASUAL && !animating && trie) {
        const timer = setTimeout(() => {
             const move = findFirstWord(grid, trie);
             if (!move) endGame();
        }, 800);
        return () => clearTimeout(timer);
    }
  }, [grid, animating, screen, mode, trie]);

  const startGame = (selectedMode: GameMode) => {
      setMode(selectedMode);
      setGrid(createInitialGrid(1, selectedMode));
      setGameState({
          score: 0,
          wordCount: 0,
          bestWord: '',
          lastScoreAdded: null,
          level: 1,
          timeLeft: selectedMode === GameMode.TIMED ? 60 : 0,
          targetScore: 500,
          streakShort: 0,
          streakLong: 0
      });
      specialSpawnQueue.current = [];
      setSelection([]);
      setIsHighScore(false);
      setScreen(Screen.GAME);
      const ctx = getAudioCtx();
      if (ctx.state === 'suspended') ctx.resume();
  };

  const nextLevel = () => {
      setGameState(prev => ({
          ...prev,
          level: prev.level + 1,
          targetScore: Math.floor(prev.targetScore * 1.5) + 500,
          timeLeft: prev.timeLeft + 15 // Bonus time for starting new level
      }));
      setScreen(Screen.GAME);
      playSound('success'); // Simple confirm sound
  };

  const endGame = () => {
      // Save High Score
      const entry: HighScoreEntry = {
          score: gameState.score,
          bestWord: gameState.bestWord,
          date: Date.now(),
          level: mode === GameMode.TIMED ? gameState.level : undefined
      };
      
      const madeLeaderboard = saveScore(mode, entry);
      setIsHighScore(madeLeaderboard);
      
      if (madeLeaderboard) playSound('highscore');
      else playSound('gameover');

      setScreen(Screen.GAMEOVER);
      if (timerRef.current) clearInterval(timerRef.current);
  };

  const showHint = () => {
      if (!trie || animating) return;
      const move = findFirstWord(grid, trie);
      if (move) {
          setFeedback({ text: "Word found!", type: 'success' });
          setSelection(move);
          setGrid(prev => {
             const newGrid = prev.map(row => [...row]);
             move.forEach(({r, c}) => newGrid[r][c].status = TileStatus.SELECTED);
             return newGrid;
          });
      } else {
          setFeedback({ text: "No words found!", type: 'error' });
      }
  };

  // Helper to update selection and calculate status
  const evaluateSelection = (currentSelection: Coordinate[]) => {
      if (!trie) return;
      
      const word = currentSelection.map(s => grid[s.r][s.c].letter).join('');
      let status = TileStatus.REJECT;
      
      if (word.length > 0) {
          const lookup = trie.search(word);
          if (lookup === 2 && word.length >= MIN_WORD_LENGTH) {
              status = TileStatus.VALID;
          } else if (lookup !== 0) {
              status = TileStatus.SELECTED;
          }
      }
      
      setSelection(currentSelection);
      updateTileStatus(currentSelection, status);
  };

  const handleTouchStart = (r: number, c: number) => {
    if (animating || isLoading || screen !== Screen.GAME) return;
    if (grid[r][c].isBlocked) {
        playSound('error');
        return; 
    }
    evaluateSelection([{ r, c }]);
    setFeedback({ text: '', type: '' });
  };

  const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (animating || isLoading || selection.length === 0 || screen !== Screen.GAME) return;

    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      if ((e.buttons & 1) === 0) {
        handleTouchEnd(); 
        return;
      }
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    const element = document.elementFromPoint(clientX, clientY);
    const tileElement = element?.closest('[data-coord]');
    
    if (tileElement) {
      const coordStr = tileElement.getAttribute('data-coord');
      if (coordStr) {
        const [r, c] = coordStr.split(',').map(Number);
        
        // Cannot drag into blocked tiles
        if (grid[r][c].isBlocked) return;

        const last = selection[selection.length - 1];

        // Backtrack detection
        if (selection.length > 1) {
            const secondLast = selection[selection.length - 2];
            if (secondLast.r === r && secondLast.c === c) {
                const newSelection = selection.slice(0, -1);
                evaluateSelection(newSelection);
                return;
            }
        }

        if (!selection.some(s => s.r === r && s.c === c) && isAdjacent(last, { r, c })) {
          const newSelection = [...selection, { r, c }];
          evaluateSelection(newSelection);
        }
      }
    }
  };

  const handleTouchEnd = () => {
    if (animating || isLoading || selection.length === 0 || screen !== Screen.GAME) return;

    const word = selection.map(s => grid[s.r][s.c].letter).join('');
    
    if (word.length >= MIN_WORD_LENGTH && dictionary.has(word)) {
      handleValidWord(word);
    } else {
      handleInvalidWord();
    }
  };

  const updateTileStatus = (coords: Coordinate[], status: TileStatus) => {
    setGrid(prev => {
      const newGrid = prev.map(row => row.map(tile => ({ 
          ...tile, 
          status: tile.status === TileStatus.MATCHED || tile.status === TileStatus.EXPLODED ? tile.status : TileStatus.IDLE 
      })));
      coords.forEach(({ r, c }) => {
        newGrid[r][c].status = status;
      });
      return newGrid;
    });
  };

  const spawnFlyingTiles = (coords: Coordinate[]) => {
      if (!scoreRef.current) return;
      const scoreRect = scoreRef.current.getBoundingClientRect();
      const newFlyers: FlyingTile[] = [];

      coords.forEach(({r, c}) => {
          const tileEl = document.querySelector(`[data-coord="${r},${c}"]`);
          if (tileEl) {
              const rect = tileEl.getBoundingClientRect();
              newFlyers.push({
                  id: grid[r][c].id,
                  letter: grid[r][c].letter,
                  startX: rect.left,
                  startY: rect.top,
                  targetX: scoreRect.left + scoreRect.width / 2 - rect.width / 2,
                  targetY: scoreRect.top + scoreRect.height / 2 - rect.height / 2,
                  color: grid[r][c].color
              });
          }
      });
      setFlyingTiles(newFlyers);
      requestAnimationFrame(() => setFlyingTrigger(prev => prev + 1));
      setTimeout(() => setFlyingTiles([]), 600);
  };

  const handleValidWord = (word: string) => {
    setAnimating(true);
    
    let baseWordScore = SCORES[word.length] || SCORES[10] || 10;
    
    // Updated Bomb Logic: Destroy all 8 surrounding neighbors of any bomb tile in the word
    const bombTiles = selection.filter(({r, c}) => grid[r][c].isBomb);
    let explodedTiles: Coordinate[] = [];
    
    if (bombTiles.length > 0) {
        bombTiles.forEach(bomb => {
             const adj = [
                {r: bomb.r-1, c: bomb.c-1}, {r: bomb.r-1, c: bomb.c}, {r: bomb.r-1, c: bomb.c+1},
                {r: bomb.r, c: bomb.c-1},                 {r: bomb.r, c: bomb.c+1},
                {r: bomb.r+1, c: bomb.c-1}, {r: bomb.r+1, c: bomb.c}, {r: bomb.r+1, c: bomb.c+1}
            ];
            
            adj.forEach(n => {
                 if (n.r >= 0 && n.r < GRID_SIZE && n.c >= 0 && n.c < GRID_SIZE) {
                     // Check if not already in selection (part of the word) and not already marked for explosion
                     const isSelected = selection.some(s => s.r === n.r && s.c === n.c);
                     const isAlreadyExploded = explodedTiles.some(e => e.r === n.r && e.c === n.c);
                     
                     // Target EVERYTHING: Valid tiles, blocked tiles, everything except what's already being removed.
                     if (!isSelected && !isAlreadyExploded && grid[n.r][n.c].status !== TileStatus.EXPLODED) {
                         explodedTiles.push({r: n.r, c: n.c});
                     }
                 }
            });
        });
    }

    const colorsInWord = selection
        .map(({r, c}) => grid[r][c].color)
        .filter(c => c !== WILD_COLOR && c !== 'RAINBOW');
    
    const hasWild = selection.some(({r, c}) => grid[r][c].color === WILD_COLOR);
    const uniqueColors = new Set(colorsInWord);
    const isColorMatch = colorsInWord.length > 0 && uniqueColors.size <= 1;

    let totalScore = baseWordScore;
    let bonusText = "";
    let feedbackType: 'success' | 'gold' = 'success';

    if (hasWild) {
        totalScore *= 3;
        bonusText = "GOLD BONUS!";
        playSound('gold');
        feedbackType = 'gold';
    } else if (isColorMatch) {
        totalScore *= 2;
        bonusText = "COLOR BONUS!";
        playSound('bonus');
    } else {
        playSound('success');
    }

    if (explodedTiles.length > 0) {
        totalScore += explodedTiles.length * 50; // Points for destroying blocks/tiles
        bonusText = "BOOM! " + bonusText;
        playSound('explode');
    }

    setGrid(prev => {
      const newGrid = prev.map(row => [...row]);
      selection.forEach(({ r, c }) => {
        newGrid[r][c] = { ...newGrid[r][c], status: TileStatus.MATCHED };
      });
      explodedTiles.forEach(({ r, c }) => {
        newGrid[r][c] = { ...newGrid[r][c], status: TileStatus.EXPLODED };
      });
      return newGrid;
    });

    // --- Difficulty & Streak Logic ---
    let extraText = bonusText;
    let timeAdded = 0;
    
    let newStreakShort = gameState.streakShort;
    let newStreakLong = gameState.streakLong;

    // Helper to determine if word triggers short streak penalty
    const isShortPenalty = (len: number) => {
        if (difficulty === Difficulty.EASY) return false;
        if (difficulty === Difficulty.NORMAL) return len === 3;
        if (difficulty === Difficulty.HARD) return len === 3 || len === 4;
        return false;
    };

    if (isShortPenalty(word.length)) {
        newStreakShort++;
        newStreakLong = 0;
        if (newStreakShort >= 2) {
            specialSpawnQueue.current.push('BLOCKED');
        }
    } else if (word.length >= 5) {
        newStreakLong++;
        newStreakShort = 0;
        if (newStreakLong >= 2) {
            specialSpawnQueue.current.push('BOMB');
        }
    } else {
        // Safe words reset streaks (e.g., 4-letter words in Normal mode)
        newStreakShort = 0;
        newStreakLong = 0;
    }

    if (mode === GameMode.TIMED) {
        const difficultyMultiplier = Math.max(0.2, 1 - (gameState.level - 1) * 0.15); 
        timeAdded = Math.ceil((word.length) * difficultyMultiplier); 
        if (hasWild) timeAdded += 3;
        else if (isColorMatch) timeAdded += 2;
        extraText = `+${timeAdded}s ${bonusText}`;
    }

    setFeedback({ text: `${word} ${extraText}`, type: feedbackType });
    spawnFlyingTiles(selection);

    setGameState(prev => {
        const newScore = prev.score + totalScore;
        const newTime = prev.timeLeft + timeAdded;
        return {
            ...prev,
            score: newScore,
            wordCount: prev.wordCount + 1,
            bestWord: word.length > prev.bestWord.length ? word : prev.bestWord,
            lastScoreAdded: totalScore,
            timeLeft: newTime,
            streakShort: newStreakShort,
            streakLong: newStreakLong
        };
    });
    
    setTimeout(() => {
        applyGravity();
        
        // Check for Level Up (Both Modes now)
        setGameState(prev => {
            if (prev.score >= prev.targetScore) {
                setScreen(Screen.LEVEL_UP);
                playSound('levelup');
                return prev; 
            }
            return prev;
        });

    }, 600); 
  };

  const handleInvalidWord = () => {
    setAnimating(true);
    playSound('error');
    setGrid(prev => {
      const newGrid = prev.map(row => [...row]);
      selection.forEach(({ r, c }) => {
        newGrid[r][c] = { ...newGrid[r][c], status: TileStatus.INVALID };
      });
      return newGrid;
    });

    setTimeout(() => {
        setSelection([]);
        setGrid(prev => prev.map(row => row.map(tile => ({ 
            ...tile, 
            status: tile.status === TileStatus.EXPLODED ? TileStatus.EXPLODED : TileStatus.IDLE,
            isNew: false // Fix: Stop drop animation from re-triggering when status resets
        }))));
        setAnimating(false);
    }, 400);
  };

  const applyGravity = () => {
    setGrid(prev => {
      const newGrid = prev.map(row => [...row]);
      for (let c = 0; c < GRID_SIZE; c++) {
        const colTiles: TileData[] = [];
        for (let r = 0; r < GRID_SIZE; r++) {
            if (prev[r][c].status !== TileStatus.MATCHED && prev[r][c].status !== TileStatus.EXPLODED) {
                colTiles.push({ ...prev[r][c], isNew: false });
            }
        }
        const needed = GRID_SIZE - colTiles.length;
        
        // Generate new tiles with current difficulty AND check queue
        const newTiles: TileData[] = Array.from({ length: needed }).map(() => {
            let forced: 'BLOCKED' | 'BOMB' | undefined = undefined;
            if (specialSpawnQueue.current.length > 0) {
                forced = specialSpawnQueue.current.shift();
            }
            return generateTile(gameState.level, mode, true, forced);
        });

        const mergedCol = [...newTiles, ...colTiles];
        for (let r = 0; r < GRID_SIZE; r++) {
            newGrid[r][c] = mergedCol[r];
        }
      }
      return newGrid;
    });

    setSelection([]);
    setAnimating(false);
    
    setTimeout(() => {
        setGameState(prev => ({...prev, lastScoreAdded: null}));
        setFeedback({ text: '', type: '' });
    }, 1000);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen font-bangers bg-purple-900 text-white">
         <div className="text-6xl mb-4 animate-bounce text-yellow-400 drop-shadow-[4px_4px_0_rgba(0,0,0,1)]" style={{ WebkitTextStroke: '2px black' }}>WORDFALL</div>
         <div className="w-16 h-16 border-4 border-black border-t-yellow-400 rounded-full animate-spin"></div>
      </div>
    );
  }

  // --- MENU SCREEN ---
  if (screen === Screen.MENU) {
      return (
          <div className="flex flex-col items-center justify-center min-h-screen font-fredoka p-4 bg-purple-900 relative overflow-hidden">
             <div className="absolute inset-0 bg-[radial-gradient(#991b1b_1px,transparent_1px)] bg-[length:24px_24px] opacity-50"></div>
             
             <div className="z-10 flex flex-col items-center gap-6 w-full max-w-md">
                 <h1 className="text-6xl sm:text-8xl font-bangers text-red-500 drop-shadow-[6px_6px_0_rgba(0,0,0,1)] tracking-wide animate-pop-in text-center" style={{ WebkitTextStroke: '3px black' }}>
                    WORDFALL
                 </h1>
                 
                 <div className="flex flex-col gap-2 w-full px-8 mt-2">
                     {/* Difficulty Selector */}
                     <div className="bg-white/90 border-4 border-black rounded-2xl p-3 mb-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                         <h3 className="text-center font-bangers text-xl mb-2">SELECT DIFFICULTY</h3>
                         <div className="flex justify-between gap-2">
                              {[Difficulty.EASY, Difficulty.NORMAL, Difficulty.HARD].map((d) => (
                                  <button
                                     key={d}
                                     onClick={() => setDifficulty(d)}
                                     className={`flex-1 py-1 rounded-lg border-2 border-black font-bangers text-lg transition-transform ${difficulty === d ? 'bg-yellow-400 scale-105 shadow-sm' : 'bg-gray-200 text-gray-500'}`}
                                  >
                                     {d}
                                  </button>
                              ))}
                         </div>
                         <p className="text-center text-xs font-fredoka font-bold text-gray-600 mt-2">
                             {difficulty === Difficulty.EASY && "Relaxed: No penalties for short words."}
                             {difficulty === Difficulty.NORMAL && "Balanced: 3-letter word streaks spawn blocks."}
                             {difficulty === Difficulty.HARD && "Hardcore: 3 & 4-letter word streaks spawn blocks."}
                         </p>
                     </div>

                     <button onClick={() => startGame(GameMode.CASUAL)} className="w-full py-4 bg-green-400 border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-2xl font-bangers hover:translate-y-1 hover:shadow-none transition-all active:bg-green-500">
                        CASUAL MODE
                        <span className="block text-sm font-fredoka font-bold text-black/60">Relaxed • Hints Available</span>
                     </button>

                     <button onClick={() => startGame(GameMode.TIMED)} className="w-full py-4 bg-orange-400 border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-2xl font-bangers hover:translate-y-1 hover:shadow-none transition-all active:bg-orange-500">
                        TIMED MODE
                        <span className="block text-sm font-fredoka font-bold text-black/60">Race the Clock • Obstacles</span>
                     </button>

                     <button onClick={() => setScreen(Screen.LEADERBOARD)} className="w-full py-3 bg-purple-300 border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-xl font-bangers hover:translate-y-1 hover:shadow-none transition-all active:bg-purple-400">
                        🏆 LEADERBOARD
                     </button>
                 </div>
             </div>
          </div>
      );
  }

  // --- LEADERBOARD SCREEN ---
  if (screen === Screen.LEADERBOARD) {
    const scores = getLeaderboard(leaderboardTab);

    return (
        <div className="flex flex-col items-center justify-center min-h-screen font-fredoka p-4 bg-purple-900 relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(#991b1b_1px,transparent_1px)] bg-[length:24px_24px] opacity-50"></div>
            
            <div className="z-10 w-full max-w-md bg-white border-4 border-black rounded-3xl p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col h-[80vh]">
                <h2 className="text-5xl font-bangers text-center text-yellow-400 mb-4 drop-shadow-sm" style={{ WebkitTextStroke: '1px black' }}>LEADERBOARD</h2>
                
                {/* Tabs */}
                <div className="flex gap-2 mb-4">
                    <button 
                        onClick={() => setLeaderboardTab(GameMode.CASUAL)}
                        className={`flex-1 py-2 font-bangers text-xl border-4 border-black rounded-xl transition-all ${leaderboardTab === GameMode.CASUAL ? 'bg-green-400 shadow-none translate-y-1' : 'bg-gray-200 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-green-200'}`}
                    >
                        CASUAL
                    </button>
                    <button 
                        onClick={() => setLeaderboardTab(GameMode.TIMED)}
                        className={`flex-1 py-2 font-bangers text-xl border-4 border-black rounded-xl transition-all ${leaderboardTab === GameMode.TIMED ? 'bg-orange-400 shadow-none translate-y-1' : 'bg-gray-200 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-orange-200'}`}
                    >
                        TIMED
                    </button>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto pr-2 space-y-2">
                    {scores.length === 0 ? (
                        <div className="text-center text-gray-500 mt-10 font-bold">No scores yet. Play a game!</div>
                    ) : (
                        scores.map((entry, i) => (
                            <div key={i} className="flex items-center bg-gray-50 border-2 border-black rounded-xl p-3 shadow-sm">
                                <div className={`w-10 h-10 flex items-center justify-center rounded-full border-2 border-black font-bangers text-xl mr-3 ${i === 0 ? 'bg-yellow-400' : i === 1 ? 'bg-gray-300' : i === 2 ? 'bg-orange-300' : 'bg-white'}`}>
                                    {i + 1}
                                </div>
                                <div className="flex-1">
                                    <div className="font-bangers text-2xl leading-none">{entry.score.toLocaleString()}</div>
                                    <div className="text-xs font-bold text-gray-500 uppercase flex justify-between">
                                        <span>{entry.bestWord || "---"}</span>
                                        {entry.level && <span>Lvl {entry.level}</span>}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <button onClick={() => setScreen(Screen.MENU)} className="mt-4 w-full py-3 bg-red-400 border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-xl font-bangers hover:translate-y-1 hover:shadow-none transition-all">
                    BACK TO MENU
                </button>
            </div>
        </div>
    );
  }

  // --- LEVEL UP POPUP ---
  if (screen === Screen.LEVEL_UP) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen font-fredoka p-4 bg-purple-900/90 relative z-50">
            <div className="bg-white border-4 border-black rounded-3xl p-8 w-full max-w-md shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] text-center animate-pop-in">
                 <h2 className="text-5xl font-bangers text-yellow-400 mb-6 drop-shadow-sm" style={{ WebkitTextStroke: '1px black' }}>LEVEL COMPLETE!</h2>
                 <p className="text-2xl font-bold mb-4">You reached Level {gameState.level}!</p>
                 <p className="mb-6 text-gray-600">Things are getting faster. Watch out for blocked tiles!</p>
                 <button 
                    onClick={nextLevel}
                    className="w-full py-3 bg-green-400 border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-2xl font-bangers hover:translate-y-1 hover:shadow-none transition-all"
                 >
                    NEXT LEVEL &gt;&gt;
                 </button>
            </div>
        </div>
      );
  }

  // --- GAME OVER SCREEN ---
  if (screen === Screen.GAMEOVER) {
      return (
          <div className="flex flex-col items-center justify-center min-h-screen font-fredoka p-4 bg-gray-900 relative">
             <div className="bg-white border-4 border-black rounded-3xl p-8 w-full max-w-md shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] text-center animate-pop-in">
                 <h2 className="text-5xl font-bangers text-red-500 mb-2 drop-shadow-sm" style={{ WebkitTextStroke: '1px black' }}>GAME OVER</h2>
                 
                 {isHighScore && (
                     <div className="mb-6 animate-bounce">
                         <span className="bg-yellow-400 text-black px-4 py-1 rounded-full border-2 border-black font-bangers text-xl shadow-md">
                             🎉 NEW HIGH SCORE! 🎉
                         </span>
                     </div>
                 )}

                 <div className="grid grid-cols-2 gap-4 mb-6">
                     <div className="bg-gray-100 p-3 rounded-xl border-2 border-gray-300">
                         <div className="text-xs font-bold text-gray-500 uppercase">Final Score</div>
                         <div className="text-3xl font-bangers text-purple-600">{gameState.score}</div>
                     </div>
                     <div className="bg-gray-100 p-3 rounded-xl border-2 border-gray-300">
                         <div className="text-xs font-bold text-gray-500 uppercase">Best Word</div>
                         <div className="text-lg font-bangers text-cyan-600 truncate">{gameState.bestWord || "-"}</div>
                     </div>
                     <div className="bg-gray-100 p-3 rounded-xl border-2 border-gray-300 col-span-2">
                         <div className="text-xs font-bold text-gray-500 uppercase">Level Reached</div>
                         <div className="text-3xl font-bangers text-green-500">{gameState.level}</div>
                     </div>
                 </div>

                 <div className="flex flex-col gap-3">
                    <button 
                        onClick={() => setScreen(Screen.MENU)}
                        className="w-full py-3 bg-yellow-400 border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-2xl font-bangers hover:translate-y-1 hover:shadow-none transition-all"
                    >
                        PLAY AGAIN
                    </button>
                    <button
                        onClick={() => { setLeaderboardTab(mode); setScreen(Screen.LEADERBOARD); }}
                        className="w-full py-2 bg-purple-300 border-4 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-xl font-bangers hover:translate-y-1 hover:shadow-none transition-all"
                    >
                        VIEW LEADERBOARD
                    </button>
                 </div>
             </div>
          </div>
      );
  }

  // --- GAME UI ---
  return (
    <div className="flex flex-col items-center justify-start min-h-screen font-fredoka p-4 gap-2 w-full max-w-md mx-auto relative select-none">
      
      {/* Top Bar */}
      <div className="w-full flex justify-between items-center mb-1">
         <h1 className="text-4xl font-bangers text-red-500 drop-shadow-[2px_2px_0_rgba(0,0,0,1)] tracking-wide" style={{ WebkitTextStroke: '1px black' }}>
            WORDFALL
         </h1>
         <button onClick={() => setScreen(Screen.MENU)} className="bg-purple-800 text-white px-3 py-1 rounded border-2 border-black font-bangers text-sm hover:bg-purple-700">
             MENU
         </button>
      </div>

      {/* Flying Tiles Layer */}
      {flyingTiles.map((tile) => (
          <div
            key={`fly-${tile.id}`}
            className={`
              fly-tile w-8 h-8 sm:w-12 sm:h-12 flex items-center justify-center 
              text-xl font-bangers rounded-2xl border-2 
              ${getColorClasses({...tile, status: TileStatus.IDLE, isBlocked: false, isBomb: false, key: 0, isNew: false} as TileData)}
              ${tile.color === WILD_COLOR ? 'gold-fly' : ''}
            `}
            style={{
                top: flyingTrigger ? tile.targetY : tile.startY,
                left: flyingTrigger ? tile.targetX : tile.startX,
                opacity: flyingTrigger ? 0 : 1,
                transform: flyingTrigger ? 'scale(0.5)' : 'scale(1)'
            }}
          >
              {tile.letter}
          </div>
      ))}

      {/* Score Board */}
      <div ref={scoreRef} className="w-full flex justify-between items-center bg-white border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-3 rounded-2xl z-20 relative overflow-hidden">
        
        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-black text-white px-3 pb-1 pt-3 rounded-b-lg font-bangers text-sm z-10 border-b-2 border-l-2 border-r-2 border-white">
             LVL {gameState.level}
        </div>

        <div className="flex flex-col">
            <span className="text-xs font-bold uppercase text-gray-500">Score</span>
            <span className="text-3xl font-bangers leading-none text-purple-600 stroke-black stroke-2" style={{ WebkitTextStroke: '1px black' }}>
                {gameState.score}
            </span>
            <span className="text-[10px] text-gray-400 font-bold">Target: {gameState.targetScore}</span>
        </div>
        
        <div className="flex flex-col items-center justify-center w-1/3">
             {mode === GameMode.TIMED ? (
                 <div className={`w-full flex flex-col items-center transition-transform duration-500 origin-center ${getTimerScale(gameState.timeLeft)}`}>
                     <span className={`text-4xl font-bangers transition-colors duration-300 ${getTimerTextColor(gameState.timeLeft)} ${gameState.timeLeft <= 15 ? 'animate-pulse' : ''} ${gameState.timeLeft <= 5 ? 'drop-shadow-[0_0_8px_rgba(220,38,38,1)]' : 'drop-shadow-md'}`}>
                         {gameState.timeLeft}s
                     </span>
                     <div className="w-full h-3 bg-gray-200 rounded-full border-2 border-black overflow-hidden shadow-sm">
                         <div 
                            className={`h-full transition-all duration-1000 ease-linear ${getTimerColor(gameState.timeLeft)}`}
                            style={{ width: `${Math.min(100, (gameState.timeLeft / 60) * 100)}%` }}
                         ></div>
                     </div>
                 </div>
             ) : (
                 <button 
                    onClick={showHint}
                    disabled={animating}
                    className="bg-yellow-300 border-2 border-black rounded-lg px-4 py-1 font-bangers text-lg shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-y-[2px] hover:bg-yellow-400"
                 >
                     HINT ?
                 </button>
             )}
        </div>

        <div className="flex flex-col items-end">
            <span className="text-xs font-bold uppercase text-gray-500">Best</span>
            <span className="text-xl font-bangers leading-none text-red-500" style={{ WebkitTextStroke: '1px black' }}>
                {gameState.bestWord || "-"}
            </span>
        </div>
      </div>

      {/* Floating Score Feedback */}
      {gameState.lastScoreAdded && (
        <div className="absolute top-44 left-1/2 transform -translate-x-1/2 animate-score z-50 pointer-events-none w-full text-center">
             <div className="text-6xl font-bangers text-green-400 drop-shadow-[4px_4px_0_rgba(0,0,0,1)]" style={{ WebkitTextStroke: '2px black' }}>
                 +{gameState.lastScoreAdded}
             </div>
        </div>
      )}
      
       <div className="h-8 w-full flex justify-center items-center">
        {feedback.text && (
            <div className={`text-xl font-bold font-bangers tracking-wide animate-pop-in drop-shadow-md ${feedback.type === 'success' ? 'text-green-300' : feedback.type === 'gold' ? 'text-yellow-400' : 'text-red-300'}`} style={{ textShadow: '2px 2px 0px black' }}>
                {feedback.text}
            </div>
        )}
       </div>


      {/* Game Grid */}
      <div 
        ref={gridRef}
        className="grid grid-cols-6 gap-2 p-3 bg-black/80 backdrop-blur-sm rounded-3xl border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,0.5)] touch-none"
        onMouseLeave={handleTouchEnd}
      >
        {grid.map((row, r) => (
          row.map((tile, c) => {
            const colorClasses = getColorClasses(tile);
            let animation = "";
            if (tile.isNew && tile.status === TileStatus.IDLE) animation = "animate-drop";
            if (tile.status === TileStatus.EXPLODED) animation = "animate-explode";

            return (
              <div
                key={tile.id} 
                data-coord={`${r},${c}`}
                onMouseDown={() => handleTouchStart(r, c)}
                onMouseEnter={(e) => handleTouchMove(e)}
                onMouseUp={handleTouchEnd}
                onTouchStart={() => handleTouchStart(r, c)}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                className={`
                  w-12 h-12 sm:w-14 sm:h-14 
                  flex items-center justify-center 
                  text-2xl sm:text-3xl font-bangers 
                  rounded-2xl border-b-4 border-r-2 border-l-2 border-t-2
                  select-none cursor-pointer
                  transition-transform duration-100
                  ${colorClasses} ${animation}
                  ${tile.status === TileStatus.IDLE && !tile.isBlocked ? 'active:scale-95' : ''}
                `}
              >
                {tile.letter}
              </div>
            );
          })
        ))}
      </div>

      <div className="mt-2 text-center bg-white/10 backdrop-blur-md border-2 border-black/50 p-2 rounded-xl max-w-xs">
        <p className="text-sm font-bold text-white/90 font-fredoka">
          {difficulty === Difficulty.EASY && "Relaxed: No penalties for short words!"}
          {difficulty === Difficulty.NORMAL && "Normal: 3-letter word streaks spawn blocks."}
          {difficulty === Difficulty.HARD && "Hard: 3 & 4-letter word streaks spawn blocks."}
        </p>
      </div>

    </div>
  );
}