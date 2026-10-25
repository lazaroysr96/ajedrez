'use strict';

var app = require('./app');
var config = require('./config');

app.listen(config.port, function () {
  var storage = config.supabase.configured ? 'Supabase' : 'memoria (solo desarrollo)';
  console.log('AGEDRES escuchando en http://localhost:' + config.port);
  console.log('Almacenamiento: ' + storage);
});
