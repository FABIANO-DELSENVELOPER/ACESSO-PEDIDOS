// app/api/ops/pedidos/route.ts
import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { requireOps } from "@/lib/ops_guard";

function bad(msg: string, status = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status });
}

export async function POST(req: Request) {
  // ✅ auth via cookie (todos podem ver)
  const sess = await requireOps(req);
  if (!sess.ok) return bad("Não autenticado", 401);

  const body = (await req.json().catch(() => null)) as any;
  if (!body) return bad("JSON inválido");

  // PIN DESATIVADO
  // if (String(body.pin || "") !== String(process.env.OPS_PIN || "")) return bad("PIN inválido", 401);

  const status = body.status ? String(body.status) : null; // opcional
  const limit = Math.min(Number(body.limit || 50) || 50, 200);

  const whereSql = status ? "where status = $1" : "";
  const params: any[] = status ? [status] : [];

  // ✅ parametriza o LIMIT também (evita SQL injection e bugs)
  const sql = `
    select
      o.id, o.pedido_num, o.token, o.cliente_nome, o.vendedor, o.telefone, o.status,
      o.para_entrega, o.caminhao, o.seq_entrega, o.agendado_para, o.created_at,
      exists (
        select 1
        from orders o2
        join order_items i2 on i2.order_id = o2.id
        where o2.id <> o.id
          and o2.cliente_nome = o.cliente_nome
          and o2.created_at between o.created_at - interval '30 minutes' and o.created_at + interval '30 minutes'
          and exists (
            select 1
            from order_items i1
            where i1.order_id = o.id
              and i1.produto = i2.produto
              and i1.qtd_pedida = i2.qtd_pedida
          )
        limit 1
      ) as alert_dup_item_30m,
      exists (
        select 1
        from orders o2
        where o2.id <> o.id
          and o2.cliente_nome = o.cliente_nome
          and o2.vendedor is not null
          and o.vendedor is not null
          and o2.vendedor <> o.vendedor
          and o2.created_at between o.created_at - interval '30 minutes' and o.created_at + interval '30 minutes'
        limit 1
      ) as alert_diff_vendedor_30m
    from orders o
    ${whereSql}
    order by o.created_at desc
    limit $${params.length + 1}
  `;

  const res = await q<any>(sql, [...params, limit]);

  return NextResponse.json({
    ok: true,
    user: sess.user,
    role: sess.role,
    pedidos: res.rows,
  });
}
