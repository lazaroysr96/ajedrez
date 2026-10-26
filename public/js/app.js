(function () {
  'use strict';

  var API = '/api';
  var Engine = window.ChessEngine;
  var Chess = Engine.Chess;
  var BOT_ID = 'bot';

  var GLYPH = { k: '\u265A', q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F' };
  var FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  var RANKS = [8, 7, 6, 5, 4, 3, 2, 1];

  var state = {
    config: null,
    game: null,
    moves: [],
    myColor: null,
    selected: null,
    legalTargets: [],
    supabase: null,
    channel: null,
    poll: null,
    gameId: null,
    aiLevel: 'medium',
    mode: 'online',
    localConfig: null,
  };

  var els = {
    lobby: document.getElementById('view-lobby'),
    game: document.getElementById('view-game'),
    board: document.getElementById('board'),
    promo: document.getElementById('promo'),
    promoButtons: document.getElementById('promoButtons'),
    players: document.getElementById('players'),
    status: document.getElementById('statusText'),
    movelist: document.getElementById('movelist'),
    share: document.getElementById('share'),
    openGames: document.getElementById('openGames'),
    conn: document.getElementById('conn'),
    toast: document.getElementById('toast'),
    nameInput: document.getElementById('nameInput'),
    resignBtn: document.getElementById('resignBtn'),
    aiLevel: document.getElementById('aiLevel'),
    aiColor: document.getElementById('aiColor'),
    playAiBtn: document.getElementById('playAiBtn'),
    soundBtn: document.getElementById('soundBtn'),
  };

  // ---------------- identidad ----------------
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function player() {
    var id = localStorage.getItem('ajedrez.id');
    if (!id) {
      id = uuid();
      localStorage.setItem('ajedrez.id', id);
    }
    var name = localStorage.getItem('ajedrez.name') || '';
    return { id: id, name: name };
  }

  // ---------------- utilidades ----------------
  function api(path, options) {
    var opts = Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {});
    return fetch(API + path, opts)
      .catch(function () {
        var err = new Error('Sin conexión con el servidor');
        err.network = true;
        throw err;
      })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) {
            var e = new Error(data.error || 'Error del servidor');
            e.status = res.status;
            throw e;
          }
          return data;
        });
      });
  }

  var toastTimer = null;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.add('hidden'); }, 2600);
  }

  function setConn(text, kind) {
    els.conn.textContent = text;
    els.conn.className = 'conn' + (kind ? ' ' + kind : '');
  }

  var alerts = {
    ctx: null,
    enabled: localStorage.getItem('ajedrez.sound') !== 'off',
    baseTitle: document.title,
    message: '',
  };

  function ensureAudio() {
    if (alerts.ctx) return alerts.ctx;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    alerts.ctx = new Ctx();
    return alerts.ctx;
  }

  function unlockAudio() {
    var ctx = ensureAudio();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function tone(ctx, freq, offset, duration, type, volume) {
    var start = ctx.currentTime + offset;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  function playAlert(kind) {
    if (!alerts.enabled) return;
    var ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (kind === 'join') {
      tone(ctx, 659.25, 0, 0.16, 'triangle', 0.09);
      tone(ctx, 987.77, 0.12, 0.24, 'triangle', 0.1);
    } else if (kind === 'end') {
      tone(ctx, 523.25, 0, 0.2, 'triangle', 0.09);
      tone(ctx, 392, 0.16, 0.32, 'triangle', 0.09);
    } else {
      tone(ctx, 880, 0, 0.11, 'sine', 0.09);
      tone(ctx, 1174.66, 0.07, 0.18, 'sine', 0.07);
    }
  }

  function updateSoundButton() {
    els.soundBtn.textContent = alerts.enabled ? 'Sonido: sí' : 'Sonido: no';
    els.soundBtn.setAttribute('aria-pressed', String(alerts.enabled));
  }

  function toggleSound() {
    alerts.enabled = !alerts.enabled;
    localStorage.setItem('ajedrez.sound', alerts.enabled ? 'on' : 'off');
    updateSoundButton();
    if (alerts.enabled) playAlert('move');
  }

  function isWatchingGame() {
    return Boolean(state.gameId) &&
      !document.hidden &&
      document.hasFocus() &&
      !els.game.classList.contains('hidden');
  }

  function showTitleAlert(message) {
    alerts.message = message;
    document.title = '● ' + message + ' · AJEDREZ';
  }

  function clearTitleAlert() {
    if (!alerts.message) return;
    alerts.message = '';
    document.title = alerts.baseTitle;
  }

  function notifyEvent(message, kind, force) {
    if (isWatchingGame()) {
      if (!force) return;
      playAlert(kind);
      toast(message);
      return;
    }
    showTitleAlert(message);
    playAlert(kind);
  }

  function opponentName(game) {
    var me = player().id;
    var g = game || state.game;
    if (!g) return 'El rival';
    if (g.whiteId === me) return g.blackName || 'El rival';
    if (g.blackId === me) return g.whiteName || 'El rival';
    return 'El rival';
  }

  function detectGameChange(prev, next) {
    if (!prev || !next || prev.id !== next.id) return;
    var me = player().id;
    if (next.whiteId !== me && next.blackId !== me) return;

    if (prev.status === 'waiting' && next.status === 'active') {
      notifyEvent(opponentName(next) + ' se unió a la partida', 'join', true);
    } else if (prev.status === 'active' && next.status === 'finished') {
      var msg;
      if (next.result === 'draw') msg = 'Tablas.';
      else if (next.winnerId === me) msg = '¡Ganaste!';
      else msg = 'Perdiste.';
      notifyEvent(msg, 'end', true);
    }
  }

  function maybeNotifyMove(move) {
    if (!state.myColor || !move || move.color === state.myColor) return;
    notifyEvent(opponentName() + ' jugó ' + move.san + ' · Tu turno', 'move', false);
  }

  function detectNewMoves(prevMoves, nextMoves) {
    var known = {};
    prevMoves.forEach(function (m) { known[m.ply] = true; });
    var last = null;
    nextMoves.forEach(function (m) {
      if (!known[m.ply]) last = m;
    });
    if (last) maybeNotifyMove(last);
  }

  function onAttention() {
    clearTitleAlert();
    if (state.gameId && state.mode === 'online') refreshGame(state.gameId);
  }

  function mapGame(row) {
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
      updatedAt: row.updated_at,
    };
  }

  function mapMove(row) {
    return {
      gameId: row.game_id,
      ply: row.ply,
      color: row.color,
      from: row.from_sq,
      to: row.to_sq,
      promotion: row.promotion,
      san: row.san,
      fenAfter: row.fen_after,
    };
  }

  // ---------------- routing ----------------
  function route() {
    var hash = location.hash || '';
    if (hash === '#/local') {
      openLocal();
      return;
    }
    var match = hash.match(/^#\/game\/(.+)$/);
    if (match) {
      openGame(match[1]);
    } else {
      openLobby();
    }
  }

  function openLobby() {
    teardown();
    els.game.classList.add('hidden');
    els.lobby.classList.remove('hidden');
    setConn(state.config && state.config.realtime ? 'en línea' : 'local', state.config && state.config.realtime ? 'ok' : 'warn');
    loadOpenGames();
  }

  function openGame(id) {
    if (state.gameId === id && state.game) return;
    teardown();
    state.mode = 'online';
    state.gameId = id;
    state.game = null;
    state.moves = [];
    state.myColor = null;
    state.selected = null;
    state.legalTargets = [];
    state.aiLevel = localStorage.getItem('ajedrez.ai.' + id) || 'medium';
    resetAI();
    els.lobby.classList.add('hidden');
    els.game.classList.remove('hidden');
    els.status.textContent = 'Cargando…';
    els.status.className = 'status-text';

    refreshGame(id).then(function () {
      subscribeGame(id);
    });
  }

  function teardown() {
    if (state.channel && state.supabase) {
      state.supabase.removeChannel(state.channel);
      state.channel = null;
    }
    if (state.poll) {
      clearInterval(state.poll);
      state.poll = null;
    }
    state.gameId = null;
    state.game = null;
    state.moves = [];
    resetAI();
  }

  // Partida local contra la máquina (sin servidor).
  function newLocalGame(color) {
    var me = player();
    var name = currentName();
    var humanIsWhite = color === 'w';
    return {
      id: 'local-' + Date.now(),
      whiteId: humanIsWhite ? me.id : BOT_ID,
      whiteName: humanIsWhite ? name : 'Computadora',
      blackId: humanIsWhite ? BOT_ID : me.id,
      blackName: humanIsWhite ? 'Computadora' : name,
      fen: Chess.START_FEN,
      turn: 'w',
      status: 'active',
      result: null,
      winnerId: null,
      lastMoveSan: null,
    };
  }

  function openLocal() {
    teardown();
    state.mode = 'local';
    var cfg = state.localConfig || { level: els.aiLevel.value, color: 'w' };
    state.aiLevel = cfg.level || 'medium';
    state.myColor = cfg.color === 'b' ? 'b' : 'w';
    state.game = newLocalGame(state.myColor);
    state.gameId = state.game.id;
    state.moves = [];
    state.selected = null;
    state.legalTargets = [];
    resetAI();
    els.lobby.classList.add('hidden');
    els.game.classList.remove('hidden');
    setConn('local · sin conexión', 'warn');
    render();
  }

  // Inicia una partida local (fallback si el servidor no responde).
  function startLocalGame(level, color) {
    if (color !== 'w' && color !== 'b') color = Math.random() < 0.5 ? 'w' : 'b';
    state.localConfig = { level: level || els.aiLevel.value, color: color };
    if (location.hash === '#/local') openLocal();
    else location.hash = '#/local';
  }

  // Pasa la partida en curso a modo local (el servidor no responde).
  function goOffline() {
    if (state.mode === 'local') return;
    state.mode = 'local';
    if (state.channel && state.supabase) {
      state.supabase.removeChannel(state.channel);
      state.channel = null;
    }
    if (state.poll) {
      clearInterval(state.poll);
      state.poll = null;
    }
    setConn('local · sin conexión', 'warn');
  }

  // Aplica un movimiento localmente con el motor del navegador.
  function applyLocalMove(from, to, promotion, color) {
    var chess = currentChess();
    var move = chess.move({ from: from, to: to, promotion: promotion });
    if (!move) return false;

    state.moves.push({
      gameId: state.game.id,
      ply: state.moves.length + 1,
      color: color,
      from: Engine.algebraic(move.from),
      to: Engine.algebraic(move.to),
      promotion: move.promotion || null,
      san: move.san,
      fenAfter: chess.fen(),
    });

    state.game.fen = chess.fen();
    state.game.turn = chess.turn;
    state.game.lastMoveSan = move.san;

    var result = chess.result();
    if (result) {
      state.game.status = 'finished';
      state.game.result = result;
      if (result === 'white') state.game.winnerId = state.game.whiteId;
      else if (result === 'black') state.game.winnerId = state.game.blackId;
    }

    render();
    maybeNotifyMove(state.moves[state.moves.length - 1]);
    return true;
  }

  // ---------------- datos ----------------
  function refreshGame(id) {
    return api('/games/' + id)
      .then(function (data) {
        var prevGame = state.game;
        var prevMoves = state.moves;
        state.game = data.game;
        state.moves = (data.moves || []).slice().sort(function (a, b) { return a.ply - b.ply; });
        updateMyColor();
        if (prevGame) {
          detectGameChange(prevGame, state.game);
          detectNewMoves(prevMoves, state.moves);
        }
        render();
      })
      .catch(function (err) {
        toast(err.message);
      });
  }

  function updateMyColor() {
    var me = player().id;
    if (!state.game) return;
    if (state.game.whiteId === me) state.myColor = 'w';
    else if (state.game.blackId === me) state.myColor = 'b';
    else state.myColor = null;
  }

  function loadOpenGames() {
    els.openGames.innerHTML = '<li class="empty">Cargando…</li>';
    api('/games?status=waiting')
      .then(function (data) {
        var games = data.games || [];
        if (!games.length) {
          els.openGames.innerHTML = '<li class="empty">No hay partidas abiertas. ¡Crea una!</li>';
          return;
        }
        var me = player().id;
        els.openGames.innerHTML = '';
        games.forEach(function (g) {
          var li = document.createElement('li');
          var host = g.whiteId ? g.whiteName : g.blackName;
          var color = g.whiteId ? 'blancas' : 'negras';
          var who = document.createElement('div');
          who.className = 'who';
          who.innerHTML = '<b>' + escapeHtml(host || 'Anónimo') + '</b> espera <small>juega con ' + color + '</small>';
          var btn = document.createElement('button');
          btn.className = 'btn small primary';
          btn.textContent = 'Unirse';
          btn.addEventListener('click', function () { joinGame(g.id, btn); });
          li.appendChild(who);
          li.appendChild(btn);
          els.openGames.appendChild(li);
        });
      })
      .catch(function (err) {
        els.openGames.innerHTML = '<li class="empty">Error: ' + escapeHtml(err.message) + '</li>';
      });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------------- acciones ----------------
  function currentName() {
    return (els.nameInput.value || '').trim() || 'Anónimo';
  }

  function createGame(color) {
    var me = player();
    var name = currentName();
    localStorage.setItem('ajedrez.name', name);
    api('/games', {
      method: 'POST',
      body: JSON.stringify({ playerId: me.id, playerName: name, color: color }),
    })
      .then(function (data) {
        location.hash = '#/game/' + data.game.id;
      })
      .catch(function (err) { toast(err.message); });
  }

  function createVsAi() {
    var me = player();
    var name = currentName();
    var level = els.aiLevel.value;
    var color = els.aiColor.value;
    localStorage.setItem('ajedrez.name', name);
    api('/games/vs-ai', {
      method: 'POST',
      body: JSON.stringify({ playerId: me.id, playerName: name, color: color }),
    })
      .then(function (data) {
        localStorage.setItem('ajedrez.ai.' + data.game.id, level);
        location.hash = '#/game/' + data.game.id;
      })
      .catch(function (err) {
        if (err.network || err.status >= 500 || err.status === 404) {
          toast('Servidor no disponible; jugando en local.');
          startLocalGame(level, color);
        } else {
          toast(err.message);
        }
      });
  }

  function joinGame(id, btn) {
    var me = player();
    var name = currentName();
    localStorage.setItem('ajedrez.name', name);
    btn.disabled = true;
    api('/games/' + id + '/join', {
      method: 'POST',
      body: JSON.stringify({ playerId: me.id, playerName: name }),
    })
      .then(function () { location.hash = '#/game/' + id; })
      .catch(function (err) { btn.disabled = false; toast(err.message); });
  }

  function sendMove(from, to, promotion) {
    if (state.mode === 'local') {
      state.selected = null;
      state.legalTargets = [];
      applyLocalMove(from, to, promotion, state.myColor);
      return;
    }
    var me = player();
    api('/games/' + state.gameId + '/move', {
      method: 'POST',
      body: JSON.stringify({ playerId: me.id, from: from, to: to, promotion: promotion }),
    })
      .then(function (res) {
        state.game = res.game;
        if (res.move) addMove(res.move);
        state.selected = null;
        state.legalTargets = [];
        render();
        if (res.checkmate) toast('¡Jaque mate!');
      })
      .catch(function (err) {
        state.selected = null;
        state.legalTargets = [];
        if (err.network || err.status >= 500) {
          goOffline();
          toast('Sin conexión; la partida continúa en local.');
          applyLocalMove(from, to, promotion, state.myColor);
        } else {
          toast(err.message);
          refreshGame(state.gameId);
        }
      });
  }

  function resign() {
    if (state.mode === 'local') {
      state.game.status = 'finished';
      state.game.result = state.myColor === 'w' ? 'black' : 'white';
      state.game.winnerId = BOT_ID;
      render();
      return;
    }
    var me = player();
    api('/games/' + state.gameId + '/resign', {
      method: 'POST',
      body: JSON.stringify({ playerId: me.id }),
    })
      .then(function (res) {
        state.game = res.game;
        render();
      })
      .catch(function (err) {
        if (err.network || err.status >= 500) {
          goOffline();
          state.game.status = 'finished';
          state.game.result = state.myColor === 'w' ? 'black' : 'white';
          render();
        } else {
          toast(err.message);
        }
      });
  }

  function addMove(move) {
    var exists = state.moves.some(function (m) { return m.ply === move.ply; });
    if (exists) return false;
    state.moves.push(move);
    state.moves.sort(function (a, b) { return a.ply - b.ply; });
    return true;
  }

  // ---------------- realtime ----------------
  function initSupabase() {
    if (!state.config || !state.config.realtime || !window.supabase) return null;
    if (!state.supabase) {
      state.supabase = window.supabase.createClient(state.config.supabaseUrl, state.config.supabaseAnonKey);
    }
    return state.supabase;
  }

  function subscribeGame(id) {
    var sb = initSupabase();
    if (!sb) {
      setConn('sincronización por polling', 'warn');
      state.poll = setInterval(function () { refreshGame(id); }, 1500);
      return;
    }

    setConn('conectando…', 'warn');
    state.channel = sb
      .channel('game-' + id)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: 'id=eq.' + id },
        function (payload) {
          var prev = state.game;
          var next = mapGame(payload.new);
          state.game = next;
          updateMyColor();
          detectGameChange(prev, next);
          render();
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'moves', filter: 'game_id=eq.' + id },
        function (payload) {
          var move = mapMove(payload.new);
          if (addMove(move)) maybeNotifyMove(move);
          render();
        }
      )
      .subscribe(function (status) {
        if (status === 'SUBSCRIBED') setConn('en línea · tiempo real', 'ok');
        else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') setConn('reconectando…', 'warn');
      });
  }

  // ---------------- motor (Stockfish WASM) ----------------
  var ai = { worker: null, ready: false, thinking: false, pendingFen: null, timer: null };

  function botColor() {
    if (!state.game) return null;
    if (state.game.whiteId === BOT_ID) return 'w';
    if (state.game.blackId === BOT_ID) return 'b';
    return null;
  }

  function aiConfig() {
    var map = {
      easy: { skill: 1, movetime: 200 },
      medium: { skill: 8, movetime: 700 },
      hard: { skill: 20, movetime: 1600 },
    };
    return map[state.aiLevel] || map.medium;
  }

  function resetAI() {
    if (ai.timer) {
      clearTimeout(ai.timer);
      ai.timer = null;
    }
    ai.thinking = false;
    ai.pendingFen = null;
  }

  function ensureEngine() {
    if (ai.worker) return ai.worker;
    var worker = new Worker('/engine/stockfish.js#stockfish.wasm');
    ai.worker = worker;
    worker.onmessage = function (e) {
      var line = typeof e.data === 'string' ? e.data : (e.data && e.data.data) || '';
      onEngineLine(line);
    };
    worker.onerror = function () {
      ai.ready = false;
      if (ai.timer) {
        clearTimeout(ai.timer);
        ai.timer = null;
      }
      if (ai.thinking) {
        ai.thinking = false;
        toast('Motor no disponible; la máquina jugará al azar.');
        playBestMove(null);
      }
    };
    worker.postMessage('uci');
    return worker;
  }

  function onEngineLine(line) {
    if (line === 'uciok') {
      ai.worker.postMessage('isready');
    } else if (line === 'readyok') {
      ai.ready = true;
      if (ai.thinking && ai.pendingFen) {
        var fen = ai.pendingFen;
        ai.pendingFen = null;
        search(fen);
      } else {
        maybeMoveAI();
      }
    } else if (line.indexOf('bestmove') === 0) {
      if (ai.timer) {
        clearTimeout(ai.timer);
        ai.timer = null;
      }
      ai.thinking = false;
      playBestMove(line.split(/\s+/)[1]);
    }
  }

  function search(fen) {
    var cfg = aiConfig();
    ai.worker.postMessage('setoption name Skill Level value ' + cfg.skill);
    ai.worker.postMessage('position fen ' + fen);
    ai.worker.postMessage('go movetime ' + cfg.movetime);
  }

  function maybeMoveAI() {
    var bc = botColor();
    if (!bc || !state.game || state.game.status !== 'active') return;
    if (state.game.turn !== bc || ai.thinking) return;
    ai.thinking = true;
    ensureEngine();
    if (ai.ready) search(state.game.fen);
    else ai.pendingFen = state.game.fen;

    if (ai.timer) clearTimeout(ai.timer);
    ai.timer = setTimeout(function () {
      if (!ai.thinking) return;
      ai.thinking = false;
      ai.pendingFen = null;
      toast('El motor tardó demasiado; jugada al azar.');
      playBestMove(null);
    }, 8000);
  }

  function playBestMove(uci) {
    if (!state.game || state.game.status !== 'active') return;
    if (state.game.turn !== botColor()) return;

    var from = null;
    var to = null;
    var promotion = null;
    if (uci && uci !== '(none)' && uci.length >= 4) {
      from = uci.slice(0, 2);
      to = uci.slice(2, 4);
      promotion = uci.length > 4 ? uci[4] : null;
    }

    var chess = currentChess();
    var legal = from ? chess.move({ from: from, to: to, promotion: promotion }) : null;

    if (!legal) {
      var options = chess.moves();
      if (!options.length) return;
      var pick = options[Math.floor(Math.random() * options.length)];
      from = Engine.algebraic(pick.from);
      to = Engine.algebraic(pick.to);
      promotion = pick.promotion || null;
    }

    if (state.mode === 'local') {
      applyLocalMove(from, to, promotion, botColor());
      return;
    }

    api('/games/' + state.gameId + '/move', {
      method: 'POST',
      body: JSON.stringify({ playerId: BOT_ID, from: from, to: to, promotion: promotion }),
    })
      .then(function (res) {
        state.game = res.game;
        if (res.move) addMove(res.move);
        render();
      })
      .catch(function (err) {
        if (err.network || err.status >= 500) {
          goOffline();
          applyLocalMove(from, to, promotion, botColor());
        } else {
          toast(err.message);
          ai.thinking = false;
        }
      });
  }

  // ---------------- render ----------------
  function currentChess() {
    return new Chess(state.game.fen);
  }

  function render() {
    if (!state.game) return;
    var chess = currentChess();
    renderBoard(chess);
    renderPlayers();
    renderStatus();
    renderMoves();
    renderShare();
    updateActions();
    maybeMoveAI();
  }

  function boardSquares() {
    var files = FILES.slice();
    var ranks = RANKS.slice();
    if (state.myColor === 'b') {
      files.reverse();
      ranks.reverse();
    }
    var out = [];
    ranks.forEach(function (r) {
      files.forEach(function (f) { out.push(f + r); });
    });
    return out;
  }

  function renderBoard(chess) {
    var lastMove = state.moves.length ? state.moves[state.moves.length - 1] : null;
    var checkSquare = null;
    if (chess.inCheck()) {
      var ks = chess.kingSquare(chess.turn);
      if (ks >= 0) checkSquare = Engine.algebraic(ks);
    }
    var canPlay = state.game.status === 'active' && state.myColor && state.game.turn === state.myColor;

    els.board.innerHTML = '';
    boardSquares().forEach(function (sq) {
      var file = sq.charCodeAt(0) - 97;
      var rank = parseInt(sq[1], 10);
      var isLight = (file + rank) % 2 === 1;

      var cell = document.createElement('div');
      cell.className = 'sq ' + (isLight ? 'light' : 'dark');
      cell.dataset.square = sq;

      if (state.selected === sq) cell.classList.add('selected');
      if (lastMove && (lastMove.from === sq || lastMove.to === sq)) cell.classList.add('lastmove');
      if (checkSquare === sq) cell.classList.add('check');

      var pc = chess.get(sq);
      if (pc && canPlay && Engine.colorOf(pc) === state.myColor) cell.classList.add('playable');

      if (state.legalTargets.indexOf(sq) !== -1) {
        cell.classList.add('target');
        if (pc) cell.classList.add('capture');
      }

      if (pc) {
        var span = document.createElement('span');
        span.className = 'pc ' + Engine.colorOf(pc);
        span.textContent = GLYPH[Engine.typeOf(pc)];
        cell.appendChild(span);
      }

      if (file === (state.myColor === 'b' ? 7 : 0)) {
        var rk = document.createElement('span');
        rk.className = 'coord rank';
        rk.textContent = rank;
        cell.appendChild(rk);
      }
      if (rank === (state.myColor === 'b' ? 8 : 1)) {
        var fl = document.createElement('span');
        fl.className = 'coord file';
        fl.textContent = sq[0];
        cell.appendChild(fl);
      }

      els.board.appendChild(cell);
    });
  }

  function renderPlayers() {
    var me = player().id;
    var g = state.game;
    els.players.innerHTML = '';
    [
      { color: 'w', name: g.whiteName, id: g.whiteId },
      { color: 'b', name: g.blackName, id: g.blackId },
    ].forEach(function (p) {
      var div = document.createElement('div');
      div.className = 'player' + (g.turn === p.color && g.status === 'active' ? ' turn' : '');
      var left = document.createElement('div');
      left.className = 'left';
      left.innerHTML =
        '<span class="dot ' + p.color + '"></span>' +
        escapeHtml(p.name || (p.id ? 'Jugador' : 'Esperando…')) +
        (p.id === me ? '<span class="you">(tú)</span>' : '');
      var side = document.createElement('span');
      side.className = 'muted';
      side.style.color = 'var(--muted)';
      side.style.fontSize = '12px';
      side.textContent = p.color === 'w' ? 'Blancas' : 'Negras';
      div.appendChild(left);
      div.appendChild(side);
      els.players.appendChild(div);
    });
  }

  function renderStatus() {
    var g = state.game;
    var me = player().id;
    var cls = 'status-text';
    var text = '';

    if (g.status === 'waiting') {
      text = 'Esperando rival… comparte el enlace de la partida.';
      cls += ' wait';
    } else if (g.status === 'finished') {
      if (g.result === 'draw') text = 'Tablas.';
      else {
        var winner = g.result === 'white' ? 'las blancas' : 'las negras';
        text = 'Ganaron ' + winner + '.';
        if (g.winnerId === me) { text = '¡Ganaste!'; cls += ' win'; }
        else if (state.myColor) { text = 'Perdiste.'; cls += ' lose'; }
      }
    } else {
      var bc = botColor();
      if (bc && g.turn === bc) {
        text = 'La computadora está pensando…';
      } else {
        var turnName = g.turn === 'w' ? 'blancas' : 'negras';
        if (state.myColor && g.turn === state.myColor) text = 'Tu turno (' + turnName + ').';
        else text = 'Turno de las ' + turnName + '.';
      }
    }

    var chess = currentChess();
    if (g.status === 'active' && chess.inCheck()) text += ' ¡Jaque!';

    els.status.textContent = text;
    els.status.className = cls;
  }

  function renderMoves() {
    els.movelist.innerHTML = '';
    if (!state.moves.length) {
      els.movelist.innerHTML = '<li class="empty">Sin movimientos todavía.</li>';
      return;
    }
    for (var i = 0; i < state.moves.length; i += 2) {
      var white = state.moves[i];
      var black = state.moves[i + 1];
      var row = document.createElement('li');
      row.className = 'moverow';
      var num = document.createElement('span');
      num.className = 'num';
      num.textContent = white.ply % 2 === 1 ? Math.floor(white.ply / 2) + 1 : '';
      var wm = document.createElement('span');
      wm.textContent = white.san;
      var bm = document.createElement('span');
      bm.textContent = black ? black.san : '';
      row.appendChild(num);
      row.appendChild(wm);
      row.appendChild(bm);
      els.movelist.appendChild(row);
    }
    els.movelist.scrollTop = els.movelist.scrollHeight;
  }

  function renderShare() {
    if (state.mode === 'local') {
      els.share.innerHTML = '<div>Partida local contra la computadora (no se guarda en línea).</div>';
      return;
    }
    var url = location.origin + location.pathname + '#/game/' + state.gameId;
    els.share.innerHTML = '';
    var label = document.createElement('div');
    label.textContent = 'Enlace para invitar:';
    var link = document.createElement('a');
    link.href = url;
    link.textContent = url;
    var btn = document.createElement('button');
    btn.className = 'btn ghost small';
    btn.textContent = 'Copiar enlace';
    btn.addEventListener('click', function () {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () { toast('Enlace copiado'); });
      } else {
        toast(url);
      }
    });
    els.share.appendChild(label);
    els.share.appendChild(link);
    els.share.appendChild(document.createElement('br'));
    els.share.appendChild(btn);
  }

  function updateActions() {
    var g = state.game;
    var isPlayer = Boolean(state.myColor);
    els.resignBtn.disabled = !(isPlayer && g.status === 'active');
  }

  // ---------------- interacción ----------------
  function legalTargetsFrom(chess, square) {
    var targets = [];
    chess.moves({ square: square }).forEach(function (m) {
      var to = Engine.algebraic(m.to);
      if (targets.indexOf(to) === -1) targets.push(to);
    });
    return targets;
  }

  function onSquareClick(square) {
    var g = state.game;
    if (!g || g.status !== 'active' || !state.myColor || g.turn !== state.myColor) return;

    if (state.selected && state.legalTargets.indexOf(square) !== -1) {
      attemptMove(state.selected, square);
      return;
    }

    // Permitir enrocar haciendo clic en la torre cuando el rey esta seleccionado.
    if (state.selected) {
      var chessSel = currentChess();
      var selPc = chessSel.get(state.selected);
      if (selPc && Engine.typeOf(selPc) === 'k' && Engine.colorOf(selPc) === state.myColor) {
        var clickedPc = chessSel.get(square);
        if (clickedPc && Engine.typeOf(clickedPc) === 'r' && Engine.colorOf(clickedPc) === state.myColor) {
          var kingSq = Engine.fromAlgebraic(state.selected);
          var rookSq = Engine.fromAlgebraic(square);
          var kingFile = kingSq & 15;
          var kingRank = kingSq >> 4;
          var targetFile = (rookSq & 15) > kingFile ? 6 : 2;
          var targetSq = String.fromCharCode(97 + targetFile) + (8 - kingRank);
          if (state.legalTargets.indexOf(targetSq) !== -1) {
            attemptMove(state.selected, targetSq);
            return;
          }
        }
      }
    }

    var chess = currentChess();
    var pc = chess.get(square);
    if (pc && Engine.colorOf(pc) === state.myColor) {
      state.selected = square;
      state.legalTargets = legalTargetsFrom(chess, square);
    } else {
      state.selected = null;
      state.legalTargets = [];
    }
    render();
  }

  function attemptMove(from, to) {
    var chess = currentChess();
    var options = chess.moves({ square: from }).filter(function (m) {
      return Engine.algebraic(m.to) === to;
    });
    if (!options.length) return;
    var needsPromotion = options.some(function (m) { return m.promotion; });
    if (needsPromotion) {
      showPromotion(from, to);
      return;
    }
    sendMove(from, to, null);
  }

  function showPromotion(from, to) {
    els.promoButtons.innerHTML = '';
    ['q', 'r', 'b', 'n'].forEach(function (p) {
      var btn = document.createElement('button');
      btn.textContent = GLYPH[p];
      btn.title = { q: 'Dama', r: 'Torre', b: 'Alfil', n: 'Caballo' }[p];
      btn.addEventListener('click', function () {
        els.promo.classList.add('hidden');
        sendMove(from, to, p);
      });
      els.promoButtons.appendChild(btn);
    });
    els.promo.classList.remove('hidden');
  }

  // ---------------- init ----------------
  function bind() {
    els.board.addEventListener('click', function (e) {
      var cell = e.target.closest ? e.target.closest('.sq') : null;
      if (cell) onSquareClick(cell.dataset.square);
    });

    document.getElementById('createBtn').addEventListener('click', function () { createGame('w'); });
    document.getElementById('createRandomBtn').addEventListener('click', function () { createGame('random'); });
    els.playAiBtn.addEventListener('click', createVsAi);
    document.getElementById('refreshBtn').addEventListener('click', loadOpenGames);
    document.getElementById('leaveBtn').addEventListener('click', function () { location.hash = '#/'; });
    els.resignBtn.addEventListener('click', resign);

    els.nameInput.value = player().name;
    els.soundBtn.addEventListener('click', toggleSound);
    updateSoundButton();
    document.addEventListener('pointerdown', unlockAudio);
    document.addEventListener('keydown', unlockAudio);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) onAttention();
    });
    window.addEventListener('focus', onAttention);
    window.addEventListener('hashchange', route);
  }

  function start() {
    bind();
    api('/config')
      .then(function (cfg) {
        state.config = cfg;
        route();
      })
      .catch(function () {
        state.config = { realtime: false };
        route();
      });
  }

  start();
})();
