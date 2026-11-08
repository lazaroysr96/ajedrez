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

  // ─────────────────────────────────────────────────────────────
  // Chat
  // ─────────────────────────────────────────────────────────────

  function isParticipant(game, playerId) {
    return game.whiteId === playerId || game.blackId === playerId;
  }

  function cleanMessage(text) {
    return String(text || '').trim().slice(0, 500);
  }

  // Obtener mensajes de una partida
  router.get('/games/:id/messages', function (req, res, next) {
    var limit = Math.min(parseInt(req.query.limit) || 100, 200);
    store
      .getGame(req.params.id)
      .then(function (game) {
        if (!game) return res.status(404).json({ error: 'Partida no encontrada' });
        var playerId = String(req.query.playerId || '').trim();
        if (playerId && !isParticipant(game, playerId)) {
          return res.status(403).json({ error: 'No participas en esta partida' });
        }
        return store.getGameMessages(req.params.id, limit);
      })
      .then(function (messages) {
        res.json({ messages: messages });
      })
      .catch(next);
  });

  // Enviar mensaje
  router.post('/games/:id/messages', function (req, res, next) {
    var body = req.body || {};
    var playerId = String(body.playerId || '').trim();
    var playerName = cleanName(body.playerName, 'Jugador');
    var content = String(body.content || '');
    var version = body.version === 1 ? 1 : 0;
    var nonce = version === 1 ? String(body.nonce || '') : null;

    if (!playerId) return res.status(400).json({ error: 'playerId requerido' });
    if (!content) return res.status(400).json({ error: 'Contenido requerido' });
    if (version === 1 && !nonce) return res.status(400).json({ error: 'Nonce requerido para mensajes cifrados' });
    if (content.length > 2000) return res.status(400).json({ error: 'Mensaje demasiado largo' });

    store
      .getGame(req.params.id)
      .then(function (game) {
        if (!game) return res.status(404).json({ error: 'Partida no encontrada' });
        if (!isParticipant(game, playerId)) {
          return res.status(403).json({ error: 'No participas en esta partida' });
        }
        var msg = {
          gameId: game.id,
          playerId: playerId,
          playerName: playerName,
          content: content,
          version: version,
          nonce: nonce,
          createdAt: new Date().toISOString(),
        };
        return store.addGameMessage(msg);
      })
      .then(function (msg) {
        res.status(201).json({ message: msg });
      })
      .catch(next);
  });

  // Obtener claves públicas
  router.get('/games/:id/keys', function (req, res, next) {
    store
      .getGame(req.params.id)
      .then(function (game) {
        if (!game) return res.status(404).json({ error: 'Partida no encontrada' });
        return store.getGameKeys(req.params.id);
      })
      .then(function (keys) {
        res.json({ keys: keys });
      })
      .catch(next);
  });

  // Publicar/actualizar clave pública
  router.post('/games/:id/keys', function (req, res, next) {
    var body = req.body || {};
    var playerId = String(body.playerId || '').trim();
    var publicKey = String(body.publicKey || '').trim();

    if (!playerId) return res.status(400).json({ error: 'playerId requerido' });
    if (!publicKey) return res.status(400).json({ error: 'publicKey requerido' });

    // Validar longitud base64 (~44 chars para 32 bytes)
    try {
      var buf = Buffer.from(publicKey, 'base64');
      if (buf.length !== 32) throw new Error();
    } catch (e) {
      return res.status(400).json({ error: 'publicKey inválido (debe ser 32 bytes base64)' });
    }

    store
      .getGame(req.params.id)
      .then(function (game) {
        if (!game) return res.status(404).json({ error: 'Partida no encontrada' });
        if (!isParticipant(game, playerId)) {
          return res.status(403).json({ error: 'No participas en esta partida' });
        }
        var key = {
          gameId: game.id,
          playerId: playerId,
          publicKey: publicKey,
          createdAt: new Date().toISOString(),
        };
        return store.upsertGameKey(key);
      })
      .then(function (key) {
        res.json({ key: key });
      })
      .catch(next);
  });

  return router;
}

module.exports = createGameRoutes;
