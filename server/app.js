'use strict';

var express = require('express');
var cors = require('cors');
var path = require('path');
var config = require('./config');
var createStore = require('./store');
var createGameRoutes = require('./routes/games');

var app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '16kb' }));

app.get('/api/health', function (req, res) {
  res.json({
    ok: true,
    storage: config.supabase.configured ? 'supabase' : 'memory',
    realtime: config.supabase.configured,
  });
});

// Config publica para el frontend (solo valores seguros: url + anon key).
app.get('/api/config', function (req, res) {
  res.json({
    supabaseUrl: config.supabase.url || null,
    supabaseAnonKey: config.supabase.anonKey || null,
    realtime: config.supabase.configured,
  });
});

app.use('/api', createGameRoutes(createStore()));

// En local Express sirve los estaticos. En Vercel lo hace el CDN desde /public.
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', function (req, res) {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use(function (err, req, res, next) {
  console.error('[agedres] error:', err && err.message ? err.message : err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;
