import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { requireAuth } from "@/lib/ops_guard";
import { ajustarClienteVendaAoConsumidor } from "@/lib/obs_parse";
import { fetchGestorWithSession, loginGestor } from "@/lib/gestor_session";
import { parseRelatorio20Xlsx, type RelatorioPedido } from "@/lib/gestor_relatorio";

export const runtime = "nodejs";

function bad(msg: string, status = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status });
}

function authOk(req: Request): boolean {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization") || "";
  const headerSecret = req.headers.get("x-cron-secret") || "";
  return auth === `Bearer ${secret}` || headerSecret === secret;
}

function envOrDefault(name: string, fallback: string): string {
  const v = String(process.env[name] || "").trim();
  return v || fallback;
}

function todayPtBR(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = String(now.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function applyTemplate(value: string, vars: Record<string, string>): string {
  let out = value;
  for (const [key, val] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, val);
  }
  return out;
}

function buildPrepareFields(raw: string | null, vars: Record<string, string>): Record<string, string> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, string>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = applyTemplate(String(v ?? ""), vars);
    }
    return out;
  } catch {
    throw new Error("GESTOR_RELATORIO_PREPARE_FIELDS_JSON invalido");
  }
}

async function fetchRelatorio20Xlsx(dateStr: string): Promise<Buffer> {
  const relatorioUrl = envOrDefault(
    "GESTOR_RELATORIO_URL",
    "https://www.gestorsistemas.inf.br/sistema/app/relatorio/?nCodigo_Relatorio=20"
  );
  const exportUrl = envOrDefault(
    "GESTOR_RELATORIO_EXPORT_URL",
    "https://www.gestorsistemas.inf.br/sistema/app/relatorio/gerar_excel2.php?nCodigo_Relatorio=20"
  );

  const prepareUrl = envOrDefault("GESTOR_RELATORIO_PREPARE_URL", relatorioUrl);
  const prepareMethod = String(process.env.GESTOR_RELATORIO_PREPARE_METHOD || "POST").toUpperCase();
  const rawPrepareFields = String(process.env.GESTOR_RELATORIO_PREPARE_FIELDS_JSON || "").trim() || null;

  const vars = { date: dateStr };
  const prepareFields = buildPrepareFields(rawPrepareFields, vars);
  const baseHeaders = { "user-agent": "Mozilla/5.0" };

  await fetchGestorWithSession(relatorioUrl, { method: "GET", headers: baseHeaders });

  if (Object.keys(prepareFields).length > 0) {
    const params = new URLSearchParams(prepareFields);
    const target =
      prepareMethod === "GET"
        ? `${prepareUrl}${prepareUrl.includes("?") ? "&" : "?"}${params.toString()}`
        : prepareUrl;

    const init: RequestInit = {
      method: prepareMethod,
      headers: {
        ...baseHeaders,
        referer: relatorioUrl,
        ...(prepareMethod === "GET"
          ? {}
          : { "content-type": "application/x-www-form-urlencoded" }),
      },
      body: prepareMethod === "GET" ? undefined : params.toString(),
    };

    await fetchGestorWithSession(target, init);
  }

  const { res } = await fetchGestorWithSession(exportUrl, {
    method: "GET",
    headers: { ...baseHeaders, referer: relatorioUrl },
  });

  if (!res.ok) {
    throw new Error(`Falha ao baixar relatório (${res.status})`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

async function importPedidos(pedidos: RelatorioPedido[]) {
  let imported = 0;
  let skipped = 0;

  for (const p of pedidos) {
    const dup = await q<any>("select id from orders where pedido_num = $1 limit 1", [p.pedido_num]);
    if ((dup.rowCount ?? 0) > 0) {
      skipped += 1;
      continue;
    }

    const observacao = p.observacao || null;
    const ajustado = ajustarClienteVendaAoConsumidor(p.cliente_nome, "", observacao || undefined);
    const cliente_nome = (ajustado?.cliente_nome || p.cliente_nome || "Cliente").trim();
    const telefone = ajustado?.telefone || null;

    await q("begin");
    try {
      const ins = await q<any>(
        `insert into orders (pedido_num, token, cliente_nome, telefone, status, agendado_para, observacao)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id, token`,
        [p.pedido_num, cryptoRandomToken(), cliente_nome, telefone, "RECEBIDO", null, observacao]
      );

      const orderId = Number(ins.rows[0].id);

      for (const it of p.itens) {
        await q(
          `insert into order_items (order_id, produto, qtd_pedida, qtd_entregue, obs)
           values ($1, $2, $3, $4, $5)`,
          [orderId, it.produto, it.qtd_pedida, it.qtd_entregue || 0, it.obs || null]
        );
      }

      await q(
        `insert into order_events(order_id, event_type, payload)
         values ($1, 'IMPORT', $2::jsonb)`,
        [
          orderId,
          JSON.stringify({
            pedido_num: p.pedido_num,
            itens: p.itens.length,
            cliente_nome,
            telefone,
            observacao,
            origem: "GESTOR_RELATORIO_20",
          }),
        ]
      );

      await q("commit");
      imported += 1;
    } catch (err) {
      await q("rollback");
      throw err;
    }
  }

  return { imported, skipped };
}

function cryptoRandomToken(): string {
  return crypto.randomBytes(12).toString("hex");
}

export async function POST(req: Request) {
  const sess = await requireAuth();
  if (!sess.ok) return bad("Nao autenticado", 401);
  if (sess.role !== "master") return bad("Sem permissao", 403);

  const body = (await req.json().catch(() => null)) as any;
  const dateStr = String(body?.date || "").trim() || todayPtBR();
  const dryRun = Boolean(body?.dry_run);
  const limit = Math.max(0, Number(body?.limit || 0));

  try {
    const login = await loginGestor(false);
    if (!login.ok) return bad(login.message, 401, { finalUrl: login.finalUrl });

    const buffer = await fetchRelatorio20Xlsx(dateStr);
    const pedidos = parseRelatorio20Xlsx(buffer);
    if (pedidos.length === 0) return bad("Relatorio vazio ou layout desconhecido", 422);

    const list = limit > 0 ? pedidos.slice(0, limit) : pedidos;

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dry_run: true,
        total: pedidos.length,
        preview: list.slice(0, 5),
      });
    }

    const { imported, skipped } = await importPedidos(list);
    return NextResponse.json({
      ok: true,
      total: pedidos.length,
      imported,
      skipped,
      date: dateStr,
    });
  } catch (err: any) {
    return bad(err?.message || "Erro ao sincronizar pedidos", 500);
  }
}

export async function GET(req: Request) {
  if (!authOk(req)) {
    const authHeader = req.headers.get("authorization");
    const cronHeader = req.headers.get("x-cron-secret");
    console.warn("cron auth failed", {
      hasAuthHeader: Boolean(authHeader),
      hasCronHeader: Boolean(cronHeader),
      hasEnvSecret: Boolean(String(process.env.CRON_SECRET || "").trim()),
    });
    return bad("Nao autorizado", 401);
  }

  try {
    const dateStr = todayPtBR();
    const login = await loginGestor(false);
    if (!login.ok) return bad(login.message, 401, { finalUrl: login.finalUrl });

    const buffer = await fetchRelatorio20Xlsx(dateStr);
    const pedidos = parseRelatorio20Xlsx(buffer);
    if (pedidos.length === 0) return bad("Relatorio vazio ou layout desconhecido", 422);

    const { imported, skipped } = await importPedidos(pedidos);
    return NextResponse.json({
      ok: true,
      total: pedidos.length,
      imported,
      skipped,
      date: dateStr,
    });
  } catch (err: any) {
    return bad(err?.message || "Erro ao sincronizar pedidos", 500);
  }
}
