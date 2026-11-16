// TriPro · traz a agenda pessoal (Google Agenda ou Outlook.com) para dentro do TriPro.
// Lê o link secreto .ics de cada pessoa (guardado só no servidor), expande eventos recorrentes
// e grava as ocorrências de 30 dias atrás até 120 dias à frente.
// Chamado a cada 15 min pelo pg_cron (todos) ou pelo botão "Sincronizar agora" (só quem chamou).
import ICAL from "npm:ical.js@2.2.1";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const CHAVE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const HOSTS = /^https:\/\/(calendar\.google\.com|outlook\.live\.com|outlook\.office365\.com|outlook\.office\.com|p\d+-caldav\.icloud\.com)\//i;
const DIA = 864e5;

async function rpc(fn: string, body: unknown, token = CHAVE) {
  const r = await fetch(`${URL_SB}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: CHAVE, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
async function quemChama(req: Request): Promise<string | null> {
  const a = req.headers.get("authorization") || "";
  const tk = a.replace(/^Bearer\s+/i, "");
  if (!tk || tk === CHAVE || !tk.includes(".")) return null;
  const r = await fetch(`${URL_SB}/auth/v1/user`, { headers: { apikey: CHAVE, Authorization: `Bearer ${tk}` } });
  if (!r.ok) return null; const u = await r.json(); return u?.id ?? null;
}

type Oc = { uid: string; titulo: string; local: string | null; dia_inteiro: boolean; inicio: string; fim: string };
// deno-lint-ignore no-explicit-any
function ocorrencias(texto: string, deMs: number, ateMs: number, max = 1500): Oc[] {
  const comp = new ICAL.Component(ICAL.parse(texto));
  for (const tz of comp.getAllSubcomponents("vtimezone")) { try { ICAL.TimezoneService.register(tz); } catch (_) { /* fuso inválido */ } }
  // deno-lint-ignore no-explicit-any
  const mestres: any[] = [], excecoes: any[] = [];
  for (const v of comp.getAllSubcomponents("vevent")) {
    if (String(v.getFirstPropertyValue("status") || "").toUpperCase() === "CANCELLED") continue;
    const ev = new ICAL.Event(v);
    if (ev.isRecurrenceException()) excecoes.push(ev); else mestres.push(ev);
  }
  for (const ex of excecoes) { const m = mestres.find((e) => e.uid === ex.uid); if (m) m.relateException(ex); }
  const out: Oc[] = [], de = ICAL.Time.fromJSDate(new Date(deMs), true);
  // deno-lint-ignore no-explicit-any
  const add = (uid: string, tit: string, local: any, ini: any, fim: any) => {
    const s = ini.toJSDate().getTime(), f = fim ? fim.toJSDate().getTime() : s;
    if (f < deMs || s > ateMs) return;
    out.push({ uid: uid + "@" + ini.toString(), titulo: String(tit || "(sem título)").slice(0, 200), local: local ? String(local).slice(0, 200) : null, dia_inteiro: !!ini.isDate,
      inicio: ini.isDate ? ini.toString().slice(0, 10) : new Date(s).toISOString(),
      fim: ini.isDate ? (fim && fim.compare(ini) > 0 ? new Date(Date.UTC(fim.year, fim.month - 1, fim.day) - DIA).toISOString().slice(0, 10) : ini.toString().slice(0, 10)) : new Date(f).toISOString() });
  };
  for (const ev of mestres) {
    if (out.length >= max) break;
    if (!ev.startDate) continue;
    if (!ev.isRecurring()) { add(ev.uid, ev.summary, ev.location, ev.startDate, ev.endDate); continue; }
    const it = ev.iterator(); let n = 0, t;
    while ((t = it.next()) && n < 800) { n++;
      if (t.toJSDate().getTime() > ateMs) break;
      const d = ev.getOccurrenceDetails(t);
      if (d.endDate.compare(de) < 0) continue;
      if (String(d.item.component.getFirstPropertyValue("status") || "").toUpperCase() === "CANCELLED") continue;
      add(ev.uid, d.item.summary, d.item.location, d.startDate, d.endDate);
      if (out.length >= max) break; }
  }
  return out;
}

async function sincronizar(u: { user_id: string; url: string }) {
  try {
    if (!HOSTS.test(u.url)) throw new Error("Link não permitido. Use o link .ics do Google Agenda ou do Outlook.com.");
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(u.url, { signal: ctl.signal, redirect: "follow", headers: { "User-Agent": "TriPro-Agenda/1.0" } }); clearTimeout(tm);
    if (!r.ok) throw new Error(r.status === 404 || r.status === 403 ? "O link não funciona mais. Gere um novo link na sua agenda e cole de novo." : `A agenda respondeu ${r.status}.`);
    const txt = await r.text();
    if (txt.length > 8_000_000) throw new Error("Agenda grande demais (mais de 8 MB).");
    if (!/BEGIN:VCALENDAR/i.test(txt)) throw new Error("O link não é de uma agenda .ics. Confira se copiou o endereço no formato iCal.");
    const agora = Date.now(), evs = ocorrencias(txt, agora - 30 * DIA, agora + 120 * DIA);
    await rpc("gravar_sincronizacao", { u: u.user_id, eventos: evs, falha: null });
    return { ok: true, total: evs.length };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "A agenda demorou demais para responder." : e.message) : String(e);
    await rpc("gravar_sincronizacao", { u: u.user_id, eventos: [], falha: msg }).catch(() => {});
    return { ok: false, erro: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const eu = await quemChama(req);
    const lista: { user_id: string; url: string }[] = await rpc("agendas_para_sincronizar", { so: eu }) ?? [];
    if (eu) { if (!lista.length) return json({ ok: false, erro: "Nenhuma agenda conectada." }); return json(await sincronizar(lista[0])); }
    let ok = 0, falhas = 0;
    for (const u of lista) { const r = await sincronizar(u); r.ok ? ok++ : falhas++; }
    return json({ ok: true, sincronizadas: ok, falhas });
  } catch (e) { return json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, 500); }
});
