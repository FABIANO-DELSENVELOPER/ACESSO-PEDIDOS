const { Client } = require("pg");

const sql = `
create table if not exists orders (
  id bigserial primary key,
  pedido_num integer unique not null,
  token text unique not null,
  cliente_nome text not null,
  vendedor text,
  telefone text,
  status text not null default 'RECEBIDO',
  agendado_para timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists order_items (
  id bigserial primary key,
  order_id bigint not null references orders(id) on delete cascade,
  produto text not null,
  qtd_pedida numeric not null default 0,
  qtd_entregue numeric not null default 0,
  obs text
);

create table if not exists order_events (
  id bigserial primary key,
  order_id bigint not null references orders(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists delivery_requests (
  id bigserial primary key,
  order_id bigint not null references orders(id) on delete cascade,
  requested_for timestamptz,
  message text,
  status text not null default 'PENDENTE',
  created_at timestamptz not null default now()
);

create table if not exists gestor_sessions (
  session_key text primary key,
  cookies_encrypted text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_status on orders(status);
create index if not exists idx_items_order on order_items(order_id);
create index if not exists idx_requests_order_status on delivery_requests(order_id, status);

alter table orders add column if not exists vendedor text;
`;

(async () => {
  try {
    const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL_UNPOOLED ou DATABASE_URL nao definida");
    }
    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });

    await client.connect();
    await client.query(sql);
    await client.end();

    console.log("✅ Tabelas criadas com sucesso");
  } catch (err) {
    console.error("❌ Erro ao criar tabelas:", err.message);
    process.exit(1);
  }
})();
