'use strict';

var config = require('../config');
var MemoryStore = require('./memory');
var SupabaseStore = require('./supabase');

function createStore() {
  if (config.supabase.configured) {
    return new SupabaseStore(config.supabase);
  }

  // El store en memoria NO persiste entre invocaciones serverless.
  // En Vercel es obligatorio configurar SUPABASE_URL/SUPABASE_ANON_KEY.
  if (process.env.VERCEL) {
    console.error(
      '[ajedrez] AVISO: corriendo en Vercel sin Supabase. ' +
        'El almacenamiento en memoria es efimero: configura las variables ' +
        'SUPABASE_URL y SUPABASE_ANON_KEY (y SUPABASE_SERVICE_ROLE_KEY).'
    );
  }
  return new MemoryStore();
}

module.exports = createStore;
