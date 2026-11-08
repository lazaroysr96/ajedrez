'use strict';

/**
 * Store en memoria: permite correr la app sin Supabase (modo desarrollo).
 * Misma interfaz que el store de Supabase.
 */
function MemoryStore() {
  this.games = new Map();
  this.moves = [];
  this.chatMessages = [];
  this.gameKeys = new Map(); // gameId -> Map(playerId, publicKey)
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

// ─────────────────────────────────────────────────────────────
// Chat
// ─────────────────────────────────────────────────────────────

function toChatMessage(row) {
  return {
    id: row.id,
    gameId: row.game_id,
    playerId: row.player_id,
    playerName: row.player_name,
    content: row.content,
    version: row.version,
    nonce: row.nonce,
    createdAt: row.created_at,
  };
}

function toGameKey(row) {
  return {
    gameId: row.game_id,
    playerId: row.player_id,
    publicKey: row.public_key,
    createdAt: row.created_at,
  };
}

MemoryStore.prototype.addGameMessage = function (msg) {
  var row = {
    id: this.chatMessages.length + 1,
    game_id: msg.gameId,
    player_id: msg.playerId,
    player_name: msg.playerName,
    content: msg.content,
    version: msg.version,
    nonce: msg.nonce,
    created_at: msg.createdAt || new Date().toISOString(),
  };
  this.chatMessages.push(row);
  return Promise.resolve(toChatMessage(row));
};

MemoryStore.prototype.getGameMessages = function (gameId, limit) {
  limit = limit || 100;
  var msgs = this.chatMessages
    .filter(function (m) { return m.game_id === gameId; })
    .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); })
    .slice(0, limit)
    .reverse();
  return Promise.resolve(msgs.map(toChatMessage));
};

MemoryStore.prototype.upsertGameKey = function (key) {
  var gameKeys = this.gameKeys.get(key.gameId) || new Map();
  gameKeys.set(key.playerId, key.publicKey);
  this.gameKeys.set(key.gameId, gameKeys);
  var row = {
    game_id: key.gameId,
    player_id: key.playerId,
    public_key: key.publicKey,
    created_at: key.createdAt || new Date().toISOString(),
  };
  return Promise.resolve(toGameKey(row));
};

MemoryStore.prototype.getGameKeys = function (gameId) {
  var gameKeys = this.gameKeys.get(gameId) || new Map();
  var out = [];
  gameKeys.forEach(function (pub, pid) {
    out.push({ game_id: gameId, player_id: pid, public_key: pub, created_at: new Date().toISOString() });
  });
  return Promise.resolve(out.map(toGameKey));
};

module.exports = MemoryStore;
