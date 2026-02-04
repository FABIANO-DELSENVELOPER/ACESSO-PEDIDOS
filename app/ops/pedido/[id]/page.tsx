"use client";

import { useEffect, useMemo, useState } from "react";

type Item = {
  id: number;
  produto: string;
  qtd_pedida: number;
  qtd_entregue: number;
  obs?: string | null;
};

type Order = {
  id: number;
  pedido_num: number;
  cliente_nome: string;
  vendedor?: string | null;
  status: string;
  token: string;
  alert_dup_item_30m?: boolean;
  alert_diff_vendedor_30m?: boolean;
};

type Resp =
  | { error: string }
  | {
      ok: true;
      order: Order;
      items: Item[];
    };

function fmtStatus(s?: string) {
  if (!s) return "";
  return String(s).replaceAll("_", " ");
}

type View =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "err"; msg: string }
  | { kind: "ok"; order: Order; items: Item[] };

export default function OpsEntregaParcialPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const [pin, setPin] = useState("");
  const [id, setId] = useState<string>("");
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // Next 16: params pode ser Promise
  useEffect(() => {
    let alive = true;
    (async () => {
      const p: any = params as any;
      const resolved = typeof p?.then === "function" ? await p : p;
      if (!alive) return;
      setId(String(resolved?.id || ""));
    })();
    return () => {
      alive = false;
    };
  }, [params]);

  async function carregar() {
    if (!id) return;
    setMsg("");
    setLoading(true);
    try {
      const r = await fetch(`/api/ops/pedido/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });

      const j = (await r.json().catch(() => null)) as Resp | null;

      if (!r.ok) {
        setData({ error: (j as any)?.error || `Erro (HTTP ${r.status})` });
      } else {
        setData(j || { error: "Resposta inválida" });
      }
    } catch {
      setData({ error: "Falha ao carregar" });
    } finally {
      setLoading(false);
    }
  }

  const view: View = useMemo(() => {
    if (loading) return { kind: "loading" };
    if (!data) return { kind: "idle" };
    if ("error" in data) return { kind: "err", msg: data.error };
    return {
      kind: "ok",
      order: data.order,
      items: Array.isArray(data.items) ? data.items : [],
    };
  }, [data, loading]);

  function updateItem(idx: number, patch: Partial<Item>) {
    if (view.kind !== "ok") return;
    const next = [...view.items];
    next[idx] = { ...next[idx], ...patch };
    setData({ ok: true, order: view.order, items: next });
  }

  async function salvar() {
    if (!id) return;
    if (view.kind !== "ok") return;

    setSaving(true);
    setMsg("");

    try {
      const payload = {
        pin,
        itens: view.items.map((it) => ({
          id: it.id,
          qtd_entregue: Number(it.qtd_entregue || 0),
          obs: String(it.obs ?? ""),
        })),
      };

      const r = await fetch(`/api/ops/pedido/${id}/parcial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await r.json().catch(() => null);

      if (!r.ok) {
        setMsg((j as any)?.error || `Erro ao salvar (HTTP ${r.status})`);
      } else {
        setMsg(`✅ Salvo! Status agora: ${fmtStatus((j as any)?.status)}`);
        await carregar(); // recarrega do banco (fonte da verdade)
      }
    } catch {
      setMsg("Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    // carrega ao abrir (quando já tiver ID)
    if (id) carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const canSave = view.kind === "ok" && !saving;
  const canReload = !!id && !loading;

  return (
    <div style={{ fontFamily: "system-ui", padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <h2 style={{ marginTop: 0 }}>Entrega parcial (OPS)</h2>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN (147258)"
          style={{ padding: 8, width: 180 }}
        />

        <button onClick={carregar} disabled={!canReload} style={{ padding: "8px 14px" }}>
          {loading ? "Carregando..." : "Recarregar"}
        </button>

        <button onClick={salvar} disabled={!canSave} style={{ padding: "8px 14px" }}>
          {saving ? "Salvando..." : "Salvar entrega parcial"}
        </button>

        <span style={{ opacity: 0.8 }}>{msg}</span>
      </div>

      <div style={{ marginTop: 14 }}>
        {view.kind === "idle" ? (
          <div style={{ opacity: 0.8 }}>
            {id ? "Carregando pedido..." : "Abrindo... (sem ID)"}
          </div>
        ) : view.kind === "loading" ? (
          <div style={{ opacity: 0.8 }}>Carregando...</div>
        ) : view.kind === "err" ? (
          <div style={{ padding: 12, border: "1px solid #f2c", borderRadius: 10 }}>❌ {view.msg}</div>
        ) : (
          <>
            <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 10 }}>
              <div style={{ fontSize: 16 }}>
                <b>Pedido:</b> {view.order.pedido_num} &nbsp; | &nbsp;
                <b>Status:</b> {fmtStatus(view.order.status)}
              </div>

              <div>
                <b>Cliente:</b> {view.order.cliente_nome}
                {view.order.vendedor ? ` | Vendedor: ${view.order.vendedor}` : ""}
              </div>
              {(view.order.alert_dup_item_30m || view.order.alert_diff_vendedor_30m) && (
                <div
                  style={{
                    marginTop: 8,
                    padding: "6px 8px",
                    border: "1px solid #f59e0b",
                    borderRadius: 8,
                    background: "#fff7ed",
                  }}
                >
                  ⚠️
                  {view.order.alert_dup_item_30m
                    ? " Possível duplicado (mesmo cliente/produto/qtd em 30 min)."
                    : ""}
                  {view.order.alert_dup_item_30m && view.order.alert_diff_vendedor_30m ? " |" : ""}
                  {view.order.alert_diff_vendedor_30m
                    ? " Mesmo cliente com vendedor diferente em 30 min."
                    : ""}
                </div>
              )}

              <div style={{ marginTop: 8 }}>
                <b>Link cliente:</b>{" "}
                <a href={`/p/${view.order.token}`} target="_blank" rel="noreferrer">
                  /p/{view.order.token}
                </a>
              </div>
            </div>

            <h3 style={{ marginTop: 16 }}>Itens</h3>

            <div style={{ display: "grid", gap: 10 }}>
              {view.items.map((it, idx) => (
                <div key={it.id} style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 16 }}>
                    <b>{it.produto}</b>
                  </div>

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
                    <div>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>Qtd pedida</div>
                      <div>{it.qtd_pedida}</div>
                    </div>

                    <div>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>Qtd entregue</div>
                      <input
                        type="number"
                        min={0}
                        value={Number(it.qtd_entregue ?? 0)}
                        onChange={(e) => updateItem(idx, { qtd_entregue: Number(e.target.value || 0) })}
                        style={{ padding: 6, width: 120 }}
                      />
                    </div>

                    <div style={{ flex: 1, minWidth: 260 }}>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>Obs (o que foi enviado)</div>
                      <input
                        value={it.obs ?? ""}
                        onChange={(e) => updateItem(idx, { obs: e.target.value })}
                        placeholder="Ex: faltou 10 sacos / mandamos marca X / etc."
                        style={{ padding: 6, width: "100%" }}
                      />
                    </div>
                  </div>
                </div>
              ))}

              {view.items.length === 0 ? (
                <div style={{ opacity: 0.8, padding: 10 }}>Nenhum item encontrado para este pedido.</div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
