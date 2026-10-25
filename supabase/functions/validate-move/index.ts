// Supabase Edge Function (serverless, runtime Deno)
// Valida un movimiento de ajedrez de forma autoritativa y devuelve el estado
// resultante. No necesita base de datos: es una funcion pura.
//
// Deploy:  supabase functions deploy validate-move
// Llamada: POST /functions/v1/validate-move
//   { "fen": "...", "from": "e2", "to": "e4", "promotion": "q" }

import "../_shared/chess-engine.js";

const engine = (globalThis as any).ChessEngine;
const Chess = engine.Chess;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Usa POST" }, 405);

  return req
    .json()
    .then((body: any) => {
      const { fen, from, to, promotion } = body ?? {};
      if (!fen || !from || !to) {
        return json({ error: "fen, from y to son requeridos" }, 400);
      }

      const chess = new Chess(fen);
      const move = chess.move({ from, to, promotion });
      if (!move) return json({ legal: false, error: "Movimiento ilegal" }, 422);

      return json({
        legal: true,
        san: move.san,
        from: engine.algebraic(move.from),
        to: engine.algebraic(move.to),
        promotion: move.promotion ?? null,
        fen: chess.fen(),
        turn: chess.turn,
        check: chess.inCheck(),
        checkmate: chess.isCheckmate(),
        result: chess.result(),
      });
    })
    .catch(() => json({ error: "JSON invalido" }, 400));
});
