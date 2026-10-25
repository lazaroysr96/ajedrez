# AGEDRES · Ajedrez en línea

Juego de ajedrez multijugador en línea. Backend con **Node + Express** (desplegable como
función serverless en **Vercel**), persistencia en **Supabase** (Postgres + Realtime) y
frontend con **HTML + CSS + JavaScript vanilla**.

- Tablero completo: enroque, captura al paso, promoción, jaque, jaque mate, ahogado y tablas.
- Multijugador en **tiempo real** con Supabase Realtime (con *fallback* a polling).
- Validación de movimientos **en el servidor** (el cliente no es autoritativo).
- Funciona sin configurar nada (modo memoria) para desarrollo local.

---

## Arquitectura

```
Navegador (HTML/JS vanilla)
   │  fetch  /api/*            │  Supabase Realtime (WebSocket)
   ▼                           ▼
Vercel Serverless Function ──► Supabase (Postgres + Realtime)
(Express, api/index.js)        (tablas games / moves)
```

- El **frontend** crea/une/mueve vía REST (`/api/*`) y escucha cambios en vivo con Realtime.
- El **servidor** valida cada movimiento con el motor de ajedrez y escribe en Postgres
  usando la `service_role` (omite RLS).
- El navegador solo **lee** de Supabase (políticas RLS de `select` público).

## Estructura

```
AGEDRES/
├── api/index.js                 # Entry serverless de Vercel (exporta la app Express)
├── server/
│   ├── app.js                   # App Express (rutas + estáticos)
│   ├── index.js                 # Arranque local (app.listen)
│   ├── config.js                # Carga de variables de entorno
│   ├── game-logic.js            # Validación de movimientos (motor)
│   ├── routes/games.js          # Endpoints REST
│   └── store/
│       ├── index.js             # Elige Supabase o memoria
│       ├── supabase.js          # Store Supabase
│       └── memory.js            # Store en memoria (desarrollo)
├── public/                      # Frontend estático (servido por Vercel)
│   ├── index.html
│   ├── css/style.css
│   ├── engine/                  # Stockfish WASM (stockfish.js + stockfish.wasm)
│   └── js/
│       ├── app.js               # UI, tablero, Realtime, polling y modo vs máquina
│       └── chess-engine.js      # Motor compartido (navegador + Node)
├── supabase/
│   ├── migrations/0001_init.sql # Tablas, RLS y Realtime
│   └── functions/validate-move/ # Edge Function serverless (Deno)
├── scripts/sync-engine.js       # Copia el motor a _shared para la Edge Function
├── test/engine.test.js          # Pruebas del motor
└── vercel.json                  # Config de Vercel
```

---

## Inicio rápido (local, sin Supabase)

```bash
npm install
npm start
# http://localhost:3000
```

Sin variables de entorno la app corre con un **store en memoria** (los datos se pierden
al reiniciar y no hay Realtime; el frontend usa polling automáticamente).

## Configurar Supabase

1. Crea un proyecto en <https://app.supabase.com>.
2. Abre **SQL Editor**, pega el contenido de `supabase/migrations/0001_init.sql` y ejecútalo.
   Esto crea las tablas `games` y `moves`, activa RLS (lectura pública) y habilita Realtime.
3. Copia `.env.example` a `.env` y completa las credenciales
   (**Project Settings → API**):

```env
PORT=3000
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_ANON_KEY=tu_anon_key
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key   # solo servidor, nunca en el frontend
```

```bash
npm start
```

Ahora el servidor persiste en Supabase y el frontend se sincroniza en tiempo real.

---

## API REST

| Método | Ruta                    | Descripción                          |
| ------ | ----------------------- | ------------------------------------ |
| GET    | `/api/health`           | Estado del servicio y del almacenamiento |
| GET    | `/api/config`           | Config pública (URL + anon key de Supabase) |
| POST   | `/api/games`            | Crear partida `{ playerId, playerName, color }` |
| GET    | `/api/games?status=waiting` | Listar partidas abiertas         |
| GET    | `/api/games/:id`        | Estado de la partida + movimientos   |
| POST   | `/api/games/:id/join`   | Unirse `{ playerId, playerName }`    |
| POST   | `/api/games/:id/move`   | Mover `{ playerId, from, to, promotion }` |
| POST   | `/api/games/:id/resign` | Rendirse `{ playerId }`              |

Los identificadores de jugador son UUID generados en el navegador y guardados en
`localStorage` (no hay login). Para producción con cuentas reales se puede añadir
**Supabase Auth** y mapear `playerId` al `auth.uid()`.

---

## Jugar contra la computadora (Stockfish en el navegador)

El botón **Jugar vs máquina** crea una partida contra **Stockfish**, que corre
**íntegramente en el navegador** como Web Worker (`public/engine/stockfish.js` +
`stockfish.wasm`). El servidor **no** calcula jugadas: solo guarda el resultado.

- La IA piensa en el cliente; cada jugada del bot se guarda por el mismo endpoint
  `/api/games/:id/move` (con `playerId = bot`) para que la partida persista.
- **Degradación sin bloqueo**: si el servidor no responde (o no existe), la partida
  continúa automáticamente en **modo local** en el navegador, sin perder el hilo.
- Dificultad: **Fácil** (Skill Level 1), **Intermedio** (8) y **Difícil** (20), ajustando
  además el tiempo de búsqueda (`movetime`).
- El `.wasm` se resuelve con `new Worker('/engine/stockfish.js#stockfish.wasm')`; no
  requiere `SharedArrayBuffer`, por lo que **no** hacen falta cabeceras COOP/COEP.

> **Licencia**: Stockfish se distribuye bajo **GPLv3**. Los archivos en `public/engine/`
> conservan esa licencia; si redistribuyes el proyecto, mantén el aviso de licencia.

---

## Función serverless de Supabase (Edge Function)

`supabase/functions/validate-move` valida un movimiento en el edge (Deno) de forma
autoritativa, reutilizando el mismo motor:

```bash
npm run sync:engine                 # copia el motor a functions/_shared
supabase functions deploy validate-move
```

```bash
curl -X POST "$SUPABASE_URL/functions/v1/validate-move" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","from":"e2","to":"e4"}'
```

---

## Despliegue en Vercel

Vercel ejecuta el backend como **función serverless** (`api/index.js`) y sirve
`public/` como sitio estático desde su CDN.

1. Importa el repositorio en <https://vercel.com/new>.
2. Framework preset: **Other** (no requiere build).
3. **Environment Variables** (Settings → Environment Variables) — imprescindibles
   en producción porque el store en memoria no persiste entre invocaciones:

   ```
   SUPABASE_URL=...
   SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```

4. Deploy. `vercel.json` ya enruta `/api/*` a la función serverless.

CLI alternativa:

```bash
npm i -g vercel
vercel                                   # preview
vercel env add SUPABASE_URL              # repite para cada variable
vercel --prod
```

> Si los archivos estáticos no se sirvieran, añade `"outputDirectory": "public"`
> a `vercel.json`. Vercel sirve por defecto el contenido de `public/` en la raíz.

---

## Pruebas

```bash
npm test
```

Ejecuta 16 pruebas del motor (movimientos, enroque, al paso, promoción, jaque mate,
ahogado, tablas, desambiguación SAN, undo y clavadas).

---

## Notas sobre serverless (Vercel)

- Cada invocación es **efímera**: no hay estado en memoria entre peticiones. En Vercel
  es obligatorio usar Supabase (configura las variables de entorno).
- El tiempo real **no** pasa por la función: el navegador se conecta directo a Supabase
  Realtime con la `anon key`. La función solo atiende REST.
- Las escrituras a la base se hacen con la `service_role`, que **nunca** debe exponerse
  al cliente; el navegador solo recibe la `anon key` vía `/api/config`.
