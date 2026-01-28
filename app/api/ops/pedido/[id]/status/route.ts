import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { requireOps } from "@/lib/ops_guard";

function bad(msg: string, status = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    // auth
    const sess = await requireOps(req);
    if (!sess.ok) return bad("Não autenticado", 401);

    // id (params é Promise no seu projeto)
    const { id } = await ctx.params;
    const orderId = Number(id);
    if (!Number.isFinite(orderId)) return bad("ID inválido");

    // body
    let body: any = null;
    try {
      body = await req.json();
    } catch {
      return bad("JSON inválido (corpo vazio ou malformado)");
    }

    const status = String(body.status || "").trim();
    if (!status) return bad("Status obrigatório");

    // agendado_para (opcional)
    let ag: string | null = null;
    if (body.agendado_para != null && String(body.agendado_para).trim() !== "") {
      ag = String(body.agendado_para).trim();

      // "2025-12-29 14:00" -> "2025-12-29T14:00:00"
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(ag)) {
        ag = ag.replace(" ", "T") + ":00";
      }

      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(ag)) {
        return bad("agendado_para inválido. Use: 2025-12-29 14:00");
      }
    }

    // update
    await q(
      `update orders
         set status=$1,
             agendado_para=$2
       where id=$3`,
      [status, ag, orderId]
    );

    // log event
    await q(
      `insert into order_events(order_id, event_type, payload)
       values ($1,'STATUS_SET', $2::jsonb)`,
      [orderId, JSON.stringify({ status, agendado_para: ag, by: sess.user })]
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("STATUS_SET ERROR:", e);
    return bad("Erro interno no status", 500);
  }
}

