// TriPro · acompanhamento de projetos — e-mails de conclusão e resumo diário (Resend)
// Chamada pelo banco (gatilho e agendamento). Não confia em nada do corpo além do "tipo":
// lê o que falta enviar direto do banco e marca como enviado, então chamar duas vezes não duplica.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = Deno.env.get("EMAIL_REMETENTE") ?? "TriPro <onboarding@resend.dev>";
const LINK = Deno.env.get("LINK_PAINEL") ?? "";
const GEMINI = Deno.env.get("GEMINI_API_KEY") ?? "";            // opcional: sem ela, o resumo sai por regras fixas
const MODELO = Deno.env.get("GEMINI_MODELO") ?? "gemini-2.5-flash";

type Projeto = { id: string; nome: string; status: string; ordem: number };
type Sprint = { id: number; nome: string; inicio: string; fim: string; status: string; objetivo: string | null };
type Tarefa = { id: string; projeto_id: string; modulo: string; entrega: string; responsavel: string; peso: number; inicio_previsto: string; fim_previsto: string; estado?: string; sprint_id?: number | null; prioridade?: string };
type Avanco = { id: number; tarefa_id: string; data: string; percentual: number; observacao: string | null; autor: string | null; notificado_em: string | null };

const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
const DIA = 864e5;
const t = (d: string) => Date.parse(d + "T00:00:00Z");
const hojeSP = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const br = (d: string) => d.split("-").reverse().slice(0, 2).join("/");
const pct = (v: number) => (Math.round(v * 10) / 10).toLocaleString("pt-BR") + "%";
const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

async function carregar() {
  const [{ data: projetos }, { data: tarefas }, { data: avancos }] = await Promise.all([
    sb.from("projetos").select("*").order("ordem").order("nome"),
    sb.from("tarefas").select("*"),
    sb.from("avancos").select("*").order("data").order("id"),
  ]);
  return { projetos: (projetos ?? []) as Projeto[], tarefas: (tarefas ?? []) as Tarefa[], avancos: (avancos ?? []) as Avanco[] };
}
function curva(tarefas: Tarefa[], avancos: Avanco[], dia: string) {
  const total = tarefas.reduce((s, x) => s + Number(x.peso), 0) || 1, ref = t(dia);
  let pv = 0, ev = 0;
  for (const x of tarefas) {
    const a = t(x.inicio_previsto), b = t(x.fim_previsto) + DIA;
    pv += Number(x.peso) * Math.min(1, Math.max(0, (ref + DIA - a) / (b - a)));
    const ult = avancos.filter((v) => v.tarefa_id === x.id && t(v.data) <= ref).pop();
    ev += Number(x.peso) * (ult ? Number(ult.percentual) / 100 : 0);
  }
  return { planejado: pv / total * 100, realizado: ev / total * 100 };
}
const atual = (avancos: Avanco[], id: string) => Number(avancos.filter((v) => v.tarefa_id === id).pop()?.percentual ?? 0);

async function destinatarios(campo: "receber_conclusoes" | "receber_resumo") {
  const { data } = await sb.from("membros").select("email").eq("status", "aprovado").eq(campo, true);
  return (data ?? []).map((m) => m.email as string);
}
async function enviar(para: string[], assunto: string, html: string) {
  if (!RESEND) throw new Error("RESEND_API_KEY não configurada");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: para, subject: assunto, html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}
const moldura = (titulo: string, corpo: string) => `<div style="font-family:Arial,Helvetica,sans-serif;background:#F3F5FA;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #E2E6EF;overflow:hidden">
<div style="background:#142C65;color:#fff;padding:18px 22px"><table style="border-collapse:collapse;margin-bottom:10px"><tr><td style="width:28px;height:28px">${LINK ? `<img src="${esc(LINK.replace(/\/?$/, "/"))}icons/icon-192.png" width="28" height="28" alt="" style="display:block;border-radius:7px;background:#fff">` : `<div style="background:#2453AB;border-radius:7px;width:28px;height:28px"></div>`}</td><td style="padding-left:9px;font-size:16px;font-weight:bold;letter-spacing:.06em">TriPro</td></tr></table><div style="font-size:12px;color:#8BC4FF;letter-spacing:.06em;text-transform:uppercase">Projetos da Trium</div><div style="font-size:19px;font-weight:bold;margin-top:4px">${titulo}</div></div>
<div style="padding:20px 22px;color:#0E1730;font-size:14px;line-height:1.55">${corpo}${LINK ? `<p style="margin-top:22px"><a href="${esc(LINK)}" style="background:#2453AB;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:bold">Abrir o painel</a></p>` : ""}</div>
<div style="padding:12px 22px;font-size:12px;color:#5B6683;border-top:1px solid #EDF0F6">Você recebe este e-mail porque tem acesso aprovado ao TriPro. Para parar, desligue em Configurações no painel.</div></div></div>`;
const barra = (p: number, r: number) => `<table style="width:100%;border-collapse:collapse;margin:8px 0 4px"><tr><td style="padding:6px 0;color:#5B6683">Planejado até hoje</td><td style="text-align:right;font-weight:bold">${pct(p)}</td></tr><tr><td style="padding:6px 0;color:#5B6683">Realizado</td><td style="text-align:right;font-weight:bold;color:${r >= p - 2 ? "#137A55" : "#C3313F"}">${pct(r)}</td></tr><tr><td style="padding:6px 0;color:#5B6683">Diferença</td><td style="text-align:right;font-weight:bold">${(r - p >= 0 ? "+" : "") + (Math.round((r - p) * 10) / 10).toLocaleString("pt-BR")} p.p.</td></tr></table>`;

async function conclusoes() {
  const { projetos, tarefas, avancos } = await carregar();
  const pend = avancos.filter((v) => Number(v.percentual) === 100 && !v.notificado_em);
  if (!pend.length) return { enviados: 0 };
  if (!RESEND) return { enviados: 0, aviso: "RESEND_API_KEY não configurada" };
  const para = await destinatarios("receber_conclusoes");
  let n = 0;
  for (const v of pend) {
    const { data: marc } = await sb.from("avancos").update({ notificado_em: new Date().toISOString() }).eq("id", v.id).is("notificado_em", null).select("id");
    if (!marc?.length) continue;
    const x = tarefas.find((k) => k.id === v.tarefa_id); if (!x || !para.length) continue;
    const pj = projetos.find((k) => k.id === x.projeto_id);
    const c = curva(tarefas.filter((k) => k.projeto_id === x.projeto_id), avancos, hojeSP()), atraso = Math.round((t(v.data) - t(x.fim_previsto)) / DIA);
    const corpo = `<p style="font-size:12px;color:#335CFF;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${esc(pj?.nome ?? "")}</p><p style="font-size:16px"><b>${esc(x.entrega)}</b> foi concluída.</p>
<p style="color:#5B6683">Módulo ${esc(x.modulo)} · responsável ${esc(x.responsavel)} · lançado por ${esc(v.autor ?? "—")} em ${br(v.data)}<br>${atraso > 0 ? `<b style="color:#C3313F">${atraso} dia(s) depois do previsto (${br(x.fim_previsto)})</b>` : atraso < 0 ? `<b style="color:#137A55">${-atraso} dia(s) antes do previsto</b>` : "No prazo previsto"}</p>
${v.observacao ? `<p style="background:#F7F8FC;border-radius:8px;padding:10px 12px">${esc(v.observacao)}</p>` : ""}
<p style="margin-bottom:0"><b>Como está o ${esc(pj?.nome ?? "projeto")}</b></p>${barra(c.planejado, c.realizado)}`;
    try { await enviar(para, `Concluída · ${pj?.nome ?? ""}: ${x.entrega}`, moldura("Entrega concluída", corpo)); n++;
      await sb.from("envios").insert({ tipo: "conclusao", referencia: String(v.id), destinatarios: para.length });
    } catch (e) { await sb.from("avancos").update({ notificado_em: null }).eq("id", v.id); throw e; }
  }
  return { enviados: n };
}

/* ---------- resumo do dia: fatos calculados + texto da IA (Gemini, se houver chave) ---------- */
async function fatosDoDia(dia: string, pid = "") {
  const tudo = await carregar(), avancos = tudo.avancos;
  const projetos = pid ? tudo.projetos.filter((p) => p.id === pid) : tudo.projetos, tarefas = pid ? tudo.tarefas.filter((x) => x.projeto_id === pid) : tudo.tarefas;
  const { data: sprints } = await sb.from("sprints").select("*");
  const desde = new Date(Date.now() - 24 * 3600e3).toISOString(), ontem = new Date(t(dia) - DIA).toISOString().slice(0, 10);
  const { data: coms0 } = await sb.from("comentarios").select("tarefa_id,texto,autor").gte("criado_em", desde);
  const coms = (coms0 ?? []).filter((c) => tarefas.some((x) => x.id === c.tarefa_id));
  const nomeP = (id: string) => projetos.find((p) => p.id === id)?.nome ?? id;
  const ent = (id: string) => tarefas.find((x) => x.id === id);
  const at = (sprints as Sprint[] ?? []).find((s) => s.status === "ativa");
  const doSprint = at ? tarefas.filter((x) => x.sprint_id === at.id) : [];
  return {
    dia, escopo: pid ? `projeto ${projetos[0]?.nome ?? pid}` : "todos os projetos",
    projetos: projetos.filter((p) => p.status !== "concluido").map((p) => { const ts = tarefas.filter((x) => x.projeto_id === p.id), k = curva(ts, avancos, dia);
      return { nome: p.nome, planejado: Math.round(k.planejado), realizado: Math.round(k.realizado), entregas: ts.length, concluidas: ts.filter((x) => atual(avancos, x.id) >= 100).length }; }),
    sprint: at ? { nome: at.nome, objetivo: at.objetivo, fim: at.fim, dias_restantes: Math.round((t(at.fim) - t(dia)) / DIA),
      total: doSprint.length, concluidas: doSprint.filter((x) => x.estado === "concluida").length, em_revisao: doSprint.filter((x) => x.estado === "revisao").length, fazendo: doSprint.filter((x) => x.estado === "fazendo").length } : null,
    concluidas_desde_ontem: avancos.filter((v) => ent(v.tarefa_id) && v.data >= ontem && Number(v.percentual) >= 100 && v.autor !== "carga inicial").map((v) => ({ entrega: ent(v.tarefa_id)?.entrega, projeto: nomeP(ent(v.tarefa_id)?.projeto_id ?? "") })),
    atrasadas: tarefas.filter((x) => x.fim_previsto < dia && atual(avancos, x.id) < 100).map((x) => ({ entrega: x.entrega, projeto: nomeP(x.projeto_id), responsavel: x.responsavel, previsto: x.fim_previsto, dias_atraso: Math.round((t(dia) - t(x.fim_previsto)) / DIA), avanco: atual(avancos, x.id) })),
    vencem_em_3_dias: tarefas.filter((x) => x.fim_previsto >= dia && t(x.fim_previsto) <= t(dia) + 3 * DIA && atual(avancos, x.id) < 100).map((x) => ({ entrega: x.entrega, projeto: nomeP(x.projeto_id), responsavel: x.responsavel, previsto: x.fim_previsto, avanco: atual(avancos, x.id) })),
    comentarios_24h: coms.map((c) => ({ entrega: ent(c.tarefa_id)?.entrega, autor: c.autor, texto: String(c.texto).slice(0, 300) })),
  };
}
function resumoPorRegras(f: Awaited<ReturnType<typeof fatosDoDia>>) {
  const L: string[] = [];
  const ruins = f.projetos.filter((p) => p.realizado < p.planejado - 2);
  L.push(f.projetos.map((p) => `${p.nome}: ${p.realizado}% realizado de ${p.planejado}% planejado`).join("; ") + ".");
  if (f.sprint) L.push(`Sprint ${f.sprint.nome}: ${f.sprint.concluidas} de ${f.sprint.total} tarefas concluídas, ${f.sprint.dias_restantes} dia(s) para o fim.`);
  if (f.concluidas_desde_ontem.length) L.push(`Concluídas desde ontem: ${f.concluidas_desde_ontem.map((c) => c.entrega).join(", ")}.`);
  L.push(f.atrasadas.length ? `Atenção: ${f.atrasadas.length} entrega(s) atrasada(s), a mais antiga é "${f.atrasadas.sort((a, b) => b.dias_atraso - a.dias_atraso)[0].entrega}".` : "Nenhuma entrega atrasada.");
  if (f.vencem_em_3_dias.length) L.push(`Vencem nos próximos 3 dias: ${f.vencem_em_3_dias.map((x) => x.entrega).join(", ")}.`);
  if (ruins.length) L.push(`Abaixo do plano: ${ruins.map((p) => p.nome).join(", ")}.`);
  return L.join("\n");
}
async function gemini(prompt: string, max = 600) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: max } }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const txt = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("").trim();
  if (!txt) throw new Error("Gemini sem texto");
  return txt;
}
async function resumoPorIA(f: { escopo: string }) {
  const prompt = `Você é o assistente de gestão de projetos da Trium. Com base SOMENTE nos dados JSON abaixo (escopo: ${f.escopo}), escreva o resumo do dia em português do Brasil para os sócios.
Formato: 1 parágrafo curto (até 3 frases) com o panorama geral; depois até 4 linhas começando com "• " com os pontos de atenção e o que fazer hoje. Sem títulos, sem markdown além de "• ", até 120 palavras. Não invente nomes, números ou datas que não estejam nos dados. Datas no formato dd/mm.
DADOS:
${JSON.stringify(f)}`;
  return await gemini(prompt);
}
/* pergunta livre sobre os projetos (só aprovados; só com chave da IA) */
async function perguntar(pergunta: string, pid: string) {
  if (!GEMINI) return { erro: "A IA ainda não foi configurada (segredo GEMINI_API_KEY no Supabase)." };
  const q = String(pergunta ?? "").trim().slice(0, 500);
  if (!q) return { erro: "Escreva uma pergunta." };
  const dia = hojeSP(), f = await fatosDoDia(dia, pid);
  const { projetos, tarefas, avancos } = await carregar();
  const { data: sprints } = await sb.from("sprints").select("id,nome,inicio,fim,status");
  const lista = tarefas.filter((x) => !pid || x.projeto_id === pid).map((x) => ({ entrega: x.entrega, projeto: projetos.find((p) => p.id === x.projeto_id)?.nome, modulo: x.modulo, responsavel: x.responsavel, estado: x.estado, prioridade: x.prioridade, inicio: x.inicio_previsto, prazo: x.fim_previsto, avanco: atual(avancos, x.id), sprint: (sprints ?? []).find((s) => s.id === x.sprint_id)?.nome ?? "backlog" }));
  const prompt = `Você é o assistente do TriPro, app de acompanhamento dos projetos da Trium. Hoje é ${dia}. Responda em português do Brasil, direto e curto (até 120 palavras), usando SOMENTE os dados JSON abaixo. Se a resposta não estiver nos dados, diga que não há essa informação no TriPro. Pode usar linhas começando com "• " para listas. Datas no formato dd/mm. Não invente nada.
RESUMO: ${JSON.stringify(f)}
TAREFAS: ${JSON.stringify(lista)}
SPRINTS: ${JSON.stringify(sprints ?? [])}
PERGUNTA: ${q}`;
  return { resposta: await gemini(prompt, 700) };
}
async function gerarResumo(forcar: boolean) {
  const dia = hojeSP();
  const { data: ja } = await sb.from("resumos").select("dia,criado_em").eq("dia", dia).eq("projeto_id", "").maybeSingle();
  if (ja && (!forcar || Date.now() - Date.parse(ja.criado_em) < 5 * 60e3)) return { gerado: false, aviso: "resumo de hoje já existe" };
  const { data: ps } = await sb.from("projetos").select("id").neq("status", "concluido");
  let fonteGeral: "ia" | "regras" = "regras";
  for (const pid of ["", ...(ps ?? []).map((p) => p.id as string)]) {
    const f = await fatosDoDia(dia, pid);
    let texto = "", fonte: "ia" | "regras" = "regras";
    if (GEMINI) { try { texto = await resumoPorIA(f); fonte = "ia"; } catch (e) { console.error(e); } }
    if (!texto) texto = resumoPorRegras(f);
    if (!pid) fonteGeral = fonte;
    await sb.from("resumos").upsert({ dia, projeto_id: pid, texto, fonte, criado_em: new Date().toISOString() });
  }
  return { gerado: true, fonte: fonteGeral };
}
async function quemChama(req: Request) {
  const tk = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!tk) return null;
  const { data } = await sb.auth.getUser(tk);
  if (!data?.user) return null;
  const { data: m } = await sb.from("membros").select("status").eq("user_id", data.user.id).maybeSingle();
  return m?.status === "aprovado" ? data.user : null;
}

/* ---------- notificações por e-mail (menções e convites de evento) ---------- */
async function notificacoes() {
  if (!RESEND) return { enviados: 0, aviso: "RESEND_API_KEY não configurada" };
  const { data: pend } = await sb.from("notificacoes").select("*").is("email_em", null).in("tipo", ["mencao", "evento"]).order("id").limit(50);
  let n = 0;
  for (const k of pend ?? []) {
    const { data: marc } = await sb.from("notificacoes").update({ email_em: new Date().toISOString() }).eq("id", k.id).is("email_em", null).select("id");
    if (!marc?.length) continue;
    const { data: m } = await sb.from("membros").select("email,status").eq("user_id", k.user_id).maybeSingle();
    if (!m || m.status !== "aprovado") continue;
    let ctx = "";
    if (k.tarefa_id) { const { data: x } = await sb.from("tarefas").select("entrega").eq("id", k.tarefa_id).maybeSingle(); if (x) ctx = `<p style="color:#5B6683;margin:0 0 8px">Na tarefa <b>${esc(x.entrega)}</b></p>`; }
    const corpo = ctx + (k.texto ? `<p style="background:#F1F6FF;border-radius:10px;padding:12px 14px;white-space:pre-line">${esc(k.texto)}</p>` : "");
    try { await enviar([m.email], `TriPro · ${k.titulo}`, moldura(esc(k.titulo), corpo)); n++; }
    catch (e) { await sb.from("notificacoes").update({ email_em: null }).eq("id", k.id); throw e; }
  }
  return { enviados: n };
}

async function resumo() {
  const dia = hojeSP();
  if (!RESEND) return { enviado: false, aviso: "RESEND_API_KEY não configurada" };
  const { data: reg, error } = await sb.from("envios").insert({ tipo: "resumo", referencia: dia }).select("id");
  if (error || !reg?.length) return { enviado: false, aviso: "resumo de hoje já enviado" };
  try {
    const { projetos, tarefas, avancos } = await carregar();
    const para = await destinatarios("receber_resumo");
    if (!para.length) return { enviado: false, aviso: "ninguém para receber" };
    const ontem = new Date(t(dia) - DIA).toISOString().slice(0, 10);
    await gerarResumo(false).catch((e) => console.error(e));
    const { data: rs } = await sb.from("resumos").select("texto").eq("dia", dia).eq("projeto_id", "").maybeSingle();
    const ativos = projetos.filter((p) => p.status !== "concluido");
    const tabela = `<table style="width:100%;border-collapse:collapse;margin:6px 0 16px;font-size:13px"><tr style="color:#5B6683;text-align:left"><th style="padding:6px 0">Projeto</th><th style="text-align:right">Planejado</th><th style="text-align:right">Realizado</th></tr>${ativos.map((p) => { const k = curva(tarefas.filter((x) => x.projeto_id === p.id), avancos, dia); return `<tr style="border-top:1px solid #EDF0F6"><td style="padding:7px 0;font-weight:bold">${esc(p.nome)}</td><td style="text-align:right">${pct(k.planejado)}</td><td style="text-align:right;font-weight:bold;color:${k.realizado >= k.planejado - 2 ? "#137A55" : "#C3313F"}">${pct(k.realizado)}</td></tr>`; }).join("")}</table>`;
    const tag = (tid: string) => { const t0 = tarefas.find((x) => x.id === tid); const p = projetos.find((k) => k.id === t0?.projeto_id); return p ? `<span style="color:#335CFF;font-weight:bold">${esc(p.nome)}</span> · ` : ""; };
    const ok = avancos.filter((v) => v.data >= ontem && v.autor !== "carga inicial");
    const concl = ok.filter((v) => Number(v.percentual) === 100);
    const outros = ok.filter((v) => Number(v.percentual) < 100);
    const atras = tarefas.filter((x) => x.fim_previsto < dia && atual(avancos, x.id) < 100);
    const seg = new Date(t(dia) - ((new Date(t(dia)).getUTCDay() + 6) % 7) * DIA).toISOString().slice(0, 10), dom = new Date(t(seg) + 6 * DIA).toISOString().slice(0, 10);
    const semana = tarefas.filter((x) => x.fim_previsto >= seg && x.fim_previsto <= dom);
    const desde = new Date(Date.now() - 24 * 3600e3).toISOString();
    const { data: coms } = await sb.from("comentarios").select("tarefa_id,texto,autor,criado_em").gte("criado_em", desde).order("criado_em");
    const nome = (id: string) => tag(id) + esc(tarefas.find((x) => x.id === id)?.entrega ?? id);
    const lista = (itens: string[], vazio: string) => itens.length ? `<ul style="padding-left:18px;margin:6px 0 14px">${itens.map((i) => `<li style="margin:4px 0">${i}</li>`).join("")}</ul>` : `<p style="color:#5B6683;margin:6px 0 14px">${vazio}</p>`;
    const linhas = String(rs?.texto ?? "").split("\n").map((l: string) => l.trim()).filter(Boolean), par = linhas.filter((l: string) => !/^[•\-*]\s*/.test(l)), pts = linhas.filter((l: string) => /^[•\-*]\s*/.test(l)).map((l: string) => l.replace(/^[•\-*]\s*/, ""));
    const corpo = (rs?.texto ? `<div style="background:#F1F6FF;border-radius:10px;padding:12px 14px;margin-bottom:16px">${par.map((p: string) => `<p style="margin:0 0 8px">${esc(p)}</p>`).join("")}${pts.length ? `<ul style="margin:0;padding-left:18px">${pts.map((p: string) => `<li style="margin:4px 0">${esc(p)}</li>`).join("")}</ul>` : ""}</div>` : "") +
      `<p style="margin:0"><b>Projetos</b></p>` + tabela +
      `<p style="margin:0"><b>Concluídas desde ontem</b></p>` + lista(concl.map((v) => `${nome(v.tarefa_id)} <span style="color:#5B6683">· ${esc(v.autor ?? "")}</span>`), "Nenhuma.") +
      `<p style="margin:0"><b>Outros avanços</b></p>` + lista(outros.map((v) => `${nome(v.tarefa_id)}: ${pct(Number(v.percentual))}`), "Nenhum.") +
      `<p style="margin:0"><b>Atrasadas</b></p>` + lista(atras.map((x) => `${tag(x.id)}${esc(x.entrega)} <span style="color:#C3313F">· previsto ${br(x.fim_previsto)} · ${pct(atual(avancos, x.id))}</span>`), "Nenhuma entrega atrasada.") +
      `<p style="margin:0"><b>Previstas para esta semana</b></p>` + lista(semana.map((x) => `${tag(x.id)}${esc(x.entrega)} · ${br(x.fim_previsto)} · ${esc(x.responsavel)} · ${pct(atual(avancos, x.id))}`), "Nenhuma.") +
      `<p style="margin:0"><b>Comentários novos</b></p>` + lista((coms ?? []).map((k) => `<b>${nome(k.tarefa_id)}</b> · ${esc(k.autor ?? "")}: “${esc(k.texto)}”`), "Nenhum.");
    await enviar(para, `TriPro · resumo de ${br(dia)}`, moldura(`Resumo de ${br(dia)}`, corpo));
    await sb.from("envios").update({ destinatarios: para.length }).eq("id", reg[0].id);
    return { enviado: true, destinatarios: para.length };
  } catch (e) { await sb.from("envios").delete().eq("id", reg[0].id); throw e; }
}

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const corpo = await req.json().catch(() => ({ tipo: "" }));
    const { tipo } = corpo;
    if (tipo === "resumo_ia") { const u = await quemChama(req); return json(await gerarResumo(!!u)); }
    if (tipo === "perguntar") { const u = await quemChama(req); if (!u) return json({ erro: "acesso não aprovado" }, 401); return json(await perguntar(corpo.pergunta, corpo.projeto_id ?? "")); }
    if (tipo === "conclusao") return json(await conclusoes());
    if (tipo === "notificacoes") return json(await notificacoes());
    if (tipo === "resumo") return json(await resumo());
    return json({ erro: "tipo inválido" }, 400);
  } catch (e) { console.error(e); return json({ erro: String((e as Error).message ?? e) }, 500); }
});
