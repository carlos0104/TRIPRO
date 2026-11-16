// TriPro · webhook do GitHub: commits e pull requests que citam #CODIGO da tarefa movem o quadro sozinhos.
// URL do webhook: https://<projeto>.supabase.co/functions/v1/github  (Content type: application/json)
// Segredo: crie uma senha qualquer, coloque no GitHub (campo Secret) e no Supabase (segredo GITHUB_WEBHOOK_SECRET).
// Regras: citou #ID → tarefa sai de "A fazer" para "Fazendo".
//         "fecha/closes/fixes/resolve/conclui/finaliza #ID" ou PR com merge → vai para "Em revisão".
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SEGREDO = Deno.env.get("GITHUB_WEBHOOK_SECRET") ?? "";
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

async function assinaturaOk(corpo: string, cab: string | null) {
  if (!cab?.startsWith("sha256=")) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SEGREDO), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(corpo)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const a = cab.slice(7);
  if (a.length !== hex.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ hex.charCodeAt(i);
  return d === 0;
}
const REF = /#([A-Za-z0-9_-]{2,24})/g;
const FECHA = /(fecha|fechou|closes?|closed|fix(es|ed)?|resolve[sd]?|conclui|concluído|finaliza|finalizado)\s*:?\s*#([A-Za-z0-9_-]{2,24})/gi;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: true, info: "Webhook do TriPro. Configure no GitHub com Content type application/json." });
  if (!SEGREDO) return json({ erro: "Configure o segredo GITHUB_WEBHOOK_SECRET no Supabase." }, 503);
  const corpo = await req.text();
  if (!(await assinaturaOk(corpo, req.headers.get("x-hub-signature-256")))) return json({ erro: "assinatura inválida" }, 401);
  const evento = req.headers.get("x-github-event") ?? "";
  if (evento === "ping") return json({ ok: true, pong: true });
  const p = JSON.parse(corpo);
  const repo = p.repository?.full_name ?? "";
  const itens: { tipo: "commit" | "pr"; sha: string; msg: string; autor: string; url: string; data: string; fecha: boolean }[] = [];
  if (evento === "push") for (const c of p.commits ?? []) itens.push({ tipo: "commit", sha: c.id, msg: c.message ?? "", autor: c.author?.username || c.author?.name || "", url: c.url, data: c.timestamp, fecha: false });
  if (evento === "pull_request" && p.pull_request) { const pr = p.pull_request, merged = p.action === "closed" && pr.merged;
    if (["opened", "edited", "reopened"].includes(p.action) || merged) itens.push({ tipo: "pr", sha: "pr-" + pr.number + (merged ? "-merge" : ""), msg: `${pr.title}\n${pr.body ?? ""}`, autor: pr.user?.login ?? "", url: pr.html_url, data: pr.updated_at, fecha: merged }); }
  if (!itens.length) return json({ ok: true, ignorado: evento });

  const { data: ts } = await sb.from("tarefas").select("id,estado");
  const porId = new Map((ts ?? []).map((x) => [String(x.id).toUpperCase(), x]));
  let ligados = 0; const movidas: string[] = [];
  for (const it of itens) {
    const refs = new Set([...it.msg.matchAll(REF)].map((m) => m[1].toUpperCase()).filter((id) => porId.has(id)));
    const fechar = new Set([...it.msg.matchAll(FECHA)].map((m) => m[3].toUpperCase()));
    for (const id of refs) {
      const x = porId.get(id)!;
      const { error } = await sb.from("commits").upsert({ tarefa_id: x.id, tipo: it.tipo, repo, sha: it.sha, mensagem: it.msg.slice(0, 500), autor: it.autor, url: it.url, data: it.data || new Date().toISOString() }, { onConflict: "tarefa_id,sha", ignoreDuplicates: true });
      if (!error) ligados++;
      const novo = (it.fecha || fechar.has(id)) ? "revisao" : (x.estado === "a_fazer" ? "fazendo" : null);
      if (novo && x.estado !== "concluida" && x.estado !== novo && !(novo === "fazendo" && x.estado === "revisao")) {
        await sb.from("tarefas").update({ estado: novo }).eq("id", x.id); x.estado = novo; movidas.push(`${x.id}:${novo}`);
      }
    }
  }
  return json({ ok: true, ligados, movidas });
});
