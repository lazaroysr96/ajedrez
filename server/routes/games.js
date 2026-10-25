'use strict';

var express = require('express');
var crypto = require('crypto');
var gameLogic = require('../game-logic');

var START_FEN = gameLogic.START_FEN;

// Identificador reservado para la computadora (Stockfish en el navegador).
var BOT_ID = 'bot';
var BOT_NAME = 'Computadora';

function cleanName(name, fallback) {
  var value = String(name || '').trim().slice(0, 24);
  return value || fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function createGameRoutes(store) {
  var router = express.Router();

  // Crear una partida (queda esperando rival).
  router.post('/games', function (req, res, next) {
    var body = req.body || {};
    var playerId = String(body.playerId || '').trim();
    if (!playerId) return res.status(400).json({ error: 'playerId requerido' });

    var playerName = cleanName(body.playerName, 'Jugador');
    var color = body.color;
    if (color !== 'w' && color !== 'b') {
      color = Math.random() < 0.5 ? 'w' : 'b';
    }

    var game = {
      id: crypto.randomUUID(),
      whiteId: color === 'w' ? playerId : null,
      whiteName: color === 'w' ? playerName : null,
      blackId: color === 'b' ? playerId : null,
      blackName: color === 'b' ? playerName : null,
      fen: START_FEN,
      turn: 'w',
      status: 'waiting',
      result: null,
      winnerId: null,
      lastMoveSan: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    store
      .createGame(game)
      .then(function (created) {
        res.status(201).json({ game: created });
      })
      .catch(next);
  });

  // Crear una partida contra la computadora (queda activa de inmediato).
  // El movimiento del bot lo calcula Stockfish en el navegador y se envia
  // con playerId = BOT_ID al endpoint de movimientos.
  router.post('/games/vs-ai', function (req, res, next) {
    var body = req.body || {};
    var playerId = String(body.playerId || '').trim();
    if (!playerId) return res.status(400).json({ error: 'playerId requerido' });

    var playerName = cleanName(body.playerName, 'Jugador');
    var color = body.color;
    if (color !== 'w' && color !== 'b') {
      color = Math.random() < 0.5 ? 'w' : 'b';
    }
    var humanIsWhite = color === 'w';

    var game = {
      id: crypto.randomUUID(),
      whiteId: humanIsWhite ? playerId : BOT_ID,
      whiteName: humanIsWhite ? playerName : BOT_NAME,
      blackId: humanIsWhite ? BOT_ID : playerId,
      blackName: humanIsWhite ? BOT_NAME : playerName,
      fen: START_FEN,
      turn: 'w',
      status: 'active',
      result: null,
      winnerId: null,
      lastMoveSan: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    store
      .createGame(game)
      .then(function (created) {
        res.status(201).json({ game: created });
      })
      .catch(next);
  });

  // Listar partidas (por defecto las que esperan rival).
  router.get('/games', function (req, res, next) {
    var status = req.query.status || 'waiting';
    store
      .listGames({ status: status })
      .then(function (games) {
        res.json({ games: games });
      })
      .catch(next);
  });

  // Estado completo de una partida (game + movimientos).
  router.get('/games/:id', function (req, res, next) {
    store
      .getGame(req.params.id)
      .then(function (game) {
        if (!game) return res.status(404).json({ error: 'Partida no encontrada' });
        return store.getMoves(game.id).then(function (moves) {
          res.json({ game: game, moves: moves });
        });
      })
      .catch(next);
  });

  router.get('/games/:id/moves', function (req, res, next) {
    store
      .getMoves(req.params.id)
      .then(function (moves) {
        res.json({ moves: moves });
      })
      .catch(next);
  });

  // Unirse a una partida que espera rival.
  router.post('/games/:id/join', function (req, res, next) {
    var body = req.body || {};
    var playerId = String(body.playerId || '').trim();
    if (!playerId) return res.status(400).json({ error: 'playerId requerido' });
    var playerName = cleanName(body.playerName, 'Jugador');

    store
      .getGame(req.params.id)
      .then(function (game) {
        if (!game) return res.status(404).json({ error: 'Partida no encontrada' });

        if (game.whiteId === playerId || game.blackId === playerId) {
          return res.json({ game: game });
        }
        if (game.whiteId && game.blackId) {
          return res.status(409).json({ error: 'La partida ya esta completa' });
        }

        var fields = {};
        if (!game.whiteId) {
          fields.whiteId = playerId;
          fields.whiteName = playerName;
        } else {
          fields.blackId = playerId;
          fields.blackName = playerName;
        }
        fields.status = 'active';

        return store.updateGame(game.id, fields).then(function (updated) {
          res.json({ game: updated });
        });
      })
      .catch(next);
  });

  // Realizar un movimiento (validado en el servidor).
  router.post('/games/:id/move', function (req, res, next) {
    var body = req.body || {};
    var playerId = String(body.playerId || '').trim();
    if (!playerId) return res.status(400).json({ error: 'playerId requerido' });
    if (!body.from || !body.to) return res.status(400).json({ error: 'from y to requeridos' });

    store
      .getGame(req.params.id)
      .then(function (game) {
        if (!game) return res.status(404).json({ error: 'Partida no encontrada' });
        if (game.status !== 'active') {
          return res.status(409).json({ error: 'La partida no esta activa' });
        }

        var color = game.whiteId === playerId ? 'w' : game.blackId === playerId ? 'b' : null;
        if (!color) return res.status(403).json({ error: 'No participas en esta partida' });
        if (color !== game.turn) return res.status(409).json({ error: 'No es tu turno' });

        var applied = gameLogic.applyMove(game.fen, {
          from: body.from,
          to: body.to,
          promotion: body.promotion,
        });
        if (!applied.ok) return res.status(400).json({ error: applied.error });

        return store.getMoves(game.id).then(function (moves) {
          var ply = moves.length + 1;
          var move = {
            gameId: game.id,
            ply: ply,
            color: color,
            from: applied.from,
            to: applied.to,
            promotion: applied.move.promotion || null,
            san: applied.san,
            fenAfter: applied.fen,
            createdAt: nowIso(),
          };

          var updates = {
            fen: applied.fen,
            turn: applied.turn,
            lastMoveSan: applied.san,
          };
          if (applied.gameOver) {
            updates.status = 'finished';
            updates.result = applied.result;
            if (applied.result === 'white') updates.winnerId = game.whiteId;
            else if (applied.result === 'black') updates.winnerId = game.blackId;
          }

          return store
            .addMove(move)
            .then(function () {
              return store.updateGame(game.id, updates);
            })
            .then(function (updated) {
              res.json({
                game: updated,
                move: move,
                check: applied.inCheck,
                checkmate: applied.checkmate,
              });
            });
        });
      })
      .catch(next);
  });

  // Rendirse.
  router.post('/games/:id/resign', function (req, res, next) {
    var body = req.body || {};
    var playerId = String(body.playerId || '').trim();
    if (!playerId) return res.status(400).json({ error: 'playerId requerido' });

    store
      .getGame(req.params.id)
      .then(function (game) {
        if (!game) return res.status(404).json({ error: 'Partida no encontrada' });
        if (game.status === 'finished') return res.json({ game: game });

        var color = game.whiteId === playerId ? 'w' : game.blackId === playerId ? 'b' : null;
        if (!color) return res.status(403).json({ error: 'No participas en esta partida' });

        var updates = {
          status: 'finished',
          result: color === 'w' ? 'black' : 'white',
          winnerId: color === 'w' ? game.blackId : game.whiteId,
        };

        return store.updateGame(game.id, updates).then(function (updated) {
          res.json({ game: updated });
        });
      })
      .catch(next);
  });

  return router;
}

module.exports = createGameRoutes;
