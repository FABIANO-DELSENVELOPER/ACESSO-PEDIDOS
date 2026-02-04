import { read, utils } from "xlsx";

type ImportItem = {
  produto: string;
  qtd_pedida: number;
  qtd_entregue?: number;
  obs?: string | null;
};

export type RelatorioPedido = {
  pedido_num: number;
  cliente_nome: string;
  vendedor?: string | null;
  observacao?: string | null;
  itens: ImportItem[];
};

const HEADER_TOKENS = ["pedido", "cliente", "data pedido", "vendedor", "produto", "qtd", "vl uni"];
const MIN_MATCH = 3;

function norm(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function scoreHeaderRow(row: unknown[]): number {
  const cells = row.map((v) => norm(v));
  let hits = 0;
  for (const tok of HEADER_TOKENS) {
    if (cells.some((c) => c === tok || c.includes(tok))) hits += 1;
  }
  return hits;
}

function locateHeaderRow(rows: unknown[][]): number | null {
  const limit = Math.min(rows.length, 200);
  let bestIdx = -1;
  let bestScore = -1;
  for (let i = 0; i < limit; i += 1) {
    const sc = scoreHeaderRow(rows[i] || []);
    if (sc > bestScore) {
      bestScore = sc;
      bestIdx = i;
    }
    if (sc >= MIN_MATCH) return i;
  }
  return bestIdx >= 0 ? bestIdx : null;
}

function normalizeHeaderName(raw: unknown): string {
  const v = norm(raw);
  const alias: Record<string, string> = {
    "vl uni": "Vl Uni",
    "vl. uni": "Vl Uni",
    "vl_unit": "Vl Uni",
    "quantidade": "Qtd",
    "qtd.": "Qtd",
    "data_pedido": "Data Pedido",
    "data entrega": "Data Entrega",
    "observacao": "Observacao",
    "observacao pedido": "Observacao",
    "obs": "Observacao",
    "ped orc": "Ped Orc",
    "ped. orc": "Ped Orc",
  };

  if (!v) return "";
  if (alias[v]) return alias[v];

  const mapping: Record<string, string> = {
    pedido: "Pedido",
    "ped orc": "Ped Orc",
    cliente: "Cliente",
    "data pedido": "Data Pedido",
    "data entrega": "Data Entrega",
    vendedor: "Vendedor",
    produto: "Produto",
    qtd: "Qtd",
    "vl uni": "Vl Uni",
    observacao: "Observacao",
  };

  return mapping[v] || String(raw).trim();
}

function coercePtNumber(value: unknown): number {
  const s = String(value ?? "").trim();
  if (!s) return 0;
  const normalized = s.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function parseRows(rows: unknown[][]): RelatorioPedido[] {
  const headerIdx = locateHeaderRow(rows);
  if (headerIdx == null) return [];

  const headers = (rows[headerIdx] || []).map(normalizeHeaderName);
  const pedidos = new Map<number, RelatorioPedido>();

  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < headers.length; c += 1) {
      const key = headers[c];
      if (!key) continue;
      obj[key] = row[c];
    }

    const pedidoRaw = String(obj["Pedido"] ?? "").trim();
    if (!/^\d+$/.test(pedidoRaw)) continue;
    const pedidoNum = Number(pedidoRaw);
    if (!Number.isFinite(pedidoNum) || pedidoNum <= 0) continue;

    const produto = String(obj["Produto"] ?? "").trim();
    if (!produto) continue;

    const qtd = coercePtNumber(obj["Qtd"]);
    const cliente = String(obj["Cliente"] ?? "").trim() || "Cliente";
    const vendedor = String(obj["Vendedor"] ?? "").trim();
    const obs = String(obj["Observacao"] ?? "").trim();

    const existing = pedidos.get(pedidoNum) || {
      pedido_num: pedidoNum,
      cliente_nome: cliente,
      vendedor: vendedor || null,
      observacao: obs || null,
      itens: [],
    };

    if (!existing.cliente_nome && cliente) existing.cliente_nome = cliente;
    if (!existing.vendedor && vendedor) existing.vendedor = vendedor;
    if (!existing.observacao && obs) existing.observacao = obs;

    existing.itens.push({
      produto,
      qtd_pedida: qtd > 0 ? qtd : 1,
      obs: obs || null,
    });

    pedidos.set(pedidoNum, existing);
  }

  return Array.from(pedidos.values());
}

export function parseRelatorio20Xlsx(buffer: Buffer): RelatorioPedido[] {
  const wb = read(buffer, { type: "buffer", cellDates: false });

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const rows = utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
    const parsed = parseRows(rows);
    if (parsed.length > 0) return parsed;
  }

  return [];
}
