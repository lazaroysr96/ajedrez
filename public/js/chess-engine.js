/**
 * Motor de ajedrez (reglas completas) reutilizable en Node y en el navegador.
 *
 * Representacion interna: tablero 0x88 (128 casillas). Cada casilla valida
 * cumple (sq & 0x88) === 0. rank 0 = fila 8 (arriba), file 0 = columna 'a'.
 * Piezas en mayuscula = blancas, minuscula = negras.
 *
 * Se expone como global `ChessEngine` en el navegador y como module.exports
 * en Node. Ademas siempre se asigna a globalThis para poder importarlo desde
 * Deno (Edge Functions) como modulo con efectos secundarios.
 */
(function (factory) {
  var engine = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = engine;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.ChessEngine = engine;
  }
})(function () {
  'use strict';

  var WHITE = 'w';
  var BLACK = 'b';
  var START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  var KNIGHT_OFFSETS = [-18, -33, -31, -14, 18, 33, 31, 14];
  var BISHOP_OFFSETS = [-17, -15, 17, 15];
  var ROOK_OFFSETS = [-16, 1, 16, -1];
  var KING_OFFSETS = [-17, -16, -15, 1, 17, 16, 15, -1];

  function opposite(color) {
    return color === WHITE ? BLACK : WHITE;
  }

  function colorOf(pc) {
    if (!pc) return null;
    return pc === pc.toUpperCase() ? WHITE : BLACK;
  }

  function typeOf(pc) {
    return pc ? pc.toLowerCase() : null;
  }

  function sqFile(sq) {
    return sq & 15;
  }

  function sqRank(sq) {
    return sq >> 4;
  }

  function algebraic(sq) {
    return String.fromCharCode(97 + (sq & 15)) + (8 - (sq >> 4));
  }

  function fromAlgebraic(s) {
    var file = s.charCodeAt(0) - 97;
    var rank = 8 - parseInt(s[1], 10);
    return rank * 16 + file;
  }

  var VALID_SQUARES = (function () {
    var out = [];
    for (var sq = 0; sq < 128; sq++) {
      if ((sq & 0x88) === 0) out.push(sq);
    }
    return out;
  })();

  function makeMove(from, to, piece, captured, flags, promotion) {
    return {
      from: from,
      to: to,
      piece: piece,
      captured: captured || null,
      flags: flags || 'n',
      promotion: promotion || null,
    };
  }

  function Chess(fen) {
    this.load(fen || START_FEN);
  }

  Chess.START_FEN = START_FEN;
  Chess.WHITE = WHITE;
  Chess.BLACK = BLACK;

  Chess.prototype.load = function (fen) {
    var parts = String(fen).trim().split(/\s+/);
    var board = new Array(128);
    for (var i = 0; i < 128; i++) board[i] = null;

    var sq = 0;
    var placement = parts[0];
    for (var c = 0; c < placement.length; c++) {
      var ch = placement[c];
      if (ch === '/') {
        sq += 8;
      } else if (ch >= '1' && ch <= '8') {
        sq += parseInt(ch, 10);
      } else {
        board[sq] = ch;
        sq++;
      }
    }

    this.board = board;
    this.turn = parts[1] === BLACK ? BLACK : WHITE;
    var castling = parts[2] || '-';
    this.castling = {
      wk: castling.indexOf('K') !== -1,
      wq: castling.indexOf('Q') !== -1,
      bk: castling.indexOf('k') !== -1,
      bq: castling.indexOf('q') !== -1,
    };
    this.ep = parts[3] && parts[3] !== '-' ? fromAlgebraic(parts[3]) : -1;
    this.halfMoves = parts[4] ? parseInt(parts[4], 10) : 0;
    this.moveNumber = parts[5] ? parseInt(parts[5], 10) : 1;
    this.history = [];
    return this;
  };

  Chess.prototype.fen = function () {
    var out = '';
    for (var rank = 0; rank < 8; rank++) {
      var empty = 0;
      for (var file = 0; file < 8; file++) {
        var pc = this.board[rank * 16 + file];
        if (pc) {
          if (empty) {
            out += empty;
            empty = 0;
          }
          out += pc;
        } else {
          empty++;
        }
      }
      if (empty) out += empty;
      if (rank < 7) out += '/';
    }

    var castling = '';
    if (this.castling.wk) castling += 'K';
    if (this.castling.wq) castling += 'Q';
    if (this.castling.bk) castling += 'k';
    if (this.castling.bq) castling += 'q';
    if (!castling) castling = '-';

    var ep = this.ep >= 0 ? algebraic(this.ep) : '-';
    return (
      out + ' ' + this.turn + ' ' + castling + ' ' + ep + ' ' + this.halfMoves + ' ' + this.moveNumber
    );
  };

  Chess.prototype.get = function (square) {
    var sq = typeof square === 'string' ? fromAlgebraic(square) : square;
    if ((sq & 0x88) !== 0) return null;
    return this.board[sq] || null;
  };

  Chess.prototype.getBoard = function () {
    var rows = [];
    for (var rank = 0; rank < 8; rank++) {
      var row = [];
      for (var file = 0; file < 8; file++) {
        row.push(this.board[rank * 16 + file] || null);
      }
      rows.push(row);
    }
    return rows;
  };

  Chess.prototype.kingSquare = function (color) {
    var king = color === WHITE ? 'K' : 'k';
    for (var i = 0; i < VALID_SQUARES.length; i++) {
      if (this.board[VALID_SQUARES[i]] === king) return VALID_SQUARES[i];
    }
    return -1;
  };

  Chess.prototype.attacked = function (color, sq) {
    var board = this.board;

    var pawn = color === WHITE ? 'P' : 'p';
    var pawnOffsets = color === WHITE ? [15, 17] : [-15, -17];
    for (var i = 0; i < pawnOffsets.length; i++) {
      var ps = sq + pawnOffsets[i];
      if ((ps & 0x88) === 0 && board[ps] === pawn) return true;
    }

    var knight = color === WHITE ? 'N' : 'n';
    for (i = 0; i < KNIGHT_OFFSETS.length; i++) {
      var ns = sq + KNIGHT_OFFSETS[i];
      if ((ns & 0x88) === 0 && board[ns] === knight) return true;
    }

    var king = color === WHITE ? 'K' : 'k';
    for (i = 0; i < KING_OFFSETS.length; i++) {
      var ks = sq + KING_OFFSETS[i];
      if ((ks & 0x88) === 0 && board[ks] === king) return true;
    }

    var bishop = color === WHITE ? 'B' : 'b';
    var rook = color === WHITE ? 'R' : 'r';
    var queen = color === WHITE ? 'Q' : 'q';

    for (i = 0; i < BISHOP_OFFSETS.length; i++) {
      var off = BISHOP_OFFSETS[i];
      var s = sq + off;
      while ((s & 0x88) === 0) {
        var pc = board[s];
        if (pc) {
          if (pc === bishop || pc === queen) return true;
          break;
        }
        s += off;
      }
    }

    for (i = 0; i < ROOK_OFFSETS.length; i++) {
      off = ROOK_OFFSETS[i];
      s = sq + off;
      while ((s & 0x88) === 0) {
        pc = board[s];
        if (pc) {
          if (pc === rook || pc === queen) return true;
          break;
        }
        s += off;
      }
    }

    return false;
  };

  Chess.prototype.inCheck = function () {
    var color = this.turn;
    return this.attacked(opposite(color), this.kingSquare(color));
  };

  Chess.prototype.addPawnMove = function (moves, from, to, piece, captured, promoRank) {
    if (sqRank(to) === promoRank) {
      var promotions = ['q', 'r', 'b', 'n'];
      for (var i = 0; i < promotions.length; i++) {
        moves.push(makeMove(from, to, piece, captured, captured ? 'c' : 'n', promotions[i]));
      }
    } else {
      moves.push(makeMove(from, to, piece, captured, captured ? 'c' : 'n', null));
    }
  };

  Chess.prototype.addCastlingMoves = function (moves, kingSq, us, them) {
    var board = this.board;
    if (us === WHITE && kingSq === fromAlgebraic('e1')) {
      if (
        this.castling.wk &&
        !board[fromAlgebraic('f1')] &&
        !board[fromAlgebraic('g1')] &&
        !this.attacked(them, fromAlgebraic('e1')) &&
        !this.attacked(them, fromAlgebraic('f1')) &&
        !this.attacked(them, fromAlgebraic('g1'))
      ) {
        moves.push(makeMove(kingSq, fromAlgebraic('g1'), 'K', null, 'k', null));
      }
      if (
        this.castling.wq &&
        !board[fromAlgebraic('d1')] &&
        !board[fromAlgebraic('c1')] &&
        !board[fromAlgebraic('b1')] &&
        !this.attacked(them, fromAlgebraic('e1')) &&
        !this.attacked(them, fromAlgebraic('d1')) &&
        !this.attacked(them, fromAlgebraic('c1'))
      ) {
        moves.push(makeMove(kingSq, fromAlgebraic('c1'), 'K', null, 'q', null));
      }
    } else if (us === BLACK && kingSq === fromAlgebraic('e8')) {
      if (
        this.castling.bk &&
        !board[fromAlgebraic('f8')] &&
        !board[fromAlgebraic('g8')] &&
        !this.attacked(them, fromAlgebraic('e8')) &&
        !this.attacked(them, fromAlgebraic('f8')) &&
        !this.attacked(them, fromAlgebraic('g8'))
      ) {
        moves.push(makeMove(kingSq, fromAlgebraic('g8'), 'k', null, 'k', null));
      }
      if (
        this.castling.bq &&
        !board[fromAlgebraic('d8')] &&
        !board[fromAlgebraic('c8')] &&
        !board[fromAlgebraic('b8')] &&
        !this.attacked(them, fromAlgebraic('e8')) &&
        !this.attacked(them, fromAlgebraic('d8')) &&
        !this.attacked(them, fromAlgebraic('c8'))
      ) {
        moves.push(makeMove(kingSq, fromAlgebraic('c8'), 'k', null, 'q', null));
      }
    }
  };

  Chess.prototype.generatePseudoMoves = function (options) {
    options = options || {};
    var moves = [];
    var us = this.turn;
    var them = opposite(us);
    var board = this.board;

    var squares;
    if (options.square != null) {
      squares = [typeof options.square === 'string' ? fromAlgebraic(options.square) : options.square];
    } else {
      squares = VALID_SQUARES;
    }

    for (var idx = 0; idx < squares.length; idx++) {
      var sq = squares[idx];
      var pc = board[sq];
      if (!pc || colorOf(pc) !== us) continue;
      var t = typeOf(pc);

      if (t === 'p') {
        var dir = us === WHITE ? -16 : 16;
        var startRank = us === WHITE ? 6 : 1;
        var promoRank = us === WHITE ? 0 : 7;

        var one = sq + dir;
        if ((one & 0x88) === 0 && !board[one]) {
          this.addPawnMove(moves, sq, one, pc, null, promoRank);
          var two = sq + 2 * dir;
          if (sqRank(sq) === startRank && (two & 0x88) === 0 && !board[two]) {
            moves.push(makeMove(sq, two, pc, null, 'b', null));
          }
        }

        var caps = [dir - 1, dir + 1];
        for (var ci = 0; ci < caps.length; ci++) {
          var cs = sq + caps[ci];
          if ((cs & 0x88) !== 0) continue;
          if (board[cs] && colorOf(board[cs]) === them) {
            this.addPawnMove(moves, sq, cs, pc, board[cs], promoRank);
          } else if (cs === this.ep) {
            moves.push(makeMove(sq, cs, pc, null, 'e', null));
          }
        }
      } else if (t === 'n' || t === 'k') {
        var offsets = t === 'n' ? KNIGHT_OFFSETS : KING_OFFSETS;
        for (var oi = 0; oi < offsets.length; oi++) {
          var ts = sq + offsets[oi];
          if ((ts & 0x88) !== 0) continue;
          if (!board[ts]) moves.push(makeMove(sq, ts, pc, null, 'n', null));
          else if (colorOf(board[ts]) === them) moves.push(makeMove(sq, ts, pc, board[ts], 'c', null));
        }
        if (t === 'k') this.addCastlingMoves(moves, sq, us, them);
      } else {
        var slides = t === 'b' ? BISHOP_OFFSETS : t === 'r' ? ROOK_OFFSETS : KING_OFFSETS;
        for (var si = 0; si < slides.length; si++) {
          var off = slides[si];
          var s = sq + off;
          while ((s & 0x88) === 0) {
            if (!board[s]) {
              moves.push(makeMove(sq, s, pc, null, 'n', null));
            } else {
              if (colorOf(board[s]) === them) moves.push(makeMove(sq, s, pc, board[s], 'c', null));
              break;
            }
            s += off;
          }
        }
      }
    }

    return moves;
  };

  Chess.prototype.generateMoves = function (options) {
    options = options || {};
    var pseudo = this.generatePseudoMoves(options);
    if (options.legal === false) return pseudo;

    var us = this.turn;
    var legal = [];
    for (var i = 0; i < pseudo.length; i++) {
      this.applyMove(pseudo[i]);
      if (!this.attacked(opposite(us), this.kingSquare(us))) {
        legal.push(pseudo[i]);
      }
      this.undo();
    }
    return legal;
  };

  Chess.prototype.applyMove = function (move) {
    var us = this.turn;
    var them = opposite(us);
    var board = this.board;

    var state = {
      move: move,
      castling: {
        wk: this.castling.wk,
        wq: this.castling.wq,
        bk: this.castling.bk,
        bq: this.castling.bq,
      },
      ep: this.ep,
      halfMoves: this.halfMoves,
      moveNumber: this.moveNumber,
      turn: this.turn,
    };

    var captured = move.captured;
    var piece = move.piece;
    board[move.from] = null;

    if (move.flags === 'e') {
      var capSq = move.to + (us === WHITE ? 16 : -16);
      captured = board[capSq];
      board[capSq] = null;
    }

    if (move.promotion) {
      board[move.to] = us === WHITE ? move.promotion.toUpperCase() : move.promotion.toLowerCase();
    } else {
      board[move.to] = piece;
    }

    if (move.flags === 'k') {
      if (us === WHITE) {
        board[fromAlgebraic('f1')] = board[fromAlgebraic('h1')];
        board[fromAlgebraic('h1')] = null;
      } else {
        board[fromAlgebraic('f8')] = board[fromAlgebraic('h8')];
        board[fromAlgebraic('h8')] = null;
      }
    } else if (move.flags === 'q') {
      if (us === WHITE) {
        board[fromAlgebraic('d1')] = board[fromAlgebraic('a1')];
        board[fromAlgebraic('a1')] = null;
      } else {
        board[fromAlgebraic('d8')] = board[fromAlgebraic('a8')];
        board[fromAlgebraic('a8')] = null;
      }
    }

    var t = typeOf(piece);
    if (t === 'k') {
      if (us === WHITE) {
        this.castling.wk = false;
        this.castling.wq = false;
      } else {
        this.castling.bk = false;
        this.castling.bq = false;
      }
    }
    if (move.from === fromAlgebraic('a1') || move.to === fromAlgebraic('a1')) this.castling.wq = false;
    if (move.from === fromAlgebraic('h1') || move.to === fromAlgebraic('h1')) this.castling.wk = false;
    if (move.from === fromAlgebraic('a8') || move.to === fromAlgebraic('a8')) this.castling.bq = false;
    if (move.from === fromAlgebraic('h8') || move.to === fromAlgebraic('h8')) this.castling.bk = false;

    if (move.flags === 'b') {
      this.ep = move.from + (us === WHITE ? -16 : 16);
    } else {
      this.ep = -1;
    }

    if (t === 'p' || captured) this.halfMoves = 0;
    else this.halfMoves++;

    if (us === BLACK) this.moveNumber++;
    this.turn = them;

    move.capturedPiece = captured;
    state.capturedPiece = captured;
    this.history.push(state);
    return this;
  };

  Chess.prototype.undo = function () {
    var state = this.history.pop();
    if (!state) return null;

    var move = state.move;
    var us = state.turn;
    var board = this.board;

    board[move.from] = move.piece;
    board[move.to] = null;

    if (move.flags === 'e') {
      var capSq = move.to + (us === WHITE ? 16 : -16);
      board[capSq] = state.capturedPiece;
    } else if (move.captured) {
      board[move.to] = move.captured;
    }

    if (move.flags === 'k') {
      if (us === WHITE) {
        board[fromAlgebraic('h1')] = board[fromAlgebraic('f1')];
        board[fromAlgebraic('f1')] = null;
      } else {
        board[fromAlgebraic('h8')] = board[fromAlgebraic('f8')];
        board[fromAlgebraic('f8')] = null;
      }
    } else if (move.flags === 'q') {
      if (us === WHITE) {
        board[fromAlgebraic('a1')] = board[fromAlgebraic('d1')];
        board[fromAlgebraic('d1')] = null;
      } else {
        board[fromAlgebraic('a8')] = board[fromAlgebraic('d8')];
        board[fromAlgebraic('d8')] = null;
      }
    }

    this.castling = state.castling;
    this.ep = state.ep;
    this.halfMoves = state.halfMoves;
    this.moveNumber = state.moveNumber;
    this.turn = state.turn;
    return move;
  };

  Chess.prototype.findLegalMove = function (input) {
    var from = typeof input.from === 'string' ? fromAlgebraic(input.from) : input.from;
    var to = typeof input.to === 'string' ? fromAlgebraic(input.to) : input.to;
    var wanted = input.promotion ? String(input.promotion).toLowerCase() : 'q';
    var legal = this.generateMoves();
    for (var i = 0; i < legal.length; i++) {
      var m = legal[i];
      if (m.from !== from || m.to !== to) continue;
      if (m.promotion) {
        if (m.promotion === wanted) return m;
      } else {
        return m;
      }
    }
    return null;
  };

  Chess.prototype.baseSan = function (move) {
    var t = typeOf(move.piece);
    if (move.flags === 'k') return 'O-O';
    if (move.flags === 'q') return 'O-O-O';

    if (t === 'p') {
      var s = '';
      if (move.flags === 'c' || move.flags === 'e') {
        s += String.fromCharCode(97 + sqFile(move.from)) + 'x';
      }
      s += algebraic(move.to);
      if (move.promotion) s += '=' + move.promotion.toUpperCase();
      return s;
    }

    var all = this.generateMoves();
    var sameDest = [];
    for (var i = 0; i < all.length; i++) {
      var m = all[i];
      if (m.to === move.to && typeOf(m.piece) === t && m.from !== move.from) sameDest.push(m);
    }
    var disamb = '';
    if (sameDest.length) {
      var sameFile = false;
      var sameRank = false;
      for (i = 0; i < sameDest.length; i++) {
        if (sqFile(sameDest[i].from) === sqFile(move.from)) sameFile = true;
        if (sqRank(sameDest[i].from) === sqRank(move.from)) sameRank = true;
      }
      if (!sameFile) disamb = String.fromCharCode(97 + sqFile(move.from));
      else if (!sameRank) disamb = String(8 - sqRank(move.from));
      else disamb = algebraic(move.from);
    }
    return t.toUpperCase() + disamb + (move.captured ? 'x' : '') + algebraic(move.to);
  };

  Chess.prototype.move = function (input) {
    var chosen = this.findLegalMove(input);
    if (!chosen) return null;
    var san = this.baseSan(chosen);
    this.applyMove(chosen);
    if (this.inCheck()) {
      san += this.generateMoves().length === 0 ? '#' : '+';
    }
    chosen.san = san;
    return chosen;
  };

  Chess.prototype.isCheckmate = function () {
    if (!this.inCheck()) return false;
    return this.generateMoves().length === 0;
  };

  Chess.prototype.isStalemate = function () {
    if (this.inCheck()) return false;
    return this.generateMoves().length === 0;
  };

  Chess.prototype.isInsufficientMaterial = function () {
    var pieces = [];
    for (var i = 0; i < VALID_SQUARES.length; i++) {
      var pc = this.board[VALID_SQUARES[i]];
      if (pc && typeOf(pc) !== 'k') pieces.push(pc);
    }
    if (pieces.length === 0) return true;
    if (pieces.length === 1) {
      var t = typeOf(pieces[0]);
      return t === 'n' || t === 'b';
    }
    if (pieces.length === 2) {
      var a = typeOf(pieces[0]);
      var b = typeOf(pieces[1]);
      if (a === 'b' && b === 'b') {
        var colorA = null;
        var colorB = null;
        var squareA = null;
        var squareB = null;
        for (i = 0; i < VALID_SQUARES.length; i++) {
          var p = this.board[VALID_SQUARES[i]];
          if (!p) continue;
          if (typeOf(p) === 'b') {
            if (squareA == null) {
              squareA = VALID_SQUARES[i];
              colorA = (sqFile(VALID_SQUARES[i]) + sqRank(VALID_SQUARES[i])) % 2;
            } else {
              squareB = VALID_SQUARES[i];
              colorB = (sqFile(VALID_SQUARES[i]) + sqRank(VALID_SQUARES[i])) % 2;
            }
          }
        }
        return colorA === colorB;
      }
    }
    return false;
  };

  Chess.prototype.isFiftyMove = function () {
    return this.halfMoves >= 100;
  };

  Chess.prototype.isDraw = function () {
    return this.isStalemate() || this.isInsufficientMaterial() || this.isFiftyMove();
  };

  Chess.prototype.isGameOver = function () {
    return this.isCheckmate() || this.isDraw();
  };

  Chess.prototype.result = function () {
    if (this.isCheckmate()) return this.turn === WHITE ? 'black' : 'white';
    if (this.isDraw()) return 'draw';
    return null;
  };

  Chess.prototype.turnColor = function () {
    return this.turn;
  };

  Chess.prototype.moves = function (options) {
    return this.generateMoves(options);
  };

  return {
    Chess: Chess,
    START_FEN: START_FEN,
    WHITE: WHITE,
    BLACK: BLACK,
    algebraic: algebraic,
    fromAlgebraic: fromAlgebraic,
    opposite: opposite,
    colorOf: colorOf,
    typeOf: typeOf,
  };
});
