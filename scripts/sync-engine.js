'use strict';

// Copia el motor de ajedrez a _shared para que la Edge Function (Deno) lo use.
// Fuente unica de verdad: public/js/chess-engine.js
// Uso: npm run sync:engine

var fs = require('fs');
var path = require('path');

var src = path.join(__dirname, '..', 'public', 'js', 'chess-engine.js');
var destDir = path.join(__dirname, '..', 'supabase', 'functions', '_shared');
var dest = path.join(destDir, 'chess-engine.js');

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log('Motor sincronizado -> ' + path.relative(process.cwd(), dest));
