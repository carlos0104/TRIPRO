// TRIPRO · calendário iCal para assinar no Google Agenda ou no Outlook.
// URL: https://<projeto>.supabase.co/functions/v1/agenda?t=<token pessoal>
// O token é secreto e pessoal (Configurações > Agenda). Sem token válido, responde 404.
const URL_SB = Deno.env.get("SUPABASE_URL")!;
const CHAVE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const esc = (s: unknown) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const dobra = (l: string) => { const out: string[] = []; let s = l; while (new TextEncoder().encode(s).length > 73) { let n = 73; while (new TextEncoder().encode(s.slice(0, n)).length > 73) n--; out.push(s.slice(0, n)); s = " " + s.slice(n); } out.push(s); return out.join("\r\n"); };
const utc = (d: string | Date) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dia = (d: string) => d.slice(0, 10).replace(/-/g, "");
const proxDia = (d: string) => { const x = new Date(d.slice(0, 10) + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10).replace(/-/g, ""); };

Deno.serve(async (req) => {
  const t = new URL(req.url).searchParams.get("t") || "";
  if (!/^[0-9a-f-]{36}$/i.test(t)) return new Response("não encontrado", { status: 404 });
  const r = await fetch(`${URL_SB}/rest/v1/rpc/agenda_por_token`, {
    method: "POST", headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ t }),
  });
  const d = r.ok ? await r.json() : null;
  if (!d) return new Response("não encontrado", { status: 404 });

  const agora = utc(new Date()), L: string[] = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Trium//TRIPRO//PT-BR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:TRIPRO", "X-WR-TIMEZONE:America/Sao_Paulo", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
  ];
  const ev = (uid: string, campos: string[]) => { L.push("BEGIN:VEVENT", `UID:${uid}@tripro`, `DTSTAMP:${agora}`, ...campos, "END:VEVENT"); };
  for (const e of d.eventos) ev(`evento-${e.id}`, [
    ...(e.dia_inteiro ? [`DTSTART;VALUE=DATE:${dia(e.inicio)}`, `DTEND;VALUE=DATE:${proxDia(e.fim)}`] : [`DTSTART:${utc(e.inicio)}`, `DTEND:${utc(e.fim)}`]),
    `SUMMARY:${esc(e.titulo)}`, ...(e.local ? [`LOCATION:${esc(e.local)}`] : []),
    `DESCRIPTION:${esc([e.projeto && "Projeto: " + e.projeto, e.descricao].filter(Boolean).join("\n"))}`]);
  for (const p of d.prazos) ev(`prazo-${p.id}`, [`DTSTART;VALUE=DATE:${dia(p.fim)}`, `DTEND;VALUE=DATE:${proxDia(p.fim)}`, "TRANSP:TRANSPARENT",
    `SUMMARY:${esc((p.estado === "concluida" ? "✓ " : "Prazo: ") + p.entrega)}`, `DESCRIPTION:${esc(`Projeto: ${p.projeto}\nResponsável: ${p.responsavel}`)}`]);
  for (const s of d.sprints) ev(`sprint-${s.id}`, [`DTSTART;VALUE=DATE:${dia(s.inicio)}`, `DTEND;VALUE=DATE:${proxDia(s.fim)}`, "TRANSP:TRANSPARENT",
    `SUMMARY:${esc("Sprint · " + s.nome)}`, ...(s.objetivo ? [`DESCRIPTION:${esc(s.objetivo)}`] : [])]);
  L.push("END:VCALENDAR");
  return new Response(L.map(dobra).join("\r\n") + "\r\n", {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="tripro.ics"', "Cache-Control": "private, max-age=300" },
  });
});
