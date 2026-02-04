import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/ops_guard";
import { canDelete } from "@/lib/ops_roles";
import { q } from "@/lib/db";

function bad(msg: string, status = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status });
}

type OrderRow = {
  id: number;
  pedido_num: number;
  token: string;
  cliente_nome: string;
  vendedor: string | null;
  telefone: string | null;
  status: string;
  para_entrega: boolean;
  caminhao: string | null;
  seq_entrega: number | null;
  agendado_para: string | null;
  created_at: string;
  updated_at: string | null;
};

type ItemRow = {
  id: number;
  order_id: number;
  produto: string;
  qtd_pedida: number;
  qtd_entregue: number; // ✅ com COALESCE no SQL, sempre vem número
  obs: string | null;
};

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sess = await requireAuth(); // ✅ sem args
  if (!sess.ok) return bad("Não autenticado", 401);

  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isFinite(idNum)) return bad("ID inválido", 400);

  // body é opcional (pin desativado hoje)
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // PIN DESATIVADO: se reativar depois:
  // if (String(body?.pin || "") !== String(process.env.OPS_PIN || "")) return bad("PIN inválido", 401);

  const ordRes = await q<OrderRow>(
    `select
       id, pedido_num, token, cliente_nome, vendedor, telefone, status,
       para_entrega, caminhao, seq_entrega, agendado_para,
       created_at, updated_at
     from orders
     where id=$1
     limit 1`,
    [idNum]
  );

  if (!ordRes.rowCount) return bad("Pedido não encontrado", 404);

  const itemsRes = await q<ItemRow>(
    `select
       id, order_id, produto,
       coalesce(qtd_pedida,0) as qtd_pedida,
       coalesce(qtd_entregue,0) as qtd_entregue,
       obs
     from order_items
     where order_id=$1
     order by id asc`,
    [idNum]
  );

  const order = ordRes.rows[0];

  const alertRes = await q<any>(
    `
    select
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
    where o.id = $1
    limit 1
    `,
    [idNum]
  );

  return NextResponse.json({
    ok: true,
    user: sess.user,
    role: sess.role,
    order: {
      id: order.id,
      pedido_num: order.pedido_num,
      token: order.token,
      cliente_nome: order.cliente_nome,
      vendedor: order.vendedor,
      status: order.status,
      alert_dup_item_30m: Boolean(alertRes.rows?.[0]?.alert_dup_item_30m),
      alert_diff_vendedor_30m: Boolean(alertRes.rows?.[0]?.alert_diff_vendedor_30m),
    },
    // ✅ aqui está o fix do erro (implicit any)
    items: itemsRes.rows.map((it: ItemRow) => ({
      id: it.id,
      produto: it.produto,
      qtd_pedida: Number(it.qtd_pedida || 0),
      qtd_entregue: Number(it.qtd_entregue || 0),
      obs: it.obs,
    })),
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sess = await requireAuth(); // ✅ sem args
  if (!sess.ok) return bad("Não autenticado", 401);

  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isFinite(idNum)) return bad("ID inválido", 400);

  const body = await req.json().catch(() => null);
  if (!body) return bad("JSON inválido", 400);

  const { status, caminhao, seq_entrega } = body as {
    status?: string;
    caminhao?: string | null;
    seq_entrega?: number | null;
  };

  if (!status) return bad("status é obrigatório", 400);

  await q(
    `update orders
       set status=$1,
           caminhao=$2,
           seq_entrega=$3,
           updated_at=now()
     where id=$4`,
    [status, caminhao ?? null, seq_entrega ?? null, idNum]
  );

  await q(
    `insert into order_events(order_id, event_type, payload, created_at)
     values ($1, 'status_update', $2::jsonb, now())`,
    [idNum, JSON.stringify({ by: sess.user, status, caminhao, seq_entrega })]
  );

  return NextResponse.json({
    ok: true,
    id: idNum,
    by: sess.user,
    role: sess.role,
    patch: { status, caminhao, seq_entrega },
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sess = await requireAuth(); // ✅ sem args
  if (!sess.ok) return bad("Não autenticado", 401);

  if (!canDelete(sess.role)) {
    return bad("Sem permissão para apagar (somente master)", 403);
  }

  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isFinite(idNum)) return bad("ID inválido", 400);

  await q("delete from orders where id=$1", [idNum]);

  return NextResponse.json({ ok: true, deleted: idNum, by: sess.user });
}
