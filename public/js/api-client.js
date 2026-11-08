/**
 * Utilidades compartidas para la API REST
 * Cargar ANTES que chat-panel.js y app.js
 */
(function () {
  'use strict';

  var API_BASE = '/api';

  window.api = function api(path, options) {
    var opts = Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {});
    return fetch(API_BASE + path, opts)
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
  };
})();