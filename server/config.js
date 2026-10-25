'use strict';

require('dotenv').config();

var url = process.env.SUPABASE_URL || '';
var anonKey = process.env.SUPABASE_ANON_KEY || '';
var serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  supabase: {
    url: url,
    anonKey: anonKey,
    serviceKey: serviceKey,
    configured: Boolean(url && anonKey),
    // El servidor usa la service_role si existe (omite RLS); si no, la anon.
    serverKey: serviceKey || anonKey,
  },
};
