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
  para_entrega?: boolean;
  caminhao?: string | null;
  seq_entrega?: number | null;
  agendado_para?: string | null;
  created_at?: string;
  alert_dup_item_30m?: boolean;
  alert_diff_vendedor_30m?: boolean;
};

type Solicitacao = {
  request_id: number;
  request_status: string;
  requested_for?: string | null;
  message?: string | null;
  created_at?: string;
  order_id: number;
  pedido_num: number;
  token: string;
  cliente_nome: string;
  telefone?: string | null;
  order_status: string;
};

export default function OpsPage() {
  const [status, setStatus] = useState("");
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [sols, setSols] = useState<Solicitacao[]>([]);
  const [msg, setMsg] = useState<string>("");
  const [role, setRole] = useState<string | null>(null);
  const [gestorMsg, setGestorMsg] = useState<string>("");
  const [syncMsg, setSyncMsg] = useState<string>("");

  async function safeJson(r: Response) {
    try {
      return await r.json();
    } catch {
      return { error: "Resposta inválida (não-JSON)" };
    }
  }

  async function carregarPedidos() {
    setMsg("Carregando pedidos...");
    const r = await fetch("/api/ops/pedidos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // ✅ sem PIN: middleware/login já garante
      body: JSON.stringify({ status: status || null, limit: 80 }),
    });

    const j = await safeJson(r);
    if (!r.ok) return setMsg(j.error || "Erro");
    setPedidos(j.pedidos || []);
    if (j.role) setRole(j.role);
    setMsg(`OK: ${j.pedidos?.length || 0} pedidos`);
  }

  async function carregarSolicitacoes() {
    const r = await fetch("/api/ops/solicitacoes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 80 })

    });

    const j = await safeJson(r);
    if (!r.ok) return setMsg(j.error || "Erro nas solicitações");
    setSols(j.solicitacoes || []);
  }

  async function carregarTudo() {
    await Promise.all([carregarSolicitacoes(), carregarPedidos()]);
  }

  async function setStatusPedido(id: number, novo: string) {
    const ag =
      novo === "AGENDADO" ? prompt("Agendar para (ex: 2025-12-29 14:00):") : null;
      body: JSON.stringify({ status: novo, agendado_para: ag || null })

    // se cancelou o prompt, não faz request
    if (novo === "AGENDADO" && ag === null) return;

    const r = await fetch(`/api/ops/pedido/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: novo, agendado_para: ag || null }),
    });

    const j = await safeJson(r);
    if (!r.ok) return alert(j.error || "Erro");
    await carregarTudo();
  }

  async function setParaEntrega(id: number, para_entrega: boolean) {
    const r = await fetch(`/api/ops/pedido/${id}/para_entrega`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ para_entrega }),
    });

    const j = await safeJson(r);
    if (!r.ok) return alert(j.error || "Erro ao atualizar entrega");
    await carregarTudo();
  }

  async function atenderSolicitacao(requestId: number) {
    const r = await fetch(`/api/ops/solicitacao/${requestId}/atender`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const j = await safeJson(r);
    if (!r.ok) return alert(j.error || "Erro");
    await carregarTudo();
  }

  async function copiar(txt: string) {
    try {
      await navigator.clipboard.writeText(txt);
      alert("Copiado!");
    } catch {
      prompt("Copie manualmente:", txt);
    }
  }

  function abrir(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function loginGestor(opts?: { force?: boolean; clear?: boolean }) {
    setGestorMsg(opts?.clear ? "Limpando sessao..." : "Fazendo login no gestor...");
    const r = await fetch("/api/ops/pedidos/gestor/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: !!opts?.force, clear: !!opts?.clear }),
    });
    const j = await safeJson(r);
    if (!r.ok) return setGestorMsg(j.error || "Erro no login");
    setGestorMsg(j.message || "OK");
  }

  async function syncGestorPedidos() {
    const dateStr = prompt("Data do relatório (dd/mm/aaaa). Deixe vazio para hoje:", "") ?? "";
    setSyncMsg("Sincronizando pedidos do Gestor...");
    const r = await fetch("/api/ops/pedidos/gestor/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: dateStr || null }),
    });
    const j = await safeJson(r);
    if (!r.ok) return setSyncMsg(j.error || "Erro na sincronizacao");
    setSyncMsg(`OK: ${j.imported ?? 0} importados, ${j.skipped ?? 0} ja existiam`);
    await carregarPedidos();
  }

  return (
    <div style={{ fontFamily: "system-ui", padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <h2>Painel Expedição (OPS)</h2>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: 8 }}>
          <option value="">(todos)</option>
          <option value="RECEBIDO">RECEBIDO</option>
          <option value="AGENDADO">AGENDADO</option>
          <option value="EM_SEPARACAO">EM_SEPARACAO</option>
          <option value="EM_ROTA">EM_ROTA</option>
          <option value="ENTREGA_PARCIAL">ENTREGA_PARCIAL</option>
          <option value="ENTREGUE">ENTREGUE</option>
        </select>

        <button onClick={carregarTudo} style={{ padding: "8px 14px" }}>
          Carregar tudo
        </button>
        <button onClick={carregarSolicitacoes} style={{ padding: "8px 14px" }}>
          Atualizar solicitações
        </button>
        <button onClick={carregarPedidos} style={{ padding: "8px 14px" }}>
          Atualizar pedidos
        </button>

        <a
          href="/ops/roteiro"
          style={{
            padding: "8px 14px",
            border: "1px solid #ccc",
            borderRadius: 8,
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          🚚 Quadro de Cargas
        </a>

        <span style={{ marginLeft: 6 }}>{msg}</span>
      </div>

      {role === "master" ? (
        <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 10 }}>
          <h3 style={{ marginTop: 0 }}>Gestor - Login (master)</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={() => loginGestor()}>Logar no Gestor</button>
            <button onClick={() => loginGestor({ force: true })}>Forcar novo login</button>
            <button onClick={() => loginGestor({ clear: true })}>Limpar sessao</button>
            <span style={{ opacity: 0.85 }}>{gestorMsg}</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <button onClick={syncGestorPedidos}>Sincronizar pedidos (Relatorio 20)</button>
            <span style={{ opacity: 0.85 }}>{syncMsg}</span>
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 10 }}>
        <h3 style={{ marginTop: 0 }}>Pedidos com entrega requisitada (saldo)</h3>

        {sols.length === 0 ? (
          <div style={{ opacity: 0.8 }}>Nenhuma solicitação pendente.</div>
        ) : (
          sols.map((s) => (
            <div key={s.request_id} style={{ borderTop: "1px solid #eee", paddingTop: 10, marginTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div>
                    <b>Pedido:</b> {s.pedido_num} &nbsp; | &nbsp; <b>Cliente:</b> {s.cliente_nome}
                    {s.telefone ? ` | ${s.telefone}` : ""}
                  </div>
                  <div>
                    <b>Status atual:</b> {s.order_status}
                  </div>
                  <div>
                    <b>Link cliente:</b>{" "}
                    <a href={`/p/${s.token}`} target="_blank" rel="noreferrer">
                      /p/{s.token}
                    </a>
                  </div>
                  {s.requested_for ? (
                    <div>
                      <b>Quando quer:</b> {s.requested_for}
                    </div>
                  ) : null}
                  {s.message ? (
                    <div>
                      <b>Msg:</b> {s.message}
                    </div>
                  ) : null}
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button onClick={() => setStatusPedido(s.order_id, "AGENDADO")}>AGENDAR</button>
                  <button onClick={() => setStatusPedido(s.order_id, "EM_ROTA")}>EM ROTA</button>
                  <button onClick={() => atenderSolicitacao(s.request_id)}>MARCAR ATENDIDO</button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        {pedidos.map((p) => (
          <div key={p.id} style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <b>Pedido:</b> {p.pedido_num} &nbsp; | &nbsp; <b>Status:</b> {p.status}
                {p.agendado_para ? ` (Ag: ${p.agendado_para})` : ""}
              <div>
                <b>Cliente:</b> {p.cliente_nome} {p.telefone ? ` | ${p.telefone}` : ""}
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
              <div>
                <b>Link cliente:</b>{" "}
                  <a href={`/p/${p.token}`} target="_blank" rel="noreferrer">
                    /p/{p.token}
                  </a>
                </div>
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  onClick={() => setParaEntrega(p.id, !p.para_entrega)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid #ccc",
                    background: p.para_entrega ? "#e6ffe6" : "white",
                    cursor: "pointer",
                  }}
                  title="Marca este pedido para entrar no quadro de cargas"
                >
                  {p.para_entrega ? "✅ Na entrega" : "➕ Adicionar à entrega"}
                </button>

                {p.para_entrega ? (
                  <span style={{ opacity: 0.85 }}>
                    {p.caminhao ? `🚚 ${p.caminhao}` : ""}
                    {p.seq_entrega != null ? ` #${p.seq_entrega}` : ""}
                  </span>
                ) : null}

                <button onClick={() => setStatusPedido(p.id, "AGENDADO")}>AGENDAR</button>
                <button onClick={() => setStatusPedido(p.id, "EM_SEPARACAO")}>SEPARAÇÃO</button>
                <button onClick={() => setStatusPedido(p.id, "EM_ROTA")}>EM ROTA</button>
                <button onClick={() => setStatusPedido(p.id, "ENTREGUE")}>ENTREGUE</button>

                <a
                  href={`/ops/pedido/${p.id}`}
                  style={{
                    padding: "6px 10px",
                    border: "1px solid #ccc",
                    borderRadius: 6,
                    textDecoration: "none",
                  }}
                >
                  ENTREGA PARCIAL
                </a>

                <button
                  onClick={() => copiar(`${location.origin}/p/${p.token}`)}
                  style={{ padding: "6px 10px" }}
                  title="Copia o link do cliente"
                >
                  Copiar link
                </button>

                <button
                  onClick={() => abrir(`/p/${p.token}`)}
                  style={{ padding: "6px 10px" }}
                  title="Abrir como cliente"
                >
                  Ver cliente
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
