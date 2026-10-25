'use strict';

var assert = require('assert');
var engine = require('../public/js/chess-engine.js');
var Chess = engine.Chess;

var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (err) {
    failed++;
    console.error('  FAIL ' + name);
    console.error('       ' + err.message);
  }
}

function play(fen, moves) {
  var chess = new Chess(fen);
  moves.forEach(function (m) {
    var res = chess.move(m);
    assert.ok(res, 'movimiento ilegal inesperado: ' + JSON.stringify(m) + ' en ' + fen);
  });
  return chess;
}

console.log('Motor de ajedrez - pruebas\n');

test('posicion inicial valida y 20 movimientos legales', function () {
  var chess = new Chess();
  assert.strictEqual(chess.fen(), Chess.START_FEN);
  assert.strictEqual(chess.generateMoves().length, 20);
});

test('peon avanza una y dos casillas', function () {
  var chess = new Chess();
  assert.ok(chess.move({ from: 'e2', to: 'e4' }));
  assert.ok(chess.move({ from: 'e7', to: 'e5' }));
  assert.strictEqual(chess.get('e4'), 'P');
  assert.strictEqual(chess.get('e5'), 'p');
  assert.strictEqual(chess.turn, 'w');
});

test('no permite mover pieza del rival', function () {
  var chess = new Chess();
  assert.strictEqual(chess.move({ from: 'e7', to: 'e5' }), null);
});

test('captura al paso (en passant)', function () {
  var chess = play(Chess.START_FEN, [
    { from: 'e2', to: 'e4' },
    { from: 'a7', to: 'a6' },
    { from: 'e4', to: 'e5' },
    { from: 'd7', to: 'd5' },
  ]);
  var move = chess.move({ from: 'e5', to: 'd6' });
  assert.ok(move, 'deberia permitir captura al paso');
  assert.strictEqual(move.flags, 'e');
  assert.strictEqual(chess.get('d5'), null);
  assert.strictEqual(chess.get('d6'), 'P');
});

test('enroque corto blancas', function () {
  var chess = play('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', [{ from: 'e1', to: 'g1' }]);
  assert.strictEqual(chess.get('g1'), 'K');
  assert.strictEqual(chess.get('f1'), 'R');
  assert.strictEqual(chess.get('h1'), null);
});

test('enroque largo blancas', function () {
  var chess = play('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', [{ from: 'e1', to: 'c1' }]);
  assert.strictEqual(chess.get('c1'), 'K');
  assert.strictEqual(chess.get('d1'), 'R');
  assert.strictEqual(chess.get('a1'), null);
});

test('no permite enrocar a traves de jaque', function () {
  var chess = new Chess('r3k2r/8/8/8/8/8/6r1/R3K2R w KQkq - 0 1');
  var move = chess.move({ from: 'e1', to: 'g1' });
  assert.strictEqual(move, null, 'no deberia permitir enroque con f1 atacada');
});

test('promocion a dama', function () {
  var chess = play('8/P7/8/8/8/8/8/k6K w - - 0 1', [{ from: 'a7', to: 'a8', promotion: 'q' }]);
  assert.strictEqual(chess.get('a8'), 'Q');
});

test('jaque mate pastor (Scholar mate)', function () {
  var chess = play(Chess.START_FEN, [
    { from: 'e2', to: 'e4' },
    { from: 'e7', to: 'e5' },
    { from: 'd1', to: 'h5' },
    { from: 'b8', to: 'c6' },
    { from: 'f1', to: 'c4' },
    { from: 'g8', to: 'f6' },
    { from: 'h5', to: 'f7' },
  ]);
  assert.ok(chess.isCheckmate(), 'deberia ser jaque mate');
  assert.strictEqual(chess.result(), 'white');
  assert.strictEqual(chess.move({ from: 'e8', to: 'e7' }), null);
});

test('ahogado (stalemate)', function () {
  var chess = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.ok(!chess.inCheck(), 'el rey negro no esta en jaque');
  assert.ok(chess.isStalemate(), 'deberia ser ahogado');
  assert.strictEqual(chess.result(), 'draw');
});

test('material insuficiente (rey vs rey)', function () {
  var chess = new Chess('8/8/4k3/8/8/4K3/8/8 w - - 0 1');
  assert.ok(chess.isInsufficientMaterial());
  assert.strictEqual(chess.result(), 'draw');
});

test('regla de 50 movimientos', function () {
  var chess = new Chess('8/8/4k3/8/8/4K3/8/7R w - - 100 1');
  assert.ok(chess.isFiftyMove());
  assert.strictEqual(chess.result(), 'draw');
});

test('SAN con desambiguacion y jaque', function () {
  var chess = play(Chess.START_FEN, [
    { from: 'e2', to: 'e4' },
    { from: 'e7', to: 'e5' },
    { from: 'g1', to: 'f3' },
    { from: 'b8', to: 'c6' },
    { from: 'f1', to: 'b5' },
  ]);
  assert.strictEqual(chess.history[4].move.san, 'Bb5');
});

test('san de captura con peon', function () {
  var chess = play(Chess.START_FEN, [
    { from: 'e2', to: 'e4' },
    { from: 'd7', to: 'd5' },
  ]);
  var move = chess.move({ from: 'e4', to: 'd5' });
  assert.strictEqual(move.san, 'exd5');
});

test('undo restaura la posicion exacta', function () {
  var chess = new Chess();
  var before = chess.fen();
  chess.move({ from: 'e2', to: 'e4' });
  chess.undo();
  assert.strictEqual(chess.fen(), before);
});

test('no se puede mover una pieza clavada (rey quedaria en jaque)', function () {
  var chess = new Chess('4r2k/8/8/8/8/8/4R3/4K3 w - - 0 1');
  assert.strictEqual(chess.move({ from: 'e2', to: 'a2' }), null);
  assert.ok(chess.move({ from: 'e2', to: 'e8' }), 'la torre si puede capturar la torre que da jaque');
});

console.log('\nResultado: ' + passed + ' ok, ' + failed + ' fallidos');
process.exit(failed === 0 ? 0 : 1);
