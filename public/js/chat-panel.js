/**
 * ChatPanel - Panel de chat lateral para la partida
 * Requiere: chat-types.js cargado antes (AjedrezChat)
 * Usa API REST para escrituras, Realtime para actualizaciones en vivo
 */
(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // Estado del chat
  // ─────────────────────────────────────────────────────────────
  var chatState = {
    gameId: null,
    myPlayerId: null,
    myPlayerName: null,
    myKeyPair: null,           // {publicKey, privateKey}
    peerKeys: {},              // playerId -> publicKey (Uint8Array)
    messages: [],              // {id, player_id, player_name, content, version, nonce, created_at, decrypted, encrypted}
    supabase: null,
    msgChannel: null,
    keyChannel: null,
    pollTimer: null,
    elements: {},
    isOpen: false,
    consentGiven: false,
  };

  // ─────────────────────────────────────────────────────────────
  // Inicialización
  // ─────────────────────────────────────────────────────────────
  function init(gameId, playerId, playerName, supabaseClient) {
    chatState.gameId = gameId;
    chatState.myPlayerId = playerId;
    chatState.myPlayerName = playerName;
    chatState.supabase = supabaseClient;

    if (!chatState.consentGiven) {
      chatState.consentGiven = AjedrezChat.hasChatConsent();
    }

    buildUI();
    bindEvents();
    loadKeyPair().then(function () {
      subscribeRealtime();
      fetchHistory();
      startPollingFallback();
    });
  }

  function destroy() {
    if (chatState.msgChannel && chatState.supabase) chatState.supabase.removeChannel(chatState.msgChannel);
    if (chatState.keyChannel && chatState.supabase) chatState.supabase.removeChannel(chatState.keyChannel);
    if (chatState.pollTimer) clearInterval(chatState.pollTimer);
    // Eliminar elementos DOM
    var panel = document.getElementById('chat-panel');
    var toggle = document.getElementById('chat-toggle');
    if (panel) panel.remove();
    if (toggle) toggle.remove();
    chatState = {
      gameId: null,
      myPlayerId: null,
      myPlayerName: null,
      myKeyPair: null,
      peerKeys: {},
      messages: [],
      supabase: null,
      msgChannel: null,
      keyChannel: null,
      pollTimer: null,
      elements: {},
      isOpen: false,
      consentGiven: false,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // UI Construction
  // ─────────────────────────────────────────────────────────────
  function buildUI() {
    var panel = document.createElement('div');
    panel.id = 'chat-panel';
    panel.className = 'chat-panel hidden';
    panel.innerHTML = '' +
      '<div class="chat-header">' +
      '  <span class="chat-title">Chat</span>' +
      '  <button id="chat-close" class="chat-btn" aria-label="Cerrar chat">✕</button>' +
      '</div>' +
      '<div id="chat-consent" class="chat-consent hidden">' +
      '  <div class="consent-content">' +
      '    <h4>⚠️ Chat</h4>' +
      '    <p>Los mensajes se transmiten al servidor. Con cifrado E2E, el contenido viaja cifrado para tu rival.</p>' +
      '    <p>⚠ <strong>No escribas contraseñas, datos personales, bancarios ni información sensible.</strong></p>' +
      '    <label class="consent-check">' +
      '      <input type="checkbox" id="consent-checkbox" required> ' +
      '      Confirmo que tengo <strong>18 años</strong> y entiendo lo anterior.' +
      '    </label>' +
      '    <button id="consent-accept" class="btn primary" disabled>Entrar al chat</button>' +
      '  </div>' +
      '</div>' +
      '<div id="chat-messages" class="chat-messages"></div>' +
      '<div id="chat-input-area" class="chat-input-area hidden">' +
      '  <div class="chat-status" id="chat-status"></div>' +
      '  <form id="chat-form">' +
      '    <input type="text" id="chat-input" placeholder="Escribe un mensaje…" maxlength="500" autocomplete="off" />' +
      '    <button type="submit" class="btn primary" id="chat-send">Enviar</button>' +
      '  </form>' +
      '</div>';
    document.body.appendChild(panel);

    var toggle = document.createElement('button');
    toggle.id = 'chat-toggle';
    toggle.className = 'chat-toggle';
    toggle.setAttribute('aria-label', 'Abrir chat');
    toggle.innerHTML = '💬';
    document.body.appendChild(toggle);

    chatState.elements = {
      panel: panel,
      toggle: toggle,
      closeBtn: document.getElementById('chat-close'),
      consentSection: document.getElementById('chat-consent'),
      consentCheckbox: document.getElementById('consent-checkbox'),
      consentAccept: document.getElementById('consent-accept'),
      messages: document.getElementById('chat-messages'),
      inputArea: document.getElementById('chat-input-area'),
      status: document.getElementById('chat-status'),
      form: document.getElementById('chat-form'),
      input: document.getElementById('chat-input'),
      sendBtn: document.getElementById('chat-send'),
    };
  }

  function bindEvents() {
    var el = chatState.elements;

    el.toggle.addEventListener('click', togglePanel);
    el.closeBtn.addEventListener('click', closePanel);
    el.consentCheckbox.addEventListener('change', function () {
      el.consentAccept.disabled = !this.checked;
    });
    el.consentAccept.addEventListener('click', acceptConsent);
    el.form.addEventListener('submit', function (e) {
      e.preventDefault();
      sendMessage();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && chatState.isOpen) closePanel();
    });
  }

  function togglePanel() {
    if (chatState.isOpen) closePanel();
    else openPanel();
  }

  function openPanel() {
    chatState.elements.panel.classList.remove('hidden');
    chatState.elements.toggle.classList.add('hidden');
    chatState.isOpen = true;
    if (!chatState.consentGiven) {
      showConsent();
    } else {
      showChat();
    }
    scrollToBottom();
  }

  function closePanel() {
    chatState.elements.panel.classList.add('hidden');
    chatState.elements.toggle.classList.remove('hidden');
    chatState.isOpen = false;
  }

  function showConsent() {
    chatState.elements.consentSection.classList.remove('hidden');
    chatState.elements.inputArea.classList.add('hidden');
  }

  function showChat() {
    chatState.elements.consentSection.classList.add('hidden');
    chatState.elements.inputArea.classList.remove('hidden');
  }

  function acceptConsent() {
    chatState.consentGiven = true;
    AjedrezChat.setChatConsent(true);
    showChat();
    publishMyPublicKey();
  }

  // ─────────────────────────────────────────────────────────────
  // Claves E2E
  // ─────────────────────────────────────────────────────────────
  async function loadKeyPair() {
    chatState.myKeyPair = await AjedrezChat.getOrCreateKeyPair(chatState.gameId);
  }

  async function publishMyPublicKey() {
    var pubB64 = AjedrezChat.bytesToB64(chatState.myKeyPair.publicKey);
    try {
      await api('/games/' + chatState.gameId + '/keys', {
        method: 'POST',
        body: JSON.stringify({ playerId: chatState.myPlayerId, publicKey: pubB64 }),
      });
    } catch (e) {
      console.error('Error publicando clave:', e);
    }
  }

  async function fetchPeerKeys() {
    try {
      var res = await api('/games/' + chatState.gameId + '/keys');
      for (var row of (res.keys || [])) {
        if (row.playerId !== chatState.myPlayerId) {
          var pk = AjedrezChat.b64ToBytes(row.publicKey);
          chatState.peerKeys[row.playerId] = pk;
          await AjedrezChat.setPeerPublicKey(chatState.gameId, row.playerId, pk);
        }
      }
    } catch (e) {
      console.error('Error cargando claves:', e);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Realtime (solo lectura, funciona con anon)
  // ─────────────────────────────────────────────────────────────
  function subscribeRealtime() {
    var sb = chatState.supabase;
    if (!sb) return;
    var gid = chatState.gameId;

    chatState.msgChannel = sb
      .channel('chat-msgs-' + gid)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'game_messages',
        filter: 'game_id=eq.' + gid,
      }, function (payload) {
        handleNewMessage(payload.new);
      })
      .subscribe();

    chatState.keyChannel = sb
      .channel('chat-keys-' + gid)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'game_keys',
        filter: 'game_id=eq.' + gid,
      }, function (payload) {
        var row = payload.new;
        if (row.player_id !== chatState.myPlayerId) {
          var pk = AjedrezChat.b64ToBytes(row.public_key);
          chatState.peerKeys[row.player_id] = pk;
          AjedrezChat.setPeerPublicKey(gid, row.player_id, pk);
        }
      })
      .subscribe();
  }

  // ─────────────────────────────────────────────────────────────
  // Historial y polling fallback (usa API REST)
  // ─────────────────────────────────────────────────────────────
  async function fetchHistory() {
    try {
      var res = await api('/games/' + chatState.gameId + '/messages?limit=100');
      chatState.messages = (res.messages || []).map(normalizeMessage);
      await decryptAllMessages();
      renderMessages();
      await fetchPeerKeys();
    } catch (e) {
      console.error('Error cargando historial:', e);
    }
  }

  function normalizeMessage(row) {
    // Normaliza snake_case (realtime) y camelCase (API) a formato interno
    return {
      id: row.id,
      player_id: row.player_id || row.playerId,
      player_name: row.player_name || row.playerName,
      content: row.content,
      version: row.version,
      nonce: row.nonce,
      created_at: row.created_at || row.createdAt,
    };
  }

  function startPollingFallback() {
    chatState.pollTimer = setInterval(fetchHistory, 5000);
  }

  // ─────────────────────────────────────────────────────────────
  // Manejo de mensajes
  // ─────────────────────────────────────────────────────────────
  function handleNewMessage(row) {
    var msg = normalizeMessage(row);
    if (chatState.messages.some(function (m) { return m.id === msg.id; })) return;
    chatState.messages.push(msg);
    decryptMessage(msg).then(function (decrypted) {
      msg.decrypted = decrypted;
      msg.encrypted = (msg.version === 1);
      renderMessages();
      if (chatState.isOpen) scrollToBottom();
    });
  }

  async function decryptAllMessages() {
    for (var msg of chatState.messages) {
      msg.decrypted = await decryptMessage(msg);
      msg.encrypted = (msg.version === 1);
    }
  }

  async function decryptMessage(msg) {
    if (msg.player_id === chatState.myPlayerId) return msg.content;
    if (msg.version === 0) return msg.content;
    var peerKey = chatState.peerKeys[msg.player_id];
    if (!peerKey) {
      peerKey = await AjedrezChat.getPeerPublicKey(chatState.gameId, msg.player_id);
      if (peerKey) chatState.peerKeys[msg.player_id] = peerKey;
    }
    if (!peerKey) return '[Cifrado - clave del rival no disponible]';
    return await AjedrezChat.decryptMessage(msg, chatState.myKeyPair.privateKey, peerKey);
  }

  async function sendMessage() {
    var text = chatState.elements.input.value.trim();
    if (!text) return;
    chatState.elements.input.value = '';
    chatState.elements.sendBtn.disabled = true;

    var optimistic = {
      id: Date.now(),
      player_id: chatState.myPlayerId,
      player_name: chatState.myPlayerName,
      content: text,
      version: 0,
      nonce: null,
      created_at: new Date().toISOString(),
      decrypted: text,
      encrypted: false,
      own: true,
    };
    chatState.messages.push(optimistic);
    renderMessages();
    scrollToBottom();

    var peerIds = Object.keys(chatState.peerKeys);
    var promises = peerIds.map(function (pid) {
      return AjedrezChat.prepareMessage(
        { game_id: chatState.gameId, player_id: chatState.myPlayerId, player_name: chatState.myPlayerName, text: text },
        chatState.myKeyPair.privateKey,
        chatState.peerKeys[pid]
      );
    });
    var prepared = await Promise.all(promises);
    var payload = prepared[0] || { version: 0, content: text, nonce: null };

    try {
      await api('/games/' + chatState.gameId + '/messages', {
        method: 'POST',
        body: JSON.stringify({
          playerId: chatState.myPlayerId,
          playerName: chatState.myPlayerName,
          content: payload.content,
          version: payload.version,
          nonce: payload.nonce,
        }),
      });
    } catch (e) {
      console.error('Error enviando mensaje:', e);
      chatState.messages.pop();
      renderMessages();
      showStatus('Error al enviar: ' + e.message, 'error');
    }
    chatState.elements.sendBtn.disabled = false;
  }

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  function renderMessages() {
    var container = chatState.elements.messages;
    container.innerHTML = '';
    for (var msg of chatState.messages) {
      var div = document.createElement('div');
      div.className = 'chat-msg' + (msg.own ? ' own' : '') + (msg.encrypted ? ' encrypted' : '');
      var time = formatTime(msg.created_at);
      var badge = msg.encrypted ? '<span class="enc-badge" title="Cifrado E2E">🔒</span>' : '';
      div.innerHTML =
        '<div class="msg-header">' +
        '  <span class="msg-name">' + escapeHtml(msg.player_name) + (msg.own ? ' (tú)' : '') + '</span>' +
        '  <span class="msg-time">' + time + '</span>' +
        '  ' + badge +
        '</div>' +
        '<div class="msg-text">' + escapeHtml(msg.decrypted || msg.content) + '</div>';
      container.appendChild(div);
    }
  }

  function formatTime(iso) {
    var d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&', '<': '<', '>': '>', '"': '"', "'": '&apos;' }[c];
    });
  }

  function scrollToBottom() {
    var c = chatState.elements.messages;
    c.scrollTop = c.scrollHeight;
  }

  function showStatus(text, type) {
    var el = chatState.elements.status;
    el.textContent = text;
    el.className = 'chat-status ' + (type || '');
    setTimeout(function () { el.textContent = ''; el.className = 'chat-status'; }, 4000);
  }

  // ─────────────────────────────────────────────────────────────
  // API pública
  // ─────────────────────────────────────────────────────────────
  window.ChatPanel = {
    init: init,
    destroy: destroy,
    open: openPanel,
    close: closePanel,
  };
})();