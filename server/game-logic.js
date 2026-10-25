'use strict';

var engine = require('../public/js/chess-engine.js');
var Chess = engine.Chess;

var START_FEN = Chess.START_FEN;

/**
 * Aplica un movimiento sobre un FEN de forma autoritativa (servidor).
 * Devuelve el nuevo estado o un error si el movimiento es ilegal.
 */
function applyMove(fen, input) {
  var chess = new Chess(fen);
  var move = chess.move(input);
  if (!move) {
    return { ok: false, error: 'Movimiento ilegal' };
  }

  var result = chess.result();
  var winnerId = null;
  return {
    ok: true,
    move: move,
    san: move.san,
    from: engine.algebraic(move.from),
    to: engine.algebraic(move.to),
    fen: chess.fen(),
    turn: chess.turn,
    result: result,
    gameOver: result !== null,
    inCheck: chess.inCheck(),
    checkmate: chess.isCheckmate(),
  };
}

module.exports = {
  Chess: Chess,
  START_FEN: START_FEN,
  applyMove: applyMove,
};
