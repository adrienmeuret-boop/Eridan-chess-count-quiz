// -----------------------------------------------------------
// Robust function to get players from FEN

function getPlayersFromFen(fen) {
  if (!fen || typeof fen !== "string") throw new Error("Invalid FEN string");
  const parts = fen.split(" ");
  if (parts.length < 2 || !["w","b"].includes(parts[1])) throw new Error("FEN missing turn info");
  const turn = parts[1];
  return { p1: turn, p2: turn === "w" ? "b" : "w" };
}

// -----------------------------------------------------------
// Global variables

let chess_data = null; // See loadSettings for value of chess_data
let gameEnded = false;
let timerInterval = null;

// -----------------------------------------------------------
// Chess functions

// Return the number of possible checking moves
function countChecks(game) {
  const moves = game.moves({ verbose: true });

  const checkingMoves = moves.filter((m) => {
    const tempGame = new Chess(game.fen());
    tempGame.move(m);
    return tempGame.in_check();
  });

  return {
    count: checkingMoves.length,
    moves: checkingMoves.map((m) => m.san),
    targets: checkingMoves.map((m) => ({ to: m.to, piece: m.piece })),
  };
}

// Return the number of possible capturing moves
function countCaptures(game) {
  const moves = game.moves({ verbose: true });
  const capturingMoves = moves.filter((m) => m.flags.includes("c") || m.flags.includes("e"));

  return {
    count: capturingMoves.length,
    moves: capturingMoves.map((m) => m.san),
    targets: capturingMoves.map((m) => ({ to: m.to, piece: m.piece })),
  };
}

// Return the total number of moves
function countAllLegal(game) {
  const moves = game.moves({ verbose: true });

  return {
    count: moves.length,
    moves: moves.map((m) => m.san),
    targets: moves.map((m) => ({ to: m.to, piece: m.piece })),
  };
}

// Return a game where it's the specified player to move ('w' or 'b') from the given FEN
function switchFenSides(fen, side) {
  // New robust version using getPlayersFromFen
  const players = getPlayersFromFen(fen);
  if (side !== "w" && side !== "b") throw new Error("Side must be 'w' or 'b'");
  const fenParts = fen.split(" ");
  fenParts[1] = side;
  return fenParts.join(" ");
}

// Return array of PGN games
async function getGames() {
  const path = "lichess-puzzles/selected_games.pgn";
  console.log("Loading games from:", path);
  const response = await fetch(path);
  const text = await response.text();
  console.log("Raw PGN text length:", text.length);

  const sections = text.split("\n\n").filter((section) => section.trim() !== "");
  const games = [];
  let currentGame = "";

  for (const section of sections) {
    if (section.startsWith("[")) {
      if (currentGame) games.push(currentGame.trim());
      currentGame = section;
    } else {
      currentGame += "\n\n" + section;
    }
  }
  if (currentGame) games.push(currentGame.trim());

  console.log("Number of games found:", games.length);
  if (games.length <= 0) console.log("Error with PGN file");
  return games;
}

// Load the game weights file and return parsed weights
async function getWeights() {
  const path = "lichess-puzzles/selected_weights.json";
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    const weights = await response.json();
    console.log(`Loaded ${weights.length} weight rows`);
    return weights;
  } catch (error) {
    console.error("Failed to load game stats:", error);
    return null;
  }
}

function getRandomPosNumber(game_weights, white) {
  const filtered = game_weights.filter((entry) => (white ? entry.ply % 2 === 0 : entry.ply % 2 !== 0));
  if (filtered.length === 0) throw new Error("No entries available for the specified color.");

  const totalWeight = filtered.reduce((sum, entry) => sum + entry.weight, 0);
  let threshold = Math.random() * totalWeight;

  for (let i = 0; i < filtered.length; i++) {
    threshold -= filtered[i].weight;
    if (threshold < 0) {
      console.log(`Selected: game=${filtered[i].game}, ply=${filtered[i].ply}, weight=${filtered[i].weight}`);
      return { game: filtered[i].game, ply: filtered[i].ply };
    }
  }

  return { game: filtered[0].game, ply: filtered[0].ply };
}

// Return a game object with the given index
function getGame(game_index, ply) {
  const game = new Chess();
  const pgn = chess_data.games[game_index];
  console.log("PGN length:", pgn.length);

  const parsedGame = game.load_pgn(pgn);
  if (!parsedGame) {
    console.log("Error parsing PGN");
    return null;
  }

  const moves = game.history();
  game.reset();
  for (let i = 0; i < ply; i++) game.move(moves[i]);
  return game;
}

// Return object with correct counts for black and white from given fen
function getCorrectAnswers(fen, questionTypes) {
  return questionTypes.reduce((result, quesType) => {
    result[quesType] = getOneCorrectAnswer(fen, quesType);
    return result;
  }, {});
}

function getOneCorrectAnswer(fen, questionType) {
  const realTurn = fen.split(" ")[1];
  let side;

  if (questionType.startsWith("p1")) side = realTurn;
  else if (questionType.startsWith("p2")) side = realTurn === "w" ? "b" : "w";
  else throw new RangeError("Expected p1 or p2");

  const modFen = switchFenSides(fen, side);
  const game = new Chess();
  game.load(modFen);

  if (questionType.endsWith("Checks")) return countChecks(game);
  if (questionType.endsWith("Captures")) return countCaptures(game);
  if (questionType.endsWith("AllLegal")) return countAllLegal(game);

  throw new RangeError("Expected Checks or Captures or AllLegal");
}

// -----------------------------------------------------------
// Timer and score code

function updateTimerDisplay() {
  const minutes = Math.floor(chess_data.timeRemaining / 60);
  const seconds = chess_data.timeRemaining % 60;
  const timerEl = document.getElementById("timer");
  if (!timerEl) return;

  timerEl.textContent = `Time: ${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function incrementScore() {
  chess_data.score++;
  const scoreEl = document.getElementById("score");
  if (scoreEl) scoreEl.textContent = `Score: ${chess_data.score}`;
}

function resetScore() {
  chess_data.score = 0;
  const scoreEl = document.getElementById("score");
  if (scoreEl) scoreEl.textContent = `Score: ${chess_data.score}`;
}

function initTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  updateTimerDisplay();
  timerInterval = setInterval(() => {
    if (gameEnded) return;

    chess_data.timeRemaining = Math.max(0, chess_data.timeRemaining - 1);
    updateTimerDisplay();

    if (chess_data.timeRemaining <= 0) {
      gameEnded = true;
      playBuzz();
      endGame();
    }
  }, 1000);
}

function startTimer() {
  if (chess_data.showTimer) chess_data.timeRemaining = chess_data.defaultTimeRemaining;
  else chess_data.timeRemaining = Infinity;

  setTimerVisibility(chess_data.showTimer);
  updateTimerDisplay();
}

function penalizeTime() {
  chess_data.timeRemaining = Math.max(0, chess_data.timeRemaining - 10);
  updateTimerDisplay();
}

// -----------------------------------------------------------
// Display ordering (White then Black, Moves->Checks->Captures)

function qTypeForAbsColorAndKind(color, kind, fenTurn) {
  const prefix = color === fenTurn ? "p1" : "p2";
  return `${prefix}${kind}`;
}

function getFixedDisplayQuestionTypes() {
  // p1 = joueur à qui c’est le trait (playerToMoveAfter)
  // p2 = l’autre joueur
  return [
    "p1AllLegal",
    "p1Checks",
    "p1Captures",
    "p2AllLegal",
    "p2Checks",
    "p2Captures",
  ];
}

// -----------------------------------------------------------
// Reveal answers (numbers near inputs + moves list in #movesList)

function revealAnswers() {
  const movesList = document.getElementById("movesList");
  if (movesList) {
    movesList.innerHTML = "";
    movesList.style.display = "block";
  }

  getFixedDisplayQuestionTypes().forEach((id) => {
    const shownMovesLabel = document.getElementById(id + "ShownMoves");
    const correct = chess_data.correct?.[id];
    if (!shownMovesLabel || !correct) return;

    const movesText = Array.isArray(correct.moves) ? correct.moves.join(", ") : "";

    shownMovesLabel.innerHTML = `<span style="font-weight:700; font-size:1.4em;">${correct.count}</span>`;

    if (movesList) {
      const row = document.createElement("div");
      row.className = "movesRow";

      const lab = document.createElement("div");
      lab.className = "movesLabel";
      lab.textContent = createDynamicInputsLabel(id);

      const txt = document.createElement("div");
      txt.className = "movesText";
      txt.textContent = movesText ? `(${movesText})` : "";

      row.appendChild(lab);
      row.appendChild(txt);
      movesList.appendChild(row);
    }
  });

  const showMovesButton = document.getElementById("showMovesButton");
  if (showMovesButton) {
    showMovesButton.disabled = true;
    showMovesButton.style.backgroundColor = "#d3d3d3";
  }
}

// -----------------------------------------------------------
// Board square highlights

function clearBoardHighlights() {
  const boardEl = document.getElementById("board");
  if (!boardEl) return;
  boardEl.querySelectorAll(".hl-red").forEach((el) => el.classList.remove("hl-red"));
}

function highlightSquares(squares) {
  clearBoardHighlights();

  const boardEl = document.getElementById("board");
  if (!boardEl || !Array.isArray(squares)) return;

 squares.forEach((sq) => {
  const el = boardEl.querySelector(`[data-square="${sq}"]`);
  if (el) el.classList.add("hl-red");
  else {
    const el2 = boardEl.querySelector(`.square-${sq}`);
    if (el2) el2.classList.add("hl-red");
  }
});
}

// -----------------------------------------------------------
// Audio & buzzer

function playBuzz() {
  try {
    if (!playBuzz._ctx || !playBuzz._buffer) return;
    const source = playBuzz._ctx.createBufferSource();
    source.buffer = playBuzz._buffer;
    source.connect(playBuzz._ctx.destination);
    source.start();
  } catch (e) {
    console.warn("Failed to play buzzer:", e);
  }
}

// -----------------------------------------------------------
// End game handling

function endGame() {
  const movesList = document.getElementById("movesList");
  if (movesList) movesList.style.display = "block";

  // Disable inputs
  getFixedDisplayQuestionTypes().forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.disabled = true;
  });

  const startBtn = document.getElementById("startButton");
  if (startBtn) startBtn.disabled = false;

  // Optional: Highlight remaining correct moves
  revealAnswers();
}

// -----------------------------------------------------------
// Utility functions

function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// -----------------------------------------------------------
// Color helpers

function otherColor(color) {
  return color === "w" ? "b" : "w";
}

function isWhite(color) {
  return color === "w";
}

function isBlack(color) {
  return color === "b";
}

// -----------------------------------------------------------
// FEN helpers

function fenPieceCounts(fen) {
  const parts = fen.split(" ");
  const boardPart = parts[0];
  const counts = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0, P: 0, N: 0, B: 0, R: 0, Q: 0, K: 0 };
  boardPart.split("").forEach((c) => {
    if (counts[c] !== undefined) counts[c]++;
  });
  return counts;
}

// -----------------------------------------------------------
// PGN helpers

function extractMovesFromPgn(pgn) {
  const lines = pgn.split("\n").filter((l) => !l.startsWith("["));
  const text = lines.join(" ");
  const moveTokens = text
    .replace(/\{.*?\}/g, "")
    .replace(/\d+\./g, "")
    .replace(/\.\.\./g, "")
    .trim()
    .split(/\s+/);
  return moveTokens.filter((t) => t.length > 0);
}

// -----------------------------------------------------------
// Chessboard helpers

function flipBoardIfNeeded() {
  if (!chess_data.board) return;
  const player = chess_data.playerToMove;
  const currentOrientation = chess_data.board.orientation();
  if ((player === "w" && currentOrientation !== "white") || (player === "b" && currentOrientation !== "black")) {
    chess_data.board.flip();
  }
}

// -----------------------------------------------------------
// Debug helpers

function logFen(fen) {
  console.log("FEN:", fen);
}

function logGameState(game) {
  console.log("Game FEN:", game.fen());
  console.log("History:", game.history());
}

// -----------------------------------------------------------
// Input helpers

function setInputValue(inputId, value) {
  const el = document.getElementById(inputId);
  if (el) el.value = value;
}

function disableInputs() {
  getFixedDisplayQuestionTypes().forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.disabled = true;
  });
}

function enableInputs() {
  getFixedDisplayQuestionTypes().forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.disabled = false;
  });
}

// -----------------------------------------------------------
// Highlight helpers

function setBigMarker(square, piece, side) {
  const boardEl = document.getElementById("board");
  if (!boardEl) return;
  const sqEl = boardEl.querySelector(`[data-square="${square}"]`) || boardEl.querySelector(`.square-${square}`);
  if (!sqEl) return;
  const big = sqEl.querySelector(":scope > .pmBig");
  if (!big) return;
  big.className = "pmBig on";
  if (piece) big.classList.add(`piece-${piece}`);
  else if (side) big.classList.add(side === "w" ? "side-w" : "side-b");
}

// -----------------------------------------------------------
// Player helpers

function getPlayerForQuestionType(qType) {
  if (!qType.startsWith("p1") && !qType.startsWith("p2")) throw new RangeError("Expected p1 or p2");
  const fenTurn = chess_data.playerToMoveAfter;
  return qType.startsWith("p1") ? fenTurn : otherColor(fenTurn);
}

// -----------------------------------------------------------
// Move validation helpers

function isMoveCheck(game, move) {
  const temp = new Chess(game.fen());
  temp.move(move);
  return temp.in_check();
}

function isMoveCapture(move) {
  return move.flags.includes("c") || move.flags.includes("e");
}

// -----------------------------------------------------------
// Misc helpers

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secs = (seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

// -----------------------------------------------------------
// Initialize default chess_data (backup)

function resetChessDataDefaults() {
  chess_data.score = 0;
  chess_data.is_correct = {};
  chess_data.fen = null;
  chess_data.correct = null;
  chess_data.playerToMove = "w";
  chess_data.playerToMoveAfter = "w";
  chess_data.plyAhead = 0;
  chess_data.game_index = null;
  chess_data.ply = 0;
}

// -----------------------------------------------------------
// Puzzle navigation

function nextPuzzle() {
  if (gameEnded) return;
  loadNewPuzzle();
  focusInputForPlayerToMove();
}

// -----------------------------------------------------------
// Reset / refresh board

function resetBoardToCurrentPuzzle() {
  if (!chess_data.game) return;
  chess_data.board.position(chess_data.game.fen());
  chess_data.playerToMoveAfter = chess_data.plyAhead % 2 === 0 ? chess_data.playerToMove : otherColor(chess_data.playerToMove);
  clearBoardHighlights();
  clearPieceMarkers();
  clearBigMarkers();
  ensurePieceMarkers();
  updateMovesDisplay();
}

// -----------------------------------------------------------
// Audio preload helpers

function preloadAudio(url) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => console.log(`Audio ${url} preloaded, duration: ${buf.duration}s`))
      .catch((e) => console.warn("Audio decode failed:", e));
  } catch (e) {
    console.warn("AudioContext creation failed:", e);
  }
}

// -----------------------------------------------------------
// Debug utilities

function logCorrectAnswers() {
  console.log("Correct answers:", chess_data.correct);
}

function logScore() {
  console.log("Score:", chess_data.score);
}

// -----------------------------------------------------------
// Misc UI helpers

function showElement(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "block";
}

function hideElement(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "none";
}

function setButtonDisabled(id, disabled) {
  const btn = document.getElementById(id);
  if (btn) btn.disabled = disabled;
}

function setButtonColor(id, color) {
  const btn = document.getElementById(id);
  if (btn) btn.style.backgroundColor = color;
}

// -----------------------------------------------------------
// Local storage helpers

function saveToLocalStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("Failed to save to localStorage:", key, e);
  }
}

function loadFromLocalStorage(key, defaultValue) {
  try {
    const value = localStorage.getItem(key);
    return value !== null ? JSON.parse(value) : defaultValue;
  } catch (e) {
    console.warn("Failed to load from localStorage:", key, e);
    return defaultValue;
  }
}

// -----------------------------------------------------------
// Reset / New Game button

function setupStartButton() {
  const startBtn = document.getElementById("startButton");
  if (!startBtn) return;
  startBtn.type = "button";
  startBtn.addEventListener("click", startNewGame);
}

// -----------------------------------------------------------
// Reveal / hide answers buttons

function setupShowMovesButton() {
  const btn = document.getElementById("showMovesButton");
  if (!btn) return;
  btn.type = "button";
  btn.addEventListener("click", revealAnswers);
}

// -----------------------------------------------------------
// Window resize / board adjust

window.addEventListener("resize", () => {
  if (chess_data.board) chess_data.board.resize();
});

// -----------------------------------------------------------
// Quick helpers for testing

function testLoadPuzzle() {
  console.log("Loading new puzzle for testing...");
  loadNewPuzzle();
  focusInputForPlayerToMove();
}

function testIncrementScore() {
  incrementScore();
  logScore();
}

// -----------------------------------------------------------
// Misc chess helpers

function isKingMove(move) {
  return move.piece.toLowerCase() === "k";
}

function isPawnMove(move) {
  return move.piece.toLowerCase() === "p";
}

// -----------------------------------------------------------
// Export / module stubs (if needed for bundlers)

if (typeof window !== "undefined") {
  window.getPlayersFromFen = getPlayersFromFen;
  window.loadNewPuzzle = loadNewPuzzle;
  window.startNewGame = startNewGame;
  window.submitAnswers = submitAnswers;
  window.resetBoardToCurrentPuzzle = resetBoardToCurrentPuzzle;
}

// -----------------------------------------------------------
// Boot sequence

document.addEventListener("DOMContentLoaded", async () => {
  // Preload buzzer audio
  try {
    if (!playBuzz._ctx) {
      playBuzz._ctx = new (window.AudioContext || window.webkitAudioContext)();
      const response = await fetch("duck.mp3");
      const buffer = await response.arrayBuffer();
      playBuzz._buffer = await playBuzz._ctx.decodeAudioData(buffer);
      console.log("Buzzer loaded successfully");
    }
  } catch (e) {
    console.warn("Failed to preload buzzer audio:", e);
  }

  // Setup UI
  setupSettingsModal();
  setupStartButton();
  setupShowMovesButton();

  // Load all settings and start state
  await loadSettings();
});
