'use strict';

var createClient = require('@supabase/supabase-js').createClient;

function toGame(row) {
  if (!row) return null;
  return {
    id: row.id,
    whiteId: row.white_id,
    whiteName: row.white_name,
    blackId: row.black_id,
    blackName: row.black_name,
    fen: row.fen,
    turn: row.turn,
    status: row.status,
    result: row.result,
    winnerId: row.winner_id,
    lastMoveSan: row.last_move_san,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMove(row) {
  return {
    id: row.id,
    gameId: row.game_id,
    ply: row.ply,
    color: row.color,
    from: row.from_sq,
    to: row.to_sq,
    promotion: row.promotion,
    san: row.san,
    fenAfter: row.fen_after,
    createdAt: row.created_at,
  };
}

var GAME_COLUMNS = {
  whiteId: 'white_id',
  whiteName: 'white_name',
  blackId: 'black_id',
  blackName: 'black_name',
  fen: 'fen',
  turn: 'turn',
  status: 'status',
  result: 'result',
  winnerId: 'winner_id',
  lastMoveSan: 'last_move_san',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

function toGameRow(fields) {
  var row = {};
  Object.keys(fields).forEach(function (key) {
    var col = GAME_COLUMNS[key] || key;
    row[col] = fields[key];
  });
  return row;
}

function SupabaseStore(config) {
  this.client = createClient(config.url, config.serverKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

SupabaseStore.prototype.createGame = function (game) {
  var row = toGameRow(game);
  return this.client
    .from('games')
    .insert(row)
    .select('*')
    .single()
    .then(function (res) {
      if (res.error) throw new Error(res.error.message);
      return toGame(res.data);
    });
};

SupabaseStore.prototype.getGame = function (id) {
  return this.client
    .from('games')
    .select('*')
    .eq('id', id)
    .maybeSingle()
    .then(function (res) {
      if (res.error) throw new Error(res.error.message);
      return toGame(res.data);
    });
};

SupabaseStore.prototype.listGames = function (filter) {
  filter = filter || {};
  var query = this.client.from('games').select('*');
  if (filter.status) query = query.eq('status', filter.status);
  return query
    .order('created_at', { ascending: false })
    .limit(50)
    .then(function (res) {
      if (res.error) throw new Error(res.error.message);
      return (res.data || []).map(toGame);
    });
};

SupabaseStore.prototype.updateGame = function (id, fields) {
  var row = toGameRow(fields);
  row.updated_at = new Date().toISOString();
  return this.client
    .from('games')
    .update(row)
    .eq('id', id)
    .select('*')
    .single()
    .then(function (res) {
      if (res.error) throw new Error(res.error.message);
      return toGame(res.data);
    });
};

SupabaseStore.prototype.addMove = function (move) {
  var row = {
    game_id: move.gameId,
    ply: move.ply,
    color: move.color,
    from_sq: move.from,
    to_sq: move.to,
    promotion: move.promotion,
    san: move.san,
    fen_after: move.fenAfter,
  };
  return this.client
    .from('moves')
    .insert(row)
    .select('*')
    .single()
    .then(function (res) {
      if (res.error) throw new Error(res.error.message);
      return toMove(res.data);
    });
};

SupabaseStore.prototype.getMoves = function (gameId) {
  return this.client
    .from('moves')
    .select('*')
    .eq('game_id', gameId)
    .order('ply', { ascending: true })
    .then(function (res) {
      if (res.error) throw new Error(res.error.message);
      return (res.data || []).map(toMove);
    });
};

module.exports = SupabaseStore;
