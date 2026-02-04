import { NextResponse } from "next/server";
import crypto from "crypto";
import { q } from "@/lib/db";
import { ajustarClienteVendaAoConsumidor } from "@/lib/obs_parse";

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

function genToken() {
  return crypto.randomBytes(12).toString("hex"); // 24 chars
}

type ImportItem = {
  produto: string;
  qtd_pedida: number;
  qtd_entregue?: number; // opcional
  obs?: string; // opcional
};

function pickItemObs(it: any): string | null {
  const v =
    it?.obs ??
    it?.Obs ??
    it?.OBS ??
    it?.observacao ??
    it?.Observacao ??
    it?.observação ??
    it?.Observação ??
    "";
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function pickItemQtdEntregue(it: any): number {
  const v =
    it?.qtd_entregue ??
    it?.QtdEntregue ??
    it?.qtdEntregue ??
    it?.entregue ??
    it?.Entregue ??
    0;
  const n = Number(v || 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as any;
  if (!body) return bad("JSON inválido");

  // segurança
// PIN DESATIVADO   const pin = String(body.pin ?? "");
  const importToken = String(body.import_token ?? "");

// PIN DESATIVADO   if (pin !== String(process.env.OPS_PIN ?? "")) return bad("PIN inválido", 401);
  if (importToken !== String(process.env.OPS_IMPORT_TOKEN ?? "")) return bad("Import token inválido", 401);

  // campos base
  const pedido_num = Number(body.pedido_num);
  if (!Number.isFinite(pedido_num) || pedido_num <= 0) return bad("pedido_num inválido");

  const rawClienteNome = String(body.cliente_nome ?? "").trim();
  const vendedor = String(body.vendedor ?? body.Vendedor ?? "").trim() || null;
  const rawTelefone = String(body.telefone ?? "").trim() || null;

  const observacao = String(body.observacao ?? body.Observacao ?? "").trim() || null;

  // se for “Venda Ao Consumidor”, tenta melhorar com a Observacao
  const ajustado = ajustarClienteVendaAoConsumidor(rawClienteNome, rawTelefone || "", observacao || undefined);
  const cliente_nome = (ajustado?.cliente_nome || rawClienteNome || "Venda Ao Consumidor").trim() || "Venda Ao Consumidor";
  const telefone = (ajustado?.telefone || rawTelefone || null) ? String(ajustado?.telefone || rawTelefone).trim() : null;

  // status
  let status = String(body.status ?? "RECEBIDO").trim() || "RECEBIDO";
  const agendado_para = body.agendado_para ? String(body.agendado_para).trim() : null;

  const itens: ImportItem[] = Array.isArray(body.itens) ? body.itens : [];
  if (itens.length === 0) return bad("itens vazio");

  // valida itens
  let temAlgoEntregue = false;

  for (const it of itens) {
    const prod = String(it?.produto ?? "").trim();
    const qtdPed = Number(it?.qtd_pedida);
    if (!prod) return bad("item.produto inválido");
    if (!Number.isFinite(qtdPed) || qtdPed <= 0) return bad(`qtd_pedida inválida em: ${prod}`);

    const qtdEnt = pickItemQtdEntregue(it);
    if (qtdEnt > 0) temAlgoEntregue = true;
    if (qtdEnt > qtdPed) return bad(`qtd_entregue maior que qtd_pedida em: ${prod}`);
  }

  // se quiser: auto-status quando já veio com entregue
  const entregaParcialFlag = Boolean(body.entrega_parcial ?? body.entregaParcial ?? false);
  if ((temAlgoEntregue || entregaParcialFlag) && status === "RECEBIDO") {
    status = "ENTREGA_PARCIAL";
  }

  // token do cliente
  const token = String(body.token ?? "").trim() || genToken();

  // evita duplicar pedido_num (se quiser permitir reimport/atualização, me fala)
  const dup = await q<any>(`select id, token from orders where pedido_num=$1 limit 1`, [pedido_num]);
  if ((dup.rowCount ?? 0) > 0) {

    return NextResponse.json({
      ok: true,
      reused: true,
      order_id: dup.rows[0].id,
      token: dup.rows[0].token,
      link: `/p/${dup.rows[0].token}`,
    });
  }

  // cria pedido + itens (transação)
  await q(`begin`);
  try {
    const ins = await q<any>(
      `insert into orders (pedido_num, token, cliente_nome, vendedor, telefone, status, agendado_para, observacao)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning id`,
      [pedido_num, token, cliente_nome, vendedor, telefone, status, agendado_para, observacao]
    );

    const orderId = Number(ins.rows[0].id);

    for (const it of itens) {
      const prod = String(it.produto).trim();
      const qtdPed = Number(it.qtd_pedida);
      const qtdEnt = pickItemQtdEntregue(it);
      const obsItem = pickItemObs(it);

      await q(
        `insert into order_items (order_id, produto, qtd_pedida, qtd_entregue, obs)
         values ($1,$2,$3,$4,$5)`,
        [orderId, prod, qtdPed, qtdEnt, obsItem]
      );
    }

    await q(
      `insert into order_events(order_id, event_type, payload)
       values ($1,'IMPORT', $2::jsonb)`,
      [
        orderId,
        JSON.stringify({
          pedido_num,
          itens: itens.length,
          cliente_nome,
          telefone,
          status,
          agendado_para,
          observacao,
          temAlgoEntregue,
        }),
      ]
    );

    await q(`commit`);

    return NextResponse.json({
      ok: true,
      order_id: orderId,
      token,
      link: `/p/${token}`,
    });
  } catch (e: any) {
    await q(`rollback`);
    return bad(e?.message || "Erro ao importar", 500);
  }
}
