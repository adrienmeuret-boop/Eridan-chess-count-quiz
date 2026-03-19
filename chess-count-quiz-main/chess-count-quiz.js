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
// Piece markers (6 zones)

function ensurePieceMarkers() {
  const boardEl = document.getElementById("board");
  if (!boardEl) return;

  const squares = boardEl.querySelectorAll(".square-55d63");

  squares.forEach((sqEl) => {
    if (!sqEl.querySelector(":scope > .pmBig")) {
      const big = document.createElement("div");
      big.className = "pmBig";
      sqEl.appendChild(big);
    }

    if (sqEl.querySelector(":scope > .pm6")) return;

    const wrap = document.createElement("div");
    wrap.className = "pm6";

    ["p", "n", "b", "r", "q", "k"].forEach((piece) => {
      const d = document.createElement("div");
      d.className = `pm ${piece}`;
      wrap.appendChild(d);
    });

    sqEl.appendChild(wrap);
  });
}

function clearPieceMarkers() {
  const boardEl = document.getElementById("board");
  if (!boardEl) return;

  boardEl.querySelectorAll(".pm6 .pm.on, .pm6 .pm.solid").forEach((el) => el.classList.remove("on", "solid"));
}

function clearBigMarkers() {
  const boardEl = document.getElementById("board");
  if (!boardEl) return;

  boardEl.querySelectorAll(".pmBig").forEach((el) => {
    el.classList.remove("on", "side-w", "side-b");
    el.classList.remove("piece-p", "piece-n", "piece-b", "piece-r", "piece-q", "piece-k");
  });
}

function markSquarePiece(square, piece) {
  const boardEl = document.getElementById("board");
  if (!boardEl) return;

  const sqEl = boardEl.querySelector(`[data-square="${square}"]`) || boardEl.querySelector(`.square-${square}`);
  if (!sqEl) return;

  if (!sqEl.querySelector(":scope > .pm6")) ensurePieceMarkers();

  const marker = sqEl.querySelector(`:scope > .pm6 .pm.${piece}`);
  if (marker) marker.classList.add("on");
}

function highlightMovesByPiece(moveList, side) {
  clearPieceMarkers();
  clearBigMarkers();
  ensurePieceMarkers();

  if (!Array.isArray(moveList)) return;

  const map = new Map();

  moveList.forEach((m) => {
    if (!m?.to || !m?.piece) return;
    if (!map.has(m.to)) map.set(m.to, new Map());
    const counts = map.get(m.to);
    counts.set(m.piece, (counts.get(m.piece) || 0) + 1);
  });

  const boardEl = document.getElementById("board");

  for (const [sq, counts] of map.entries()) {
    const piecesDistinct = Array.from(counts.keys());

    piecesDistinct.forEach((p) => markSquarePiece(sq, p));

    const sqEl = boardEl.querySelector(`[data-square="${sq}"]`) || boardEl.querySelector(`.square-${sq}`);
    if (!sqEl) continue;

    const pm6 = sqEl.querySelector(":scope > .pm6");
    if (!pm6) continue;

    for (const p of piecesDistinct) {
      if ((counts.get(p) || 0) >= 2) {
        const mini = pm6.querySelector(`.pm.${p}`);
        if (mini) mini.classList.add("solid");
      }
    }

    const big = sqEl.querySelector(":scope > .pmBig");
    if (!big) continue;

    big.classList.add("on");
    big.classList.remove(
      "piece-p",
      "piece-n",
      "piece-b",
      "piece-r",
      "piece-q",
      "piece-k",
      "side-w",
      "side-b"
    );

    if (piecesDistinct.length === 1) big.classList.add(`piece-${piecesDistinct[0]}`);
    else big.classList.add(side === "w" ? "side-w" : "side-b");
  }
}

function setupHighlightButtons() {
  const labels = {
    "white’s moves": "w",
    "black’s moves": "b",
    "white’s checks": "w",
    "black’s checks": "b",
    "white’s captures": "w",
    "black’s captures": "b",
    clear: null,
  };

  const norm = (s) =>
    (s || "")
      .trim()
      .toLowerCase()
      .replaceAll("'", "’")
      .replace(/\s+/g, " ");

  document.querySelectorAll("#boardHighlightsControls button").forEach((btn) => {
    const key = norm(btn.textContent);
    const side = labels[key];

    btn.type = "button";
    btn.onclick = () => {
      if (!side) {
        // clear
        clearBoardHighlights();
        clearPieceMarkers();
        clearBigMarkers();
        return;
      }

if (!chess_data.correct) chess_data.correct = {};

const fenTurn = chess_data.playerToMoveAfter;

let kind;
if (key.includes("moves")) kind = "AllLegal";
else if (key.includes("checks")) kind = "Checks";
else if (key.includes("captures")) kind = "Captures";

const qType = qTypeForAbsColorAndKind(side, kind, fenTurn);

let ans = chess_data.correct[qType];
if (!ans) {
  ans = getOneCorrectAnswer(chess_data.fen, qType);
  chess_data.correct[qType] = ans;
}

      if (!ans?.targets) return;
      highlightMovesByPiece(ans.targets, side);
    };
  });
}

// ----------------------------------------------------------
// Moves table (remainingMoves) corrigée
function createMovesTableHtml(movesList, fenTurn) {
  let tableHtml = `<h3>Compute counts after these moves:</h3>
<table class="moves-table">`;

  const totalMoves = movesList.length;
  let turnNumber = 1;

  // Déterminer la couleur du premier coup réel dans le slice
  // vrai = blanc, faux = noir
  let currentIsWhite = fenTurn === "w";

  let i = 0;
  while (i < totalMoves) {
    let whiteMove = "";
    let blackMove = "";

    if (currentIsWhite) {
      // Premier coup à jouer = blanc
      whiteMove = movesList[i] || "";
      i++;
      currentIsWhite = false;

      if (i < totalMoves) {
        blackMove = movesList[i] || "";
        i++;
        currentIsWhite = true;
      }
    } else {
      // Premier coup à jouer = noir → colonne blanche vide = "..."
      whiteMove = "...";
      blackMove = movesList[i] || "";
      i++;
      currentIsWhite = true;
    }

    tableHtml += `
    <tr>
      <td class="turn">${turnNumber}.</td>
      <td class="w">${whiteMove}</td>
      <td class="b">${blackMove}</td>
    </tr>`;

    turnNumber++;
  }

  tableHtml += "</table>";
  return tableHtml;
}

function updateMovesDisplay() {
  const movesDisplay = document.getElementById("remainingMoves");
  if (!movesDisplay || chess_data.plyAhead === 0) {
    if (movesDisplay) movesDisplay.innerHTML = "";
    return;
  }

  const fullHistory = chess_data.game.history();
  const startIndex = fullHistory.length - chess_data.plyAhead;
  const movesList = fullHistory.slice(startIndex);

  // Déterminer le joueur à jouer pour le premier coup affiché
  const firstMoveIsWhite = (startIndex % 2 === 0); // vrai si premier coup slice = blanc
  const fenTurnAfterPlyAhead = firstMoveIsWhite ? "w" : "b";

  movesDisplay.innerHTML = createMovesTableHtml(movesList, fenTurnAfterPlyAhead);
}

function getMovesInputIdForPlayerToMove() {
  // le vrai joueur à jouer
  const fenTurn = chess_data.playerToMoveAfter;
  // p1 = joueur à jouer
  return qTypeForAbsColorAndKind(fenTurn, "AllLegal", fenTurn);
}
// ----------------------------------------------------------
// Game load / puzzle

function loadNewPuzzle() {
  
  clearBoardHighlights();

  const game_and_ply = getRandomPosNumber(chess_data.game_weights, chess_data.playerToMoveAfter === "w");
  chess_data.game_index = game_and_ply.game;
  chess_data.ply = game_and_ply.ply;

chess_data.game = getGame(game_and_ply.game, game_and_ply.ply);
chess_data.fen = chess_data.game.fen();

// recalculer joueur à jouer **après la création du jeu**
setPlayerToMoveAfter();

createDynamicInputs(getFixedDisplayQuestionTypes());

const prior_game = getGame(game_and_ply.game, Math.max(0, game_and_ply.ply - chess_data.plyAhead));
chess_data.board.position(prior_game.fen());
// Afficher le joueur avec le trait en bas
if (chess_data.playerToMove === "b") {
  chess_data.board.flip();
}

  ensurePieceMarkers();
  clearPieceMarkers();
  updateMovesDisplay();

const allTypes = getFixedDisplayQuestionTypes();
chess_data.correct = getCorrectAnswers(chess_data.fen, allTypes);

  // Pre-calc AllLegal for highlight buttons (useful even if not asked)

  chess_data.is_correct = Object.fromEntries(getFixedDisplayQuestionTypes().map((name) => [name, false]));

  getFixedDisplayQuestionTypes().forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.value = 0;

    const feedbackIcon = document.getElementById(id + "FeedbackIcon");
    if (feedbackIcon) {
      feedbackIcon.textContent = "";
      feedbackIcon.className = "feedbackIcon";
    }

    const shownMovesLabel = document.getElementById(id + "ShownMoves");
    if (shownMovesLabel) shownMovesLabel.textContent = "";
  });

  // Clear movesList (bottom) when new puzzle loads
  const movesList = document.getElementById("movesList");
  if (movesList) {
    movesList.innerHTML = "";
    movesList.style.display = "none";
  }

  const showMovesButton = document.getElementById("showMovesButton");
  if (showMovesButton) {
    showMovesButton.disabled = false;
    showMovesButton.style.backgroundColor = "";
  }

  const form = document.getElementById("chessCountForm");
  if (form) form.onsubmit = submitAnswers;
}

function startNewGame() {
  // Sélection du joueur à jouer
  const selected = document.querySelector('input[name="playerToMove"]:checked').value;
  setPlayerToMove(selected);
  setPlayerToMoveAfter();

  // Initialisation du board
  setBoard();

  // Réinitialisation du jeu
  gameEnded = false;
  resetScore();
loadNewPuzzle();
focusInputForPlayerToMove(); // <-- ajouter cette ligne
chess_data.timeRemaining = chess_data.showTimer ? chess_data.defaultTimeRemaining : 9999;
initTimer();
}
// ----------------------------------------------------------

// Renvoie "w" ou "b" pour un ID donné
function playerColorForInputId(id) {
  if (id.startsWith("p1")) return chess_data.playerToMoveAfter; // joueur ayant le trait
  else return chess_data.playerToMoveAfter === "w" ? "b" : "w";  // l’autre joueur
}

// Submit answers

function submitAnswers(event) {
  event.preventDefault();

  if (!chess_data || !chess_data.correct) return;

  const prevTime = chess_data.timeRemaining;

  // 🔥 Construire la liste réelle des inputs à corriger
  // On ne prend QUE ceux qui sont cochés dans Settings
  const activeDisplayed = getFixedDisplayQuestionTypes().filter((id) => chess_data.questionTypes.includes(id));

  activeDisplayed.forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;

    const correct = chess_data.correct[id];
    if (!correct) return;

    const inputValue = parseInt(input.value, 10);
    const isCorrect = inputValue === correct.count;

    const feedbackIcon = document.getElementById(id + "FeedbackIcon");
    if (feedbackIcon) {
      feedbackIcon.textContent = isCorrect ? "✓" : "✗";
      feedbackIcon.className = isCorrect ? "feedbackIcon correct" : "feedbackIcon incorrect";
    }

    if (!chess_data.is_correct[id] && isCorrect) {
      chess_data.is_correct[id] = true;
      incrementScore();
    }

    if (!isCorrect) penalizeTime();
  });

  if (gameEnded) return;

  // Jouer le buzzer si le temps s'écoule
  if (prevTime > 0 && chess_data.timeRemaining === 0) playBuzz();
  if (chess_data.timeRemaining <= 0) {
    gameEnded = true;
    endGame();
    return;
  }

  // Vérifier si tous les inputs cochés sont corrects
  const allCorrect = activeDisplayed.every((id) => chess_data.is_correct[id]);

  if (allCorrect) {
    loadNewPuzzle();
    focusInputForPlayerToMove();
  }
}

// ----------------------------------------------------------
// Settings dialog box

function setupSettingsModal() {
  const settings = document.getElementById("settingsModal");
  const settingsBtn = document.getElementById("settingsButton");
  const closeBtn = document.querySelector("#settingsModal .close-button");

  if (!settings) return;

  // Force closed on load (even if CSS modal is broken)
  settings.style.display = "none";

  if (settingsBtn) {
    settingsBtn.type = "button";
    settingsBtn.onclick = () => (settings.style.display = "block");
  }

  if (closeBtn) {
    closeBtn.onclick = () => (settings.style.display = "none");
  }

  window.addEventListener("click", (event) => {
    if (event.target === settings) settings.style.display = "none";
  });
}

function setTimerVisibility(visible) {
  const timerSection = document.getElementById("timerSection");
  if (!timerSection) return;
  timerSection.style.display = visible ? "block" : "none";
}

// ----------------------------------------------------------
// Load settings

async function loadSettings() {
  chess_data = {
    showTimer: true,
    fen: null,
    correct: null,
    defaultTimeRemaining: 180,
    timeRemaining: 999,
    score: 0,
    is_correct: null,
    games: null,
    game_weights: null,
    board: null,
    questionTypes: null,
    plyAhead: 0,
    playerToMove: "w",
    playerToMoveAfter: "w",
  };

  chess_data.showTimer = localStorage.getItem("showTimer") === "false" ? false : true;
  const showTimerEl = document.getElementById("showTimer");
  if (showTimerEl) showTimerEl.checked = chess_data.showTimer;
  setTimerVisibility(chess_data.showTimer);

    const savedDefaultTimeRemaining = localStorage.getItem("defaultTimeRemaining");
  chess_data.defaultTimeRemaining = savedDefaultTimeRemaining ? parseInt(savedDefaultTimeRemaining, 10) : chess_data.defaultTimeRemaining;

  const defaultTimeMinutesEl = document.getElementById("defaultTimeMinutes");
  if (defaultTimeMinutesEl) defaultTimeMinutesEl.value = Math.max(1, Math.round(chess_data.defaultTimeRemaining / 60));

  const selectedToMoveStored = localStorage.getItem("selectedToMove") || "Random";
  const radio = document.querySelector(`input[value="${selectedToMoveStored}"]`);
  if (radio) radio.checked = true;
  setPlayerToMove(selectedToMoveStored);

  const savedPlyAhead = localStorage.getItem("plyAhead");
  chess_data.plyAhead = savedPlyAhead ? parseInt(savedPlyAhead, 10) : 0;
  const plyAheadEl = document.getElementById("plyAhead");
  if (plyAheadEl) plyAheadEl.value = chess_data.plyAhead;

  setPlayerToMoveAfter();

  chess_data.games = await getGames();
  chess_data.game_weights = await getWeights();
  setBoard();

  const storedTypes = localStorage.getItem("questionTypes");
  if (storedTypes) chess_data.questionTypes = JSON.parse(storedTypes);
  else chess_data.questionTypes = ["p1Checks", "p1Captures", "p2Checks", "p2Captures"];

  document.querySelectorAll('input[name="quizOption"]').forEach((option) => (option.checked = false));
  chess_data.questionTypes.forEach((questionType) => {
    const el = document.querySelector(`input[value="${questionType}"]`);
    if (el) el.checked = true;
  });

setupHighlightButtons();
}

function setPlayerToMove(selected) {
  const el = document.querySelector(`input[value="${selected}"]`);
  if (el) el.checked = true;

  if (selected === "White") chess_data.playerToMove = "w";
  else if (selected === "Black") chess_data.playerToMove = "b";
  else chess_data.playerToMove = Math.random() < 0.5 ? "w" : "b";
}

function setPlayerToMoveAfter() {
  chess_data.playerToMoveAfter =
    chess_data.plyAhead % 2 === 0 ? chess_data.playerToMove : chess_data.playerToMove === "w" ? "b" : "w";
}

function setBoard() {
chess_data.board = Chessboard("board", { position: "start" });
  ensurePieceMarkers();
}

// ----------------------------------------------------------
// Dynamic inputs

// ----------------------------------------------------------
// Dynamic inputs

function createDynamicInputs(questionTypes, doFocus = true) {
  const container = document.getElementById("count-inputs");
  if (!container) return;
  container.innerHTML = "";

  questionTypes.forEach((questionType) => {
    const div = document.createElement("div");
    div.className = "input-group";

    const label = document.createElement("label");
    label.textContent = createDynamicInputsLabel(questionType);

    const input = document.createElement("input");
    input.type = "number";
    input.id = questionType;
    input.name = questionType;
    input.min = "0";
    input.value = 0;
    input.required = true;

    const decrementButton = document.createElement("button");
    decrementButton.type = "button";
    decrementButton.textContent = "←";
    decrementButton.className = "decrement";
    decrementButton.onclick = () => {
      if (parseInt(input.value || "0", 10) > 0)
        input.value = parseInt(input.value || "0", 10) - 1;
    };

    const incrementButton = document.createElement("button");
    incrementButton.type = "button";
    incrementButton.textContent = "→";
    incrementButton.className = "increment";
    incrementButton.onclick = () => {
      input.value = parseInt(input.value || "0", 10) + 1;
    };

    const feedbackIcon = document.createElement("span");
    feedbackIcon.className = "feedbackIcon";
    feedbackIcon.id = `${questionType}FeedbackIcon`;

    const shownMoves = document.createElement("label");
    shownMoves.className = "shownMoves";
    shownMoves.id = `${questionType}ShownMoves`;

    div.appendChild(label);
    div.appendChild(decrementButton);
    div.appendChild(input);
    div.appendChild(incrementButton);
    div.appendChild(feedbackIcon);
    div.appendChild(shownMoves);

    container.appendChild(div);
  });

  // ⚡ Focus automatique sur p1 = joueur ayant le trait
  if (doFocus) focusInputForPlayerToMove();
}

function focusInputForPlayerToMove() {
  const fenTurn = chess_data.playerToMoveAfter; // joueur qui a le trait
  const inputId = qTypeForAbsColorAndKind(fenTurn, "AllLegal", fenTurn); // p1 = trait
  const el = document.getElementById(inputId);
  if (el) el.focus();
}

// ----------------------------------------------------------
// saveSettings corrigée

async function saveSettings() {
  const showTimer = document.getElementById("showTimer").checked;
  chess_data.showTimer = showTimer;
  localStorage.setItem("showTimer", showTimer);
  setTimerVisibility(showTimer);

  const defaultTimeMinutesEl = document.getElementById("defaultTimeMinutes");
  if (defaultTimeMinutesEl) {
    const minutes = parseInt(defaultTimeMinutesEl.value, 10);
    chess_data.defaultTimeRemaining = (isNaN(minutes) ? 3 : minutes) * 60;
    localStorage.setItem("defaultTimeRemaining", chess_data.defaultTimeRemaining);
  }

  const selectedToMove = document.querySelector('input[name="playerToMove"]:checked');
  localStorage.setItem("selectedToMove", selectedToMove.value);
  setPlayerToMove(selectedToMove.value);

  chess_data.games = await getGames();
  chess_data.game_weights = await getWeights();
  setBoard();

  const questionCheckboxes = document.querySelectorAll('input[name="quizOption"]:checked');
  chess_data.questionTypes = Array.from(questionCheckboxes).map((opt) => opt.value);
  localStorage.setItem("questionTypes", JSON.stringify(chess_data.questionTypes));

  // Création des inputs dynamiques avec focus correct sur p1
  createDynamicInputs(getFixedDisplayQuestionTypes());

  setupHighlightButtons();

  const plyAhead = parseInt(document.getElementById("plyAhead").value, 10);
  chess_data.plyAhead = plyAhead;
  localStorage.setItem("plyAhead", plyAhead);

  setPlayerToMoveAfter();

  const settings = document.getElementById("settingsModal");
  if (settings) settings.style.display = "none";
}
  
function createDynamicInputsLabel(questionType) {
let whoColor;
if (questionType.startsWith("p1")) {
  // p1 = joueur à qui c’est le trait → playerToMoveAfter
  whoColor = chess_data.playerToMoveAfter;
} else {
  // p2 = l’autre joueur
  whoColor = chess_data.playerToMoveAfter === "w" ? "b" : "w";
}

  // Nom du joueur pour le label
  const who = whoColor === "w" ? "White's" : "Black's";

  // Type de question
  let what;
  if (questionType.endsWith("Checks")) what = "Checks";
  else if (questionType.endsWith("Captures")) what = "Captures";
  else what = "Moves";

  return `${who}\n${what}:`;
}

// -----------------------------------------------------------
// Main boot

document.addEventListener("DOMContentLoaded", () => {

  // Préchargement audio buzzer
try {
  if (!playBuzz._ctx) {
    playBuzz._ctx = new (window.AudioContext || window.webkitAudioContext)();

    fetch("duck.mp3")
      .then(r => r.arrayBuffer())
      .then(b => playBuzz._ctx.decodeAudioData(b))
      .then(buf => { playBuzz._buffer = buf; })
      .catch(e => console.warn("Audio decode failed:", e));
  }
} catch (e) {
  console.warn("AudioContext creation failed:", e);
}
  
  // Settings modal wiring
  setupSettingsModal();

  const startBtn = document.getElementById("startButton");
  if (startBtn) {
    startBtn.type = "button";
    startBtn.addEventListener("click", startNewGame);
  }

  // Show Answers button wiring
  const btn = document.getElementById("showMovesButton");
  if (btn) {
    btn.type = "button";
    btn.addEventListener("click", revealAnswers);
  }
});

(async () => {
  await loadSettings();
})();
