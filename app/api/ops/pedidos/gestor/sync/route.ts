import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { requireAuth } from "@/lib/ops_guard";
import { ajustarClienteVendaAoConsumidor } from "@/lib/obs_parse";
import { fetchGestorWithSession, loginGestor } from "@/lib/gestor_session";
import { parseRelatorio20Xlsx, type RelatorioPedido } from "@/lib/gestor_relatorio";
import { read, utils } from "xlsx";

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

function parseTagAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w+)\s*=\s*["']([^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) {
    attrs[m[1].toLowerCase()] = m[2];
  }
  return attrs;
}

function parseFormValuesFromHtml(html: string, formId = "form1"): Record<string, string> {
  const out: Record<string, string> = {};
  const formRe = new RegExp(
    `<form[^>]*id=["']${formId}["'][^>]*>([\\s\\S]*?)<\\/form>`,
    "i"
  );
  const formMatch = html.match(formRe);
  const scope = formMatch ? formMatch[1] : html;

  const inputTags = scope.match(new RegExp("<input\\\\b[^>]*>", "gi")) || [];
  for (const tag of inputTags) {
    const attrs = parseTagAttrs(tag);
    const name = attrs.name;
    if (!name) continue;
    const type = (attrs.type || "text").toLowerCase();
    if ((type === "radio" || type === "checkbox") && !new RegExp("\\\\bchecked\\\\b", "i").test(tag)) {
      continue;
    }
    out[name] = attrs.value ?? "";
  }

  const selectRe = new RegExp(
    "<select\\\\b[^>]*name=[\"']([^\"']+)[\"'][^>]*>([\\\\s\\\\S]*?)<\\\\/select>",
    "gi"
  );
  let sm: RegExpExecArray | null;
  while ((sm = selectRe.exec(scope))) {
    const name = sm[1];
    const body = sm[2] || "";
    const options = [
      ...body.matchAll(
        new RegExp("<option\\\\b[^>]*>([\\\\s\\\\S]*?)<\\\\/option>", "gi")
      ),
    ];
    let selectedVal: string | null = null;
    if (options.length > 0) {
      for (const opt of options) {
        const tag = opt[0];
        const attrs = parseTagAttrs(tag);
        if (new RegExp("\\\\bselected\\\\b", "i").test(tag)) {
          selectedVal = attrs.value ?? opt[1]?.trim() ?? "";
          break;
        }
      }
      if (selectedVal === null) {
        const firstTag = options[0][0];
        const attrs = parseTagAttrs(firstTag);
        selectedVal = attrs.value ?? options[0][1]?.trim() ?? "";
      }
    }
    out[name] = selectedVal ?? "";
  }

  return out;
}

function xajaxEscape(data: string): string {
  if (typeof data !== "string") return String(data ?? "");
  const needCDATA = encodeURIComponent(data) !== data;
  if (!needCDATA) return data;
  const segments = data.split("<![CDATA[");
  const rebuilt: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const frags = segments[i].split("]]>");
    let segment = "";
    for (let j = 0; j < frags.length; j++) {
      if (j !== 0) segment += "]]]]><![CDATA[>";
      segment += frags[j];
    }
    if (i !== 0) rebuilt.push("<![]]><![CDATA[CDATA[");
    rebuilt.push(segment);
  }
  const merged = rebuilt.join("");
  return `<![CDATA[${merged}]]>`;
}

function xajaxObjectToXml(obj: Record<string, any>): string {
  const maxDepth = 20;
  const maxSize = 2000;
  const guard = { depth: 0, maxDepth, size: 0, maxSize };
  const toXml = (o: any): string => {
    const parts: string[] = [];
    parts.push("<xjxobj>");
    for (const key of Object.keys(o || {})) {
      guard.size += 1;
      if (guard.maxSize < guard.size) return parts.join("");
      const val = o[key];
      if (typeof val === "undefined") continue;
      if (key === "constructor") continue;
      if (typeof val === "function") continue;
      parts.push("<e><k>", xajaxEscape(String(key)), "</k><v>");
      if (val && typeof val === "object") {
        guard.depth += 1;
        if (guard.maxDepth > guard.depth) {
          parts.push(toXml(val));
        }
        guard.depth -= 1;
      } else {
        const v = xajaxEscape(String(val ?? ""));
        if (v === "undefined" || v === "null") {
          parts.push("*");
        } else {
          const t = typeof val;
          if (t === "string") parts.push("S");
          else if (t === "boolean") parts.push("B");
          else if (t === "number") parts.push("N");
          parts.push(v);
        }
      }
      parts.push("</v></e>");
    }
    parts.push("</xjxobj>");
    return parts.join("");
  };
  return toXml(obj);
}

async function fetchRelatorio20Xlsx(dateStr: string): Promise<{
  buffer: Buffer;
  contentType: string | null;
  relMeta: { hasForm1: boolean; hasXajax: boolean; looksLikeLogin: boolean };
  prepareMethod: string;
  prepareFields: Record<string, string>;
}> {
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

  let { res: relRes } = await fetchGestorWithSession(relatorioUrl, { method: "GET", headers: baseHeaders });
  let relHtml = await relRes.text();
  const relMeta = {
    hasForm1: /<form[^>]*id=['"]form1['"]/i.test(relHtml),
    hasXajax: /xajax_Relatorio|xajax\\.config/i.test(relHtml),
    looksLikeLogin: new RegExp("input_usuario|login-form|/app/login/", "i").test(relHtml),
  };
  if (relMeta.looksLikeLogin) {
    // sessão expirada/invalidada: força novo login e tenta de novo
    await loginGestor(true);
    const retry = await fetchGestorWithSession(relatorioUrl, { method: "GET", headers: baseHeaders });
    relRes = retry.res;
    relHtml = await relRes.text();
    relMeta.hasForm1 = /<form[^>]*id=['"]form1['"]/i.test(relHtml);
    relMeta.hasXajax = /xajax_Relatorio|xajax\\.config/i.test(relHtml);
    relMeta.looksLikeLogin = new RegExp("input_usuario|login-form|/app/login/", "i").test(relHtml);
  }

  if (Object.keys(prepareFields).length > 0) {
    if (prepareMethod === "XAJAX") {
      const defaults = parseFormValuesFromHtml(relHtml, "form1");
      const formValues = { ...defaults, ...prepareFields };
      const xml = xajaxObjectToXml(formValues);
      const params = new URLSearchParams();
      params.set("xjxfun", "Relatorio");
      params.set("xjxr", String(Date.now()));
      params.append("xjxargs[]", xml);
      await fetchGestorWithSession(prepareUrl, {
        method: "POST",
        headers: {
          ...baseHeaders,
          referer: relatorioUrl,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });
    } else {
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
  }

  const { res } = await fetchGestorWithSession(exportUrl, {
    method: "GET",
    headers: { ...baseHeaders, referer: relatorioUrl },
  });

  if (!res.ok) {
    throw new Error(`Falha ao baixar relatório (${res.status})`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return {
    buffer: buf,
    contentType: res.headers.get("content-type"),
    relMeta,
    prepareMethod,
    prepareFields,
  };
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
    const login = await loginGestor(true);
    if (!login.ok) return bad(login.message, 401, { finalUrl: login.finalUrl });

  const { buffer, contentType, relMeta, prepareMethod, prepareFields } = await fetchRelatorio20Xlsx(dateStr);
    const pedidos = parseRelatorio20Xlsx(buffer);
    if (pedidos.length === 0) {
      const sig = buffer.subarray(0, 4).toString("hex");
      const debugRows = (() => {
        try {
          const wb = read(buffer, { type: "buffer", cellDates: false });
          const name = wb.SheetNames[0];
          const sheet = name ? wb.Sheets[name] : null;
          if (!sheet) return [];
          const rows = utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
          return rows.slice(0, 6);
        } catch {
          return [];
        }
      })();
      return bad("Relatorio vazio ou layout desconhecido", 422, {
        contentType,
        bufferSize: buffer.length,
        sig,
        prepareMethod,
        prepareFields: Object.keys(prepareFields || {}),
        relMeta,
        debugRows,
      });
    }

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
    const url = new URL(req.url);
    const dateStr = String(url.searchParams.get("date") || "").trim() || todayPtBR();
    const login = await loginGestor(true);
    if (!login.ok) return bad(login.message, 401, { finalUrl: login.finalUrl });

    const { buffer, contentType, relMeta, prepareMethod, prepareFields } = await fetchRelatorio20Xlsx(dateStr);
    const pedidos = parseRelatorio20Xlsx(buffer);
    if (pedidos.length === 0) {
      const sig = buffer.subarray(0, 4).toString("hex");
      const debugRows = (() => {
        try {
          const wb = read(buffer, { type: "buffer", cellDates: false });
          const name = wb.SheetNames[0];
          const sheet = name ? wb.Sheets[name] : null;
          if (!sheet) return [];
          const rows = utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
          return rows.slice(0, 6);
        } catch {
          return [];
        }
      })();
      return bad("Relatorio vazio ou layout desconhecido", 422, {
        contentType,
        bufferSize: buffer.length,
        sig,
        prepareMethod,
        prepareFields: Object.keys(prepareFields || {}),
        relMeta,
        debugRows,
      });
    }

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
