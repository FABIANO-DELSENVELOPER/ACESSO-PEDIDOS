"use client";

import { useState } from "react";

type Pedido = {
  id: number;
  pedido_num: number;
  token: string;
  cliente_nome: string;
  vendedor?: string | null;
  telefone?: string | null;
  status: string;
  agendado_para?: string | null;
  created_at?: string;
  alert_dup_item_30m?: boolean;
  alert_diff_vendedor_30m?: boolean;
};

export default function FilaPedidosPage() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [msg, setMsg] = useState<string>("");

  async function carregarPedidos() {
    setMsg("Carregando pedidos...");
    const r = await fetch("/api/ops/pedidos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: null, limit: 80 }),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg(j.error || "Erro");
    setPedidos(j.pedidos || []);
    setMsg(`OK: ${j.pedidos?.length || 0} pedidos`);
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 1100, margin: "0 auto" }}>
      <h1>Fila de Pedidos (Consulta)</h1>
      <p>
        Perfil <b>balcao</b>: apenas consulta.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={carregarPedidos} style={{ padding: "8px 14px" }}>
          Atualizar pedidos
        </button>
        <span style={{ opacity: 0.85 }}>{msg}</span>
      </div>

      <div style={{ marginTop: 16 }}>
        {pedidos.length === 0 ? (
          <div style={{ opacity: 0.8 }}>Nenhum pedido carregado.</div>
        ) : (
          pedidos.map((p) => (
            <div key={p.id} style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12, marginBottom: 10 }}>
              <div>
                <b>Pedido:</b> {p.pedido_num} &nbsp; | &nbsp; <b>Status:</b> {p.status}
                {p.agendado_para ? ` (Ag: ${p.agendado_para})` : ""}
              </div>
              <div>
                <b>Cliente:</b> {p.cliente_nome}
                {p.telefone ? ` | ${p.telefone}` : ""}
                {p.vendedor ? ` | Vendedor: ${p.vendedor}` : ""}
              </div>
              {(p.alert_dup_item_30m || p.alert_diff_vendedor_30m) && (
                <div
                  style={{
                    marginTop: 6,
                    padding: "6px 8px",
                    border: "1px solid #f59e0b",
                    borderRadius: 8,
                    background: "#fff7ed",
                    color: "#3b1f5a",
                  }}
                >
                  ⚠️
                  {p.alert_dup_item_30m ? " Possível duplicado (mesmo cliente/produto/qtd em 30 min)." : ""}
                  {p.alert_dup_item_30m && p.alert_diff_vendedor_30m ? " |" : ""}
                  {p.alert_diff_vendedor_30m ? " Mesmo cliente com vendedor diferente em 30 min." : ""}
                </div>
              )}
              <div style={{ marginTop: 6 }}>
                <b>Link cliente:</b>{" "}
                <a href={`/p/${p.token}`} target="_blank" rel="noreferrer">
                  /p/{p.token}
                </a>
              </div>
            </div>
          ))
        )}
      </div>

      <p style={{ marginTop: 16 }}>
        <a href="/dashboard">← Voltar</a>
      </p>
    </main>
  );
}
