'use strict';

/**
 * Store en memoria: permite correr la app sin Supabase (modo desarrollo).
 * Misma interfaz que el store de Supabase.
 */
function MemoryStore() {
  this.games = new Map();
  this.moves = [];
}

MemoryStore.prototype.createGame = function (game) {
  this.games.set(game.id, game);
  return Promise.resolve(game);
};

MemoryStore.prototype.getGame = function (id) {
  return Promise.resolve(this.games.get(id) || null);
};

MemoryStore.prototype.listGames = function (filter) {
  filter = filter || {};
  var out = [];
  this.games.forEach(function (g) {
    if (filter.status && g.status !== filter.status) return;
    out.push(g);
  });
  out.sort(function (a, b) {
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  return Promise.resolve(out);
};

MemoryStore.prototype.updateGame = function (id, fields) {
  var game = this.games.get(id);
  if (!game) return Promise.resolve(null);
  Object.assign(game, fields, { updatedAt: new Date().toISOString() });
  return Promise.resolve(game);
};

MemoryStore.prototype.addMove = function (move) {
  this.moves.push(move);
  return Promise.resolve(move);
};

MemoryStore.prototype.getMoves = function (gameId) {
  var out = this.moves.filter(function (m) {
    return m.gameId === gameId;
  });
  out.sort(function (a, b) {
    return a.ply - b.ply;
  });
  return Promise.resolve(out);
};

module.exports = MemoryStore;
