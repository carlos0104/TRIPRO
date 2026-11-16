// TriPro · notificações no celular (Web Push).
// tipo "chave": devolve a chave pública (cria o par VAPID na primeira vez e guarda só no banco).
// tipo "notificacao": chamado pelo gatilho do banco quando nasce uma notificação; envia para os aparelhos da pessoa.
// tipo "teste": envia um aviso de teste para quem chamou (precisa estar logado).
import webpush from "npm:web-push@3.6.7";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const CHAVE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = Deno.env.get("LINK_PAINEL") ?? "https://carlos0104.github.io/TRIPRO/";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function rpc(fn: string, body: unknown) {
  const r = await fetch(`${URL_SB}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
async function quemChama(req: Request): Promise<string | null> {
  const tk = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tk || tk === CHAVE || !tk.includes(".")) return null;
  const r = await fetch(`${URL_SB}/auth/v1/user`, { headers: { apikey: CHAVE, Authorization: `Bearer ${tk}` } });
  if (!r.ok) return null; const u = await r.json(); return u?.id ?? null;
}
async function chaves(): Promise<{ publica: string; privada: string }> {
  let k = await rpc("push_chaves", {});
  if (!k) { const n = webpush.generateVAPIDKeys(); k = await rpc("push_chaves", { nova_publica: n.publicKey, nova_privada: n.privateKey }); }
  return k;
}
type Insc = { endpoint: string; p256dh: string; auth: string };
async function enviar(ins: Insc[], dados: Record<string, unknown>) {
  const k = await chaves();
  webpush.setVapidDetails(SITE, k.publica, k.privada);
  let ok = 0, removidas = 0; const erros: string[] = [];
  for (const s of ins) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(dados), { TTL: 86400, urgency: "high" });
      ok++;
    } catch (e) {
      // deno-lint-ignore no-explicit-any
      const st = (e as any)?.statusCode;
      if (st === 404 || st === 410) { await rpc("push_remover", { ep: s.endpoint }).catch(() => {}); removidas++; }
      else erros.push(String(st ?? (e instanceof Error ? e.message : e)).slice(0, 120));
    }
  }
  return { ok, removidas, erros };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const b = await req.json().catch(() => ({}));
    if (b.tipo === "chave") return json({ chave: (await chaves()).publica });
    if (b.tipo === "notificacao") {
      const d = await rpc("push_pendente", { nid: Number(b.id) || 0 });
      if (!d || !d.inscricoes?.length) return json({ ok: true, enviados: 0 });
      const n = d.notificacao;
      return json(await enviar(d.inscricoes, { titulo: n.titulo, texto: n.texto || "", url: SITE + "#/hoje", tag: "n" + n.id, nao_lidas: d.nao_lidas, id: n.id, tarefa_id: n.tarefa_id }));
    }
    if (b.tipo === "teste") {
      const u = await quemChama(req); if (!u) return json({ erro: "entre no TriPro" }, 401);
      const d = await rpc("push_do_usuario", { u });
      return json(await enviar(d.inscricoes || [], { titulo: "Notificações ativadas", texto: "Pronto: os avisos do TriPro vão chegar aqui.", url: SITE + "#/hoje", tag: "teste", nao_lidas: d.nao_lidas }));
    }
    return json({ erro: "tipo desconhecido" }, 400);
  } catch (e) { return json({ erro: e instanceof Error ? e.message : String(e) }, 500); }
});
