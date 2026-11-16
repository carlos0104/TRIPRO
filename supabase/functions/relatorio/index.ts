// TriPro · dados do relatório de leitura para o cliente (relatorio.html?t=<token>).
// Só devolve dados de um projeto com link ativo; sem nomes de pessoas nem comentários.
const URL_SB = Deno.env.get("SUPABASE_URL")!;
const CHAVE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, apikey, authorization", "Access-Control-Allow-Methods": "GET, OPTIONS" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const t = new URL(req.url).searchParams.get("t") || "";
  const r404 = () => new Response(JSON.stringify({ erro: "link inválido ou desativado" }), { status: 404, headers: { ...CORS, "Content-Type": "application/json" } });
  if (!/^[0-9a-f-]{36}$/i.test(t)) return r404();
  const r = await fetch(`${URL_SB}/rest/v1/rpc/relatorio_publico`, {
    method: "POST", headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, "Content-Type": "application/json" }, body: JSON.stringify({ t }),
  });
  const d = r.ok ? await r.json() : null;
  if (!d) return r404();
  return new Response(JSON.stringify(d), { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=120" } });
});
