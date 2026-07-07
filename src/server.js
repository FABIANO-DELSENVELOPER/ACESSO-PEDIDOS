require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const { query: pgQuery } = require("../lib/postgres");
const { supabaseAdmin } = require("../lib/supabaseAdmin");
const initSqlJs = require("sql.js");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const OTP_EXPIRATION_MINUTES = Number(process.env.OTP_EXPIRATION_MINUTES || 10);
const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const IS_VERCEL = Boolean(process.env.VERCEL);
const DB_PATH = process.env.DATABASE_PATH || (IS_VERCEL ? path.join("/tmp", "vl-cristal.sqlite") : path.join(ROOT, "data", "vl-cristal.sqlite"));
const UPLOAD_DIR = process.env.UPLOAD_DIR || (IS_VERCEL ? path.join("/tmp", "vl-cristal-uploads") : path.join(PUBLIC_DIR, "uploads"));

let db;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.mimetype)) {
      return cb(new Error("Formato de imagem nao suportado."));
    }
    cb(null, true);
  }
});

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });
}

function normalizePhone(value = "") {
  return String(value).replace(/\D/g, "");
}

function normalizeBoolean(value) {
  return value === true || value === "true" || value === "1" || value === 1 || value === "on" ? 1 : 0;
}

function auth(role) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Token ausente." });

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (role && decoded.role !== role) return res.status(403).json({ error: "Acesso negado." });
      req.user = decoded;
      next();
    } catch (_error) {
      res.status(401).json({ error: "Token invalido." });
    }
  };
}

function normalizeParams(params) {
  if (Array.isArray(params)) return params;
  if (params === undefined) return [];
  return Array.from(arguments);
}

function createDb(rawDb) {
  function persist() {
    fs.writeFileSync(DB_PATH, Buffer.from(rawDb.export()));
  }

  function query(sql, params, single) {
    const stmt = rawDb.prepare(sql);
    stmt.bind(normalizeParams(params));
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return single ? rows[0] : rows;
  }

  return {
    exec(sql) {
      rawDb.exec(sql);
      persist();
    },
    get(sql) {
      return query(sql, normalizeParams.apply(null, Array.prototype.slice.call(arguments, 1)), true);
    },
    all(sql) {
      return query(sql, normalizeParams.apply(null, Array.prototype.slice.call(arguments, 1)), false);
    },
    run(sql) {
      const params = normalizeParams.apply(null, Array.prototype.slice.call(arguments, 1));
      const stmt = rawDb.prepare(sql);
      stmt.run(params);
      stmt.free();
      const result = query("SELECT last_insert_rowid() AS lastID", [], true);
      persist();
      return { lastID: result?.lastID || 0 };
    }
  };
}

async function initDb() {
  const SQL = await initSqlJs();
  const rawDb = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();
  db = createDb(rawDb);
  await db.exec("PRAGMA foreign_keys = ON");
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      whatsapp TEXT,
      address TEXT,
      city TEXT,
      cep TEXT,
      pool_type TEXT,
      pool_volume TEXT,
      notes TEXT,
      next_visit TEXT,
      monthly_value REAL NOT NULL DEFAULT 0,
      contracted_products_quantity REAL NOT NULL DEFAULT 0,
      portal_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS service_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_date TEXT NOT NULL,
      hora_servico TEXT NOT NULL,
      client_id INTEGER NOT NULL,
      employee TEXT NOT NULL,
      servico_realizado TEXT NOT NULL,
      produtos_utilizados TEXT,
      observacoes_tecnicas TEXT,
      water_quality TEXT,
      next_visit TEXT,
      revenue REAL NOT NULL DEFAULT 0,
      aspirou_fundo INTEGER NOT NULL DEFAULT 0,
      escovou_paredes INTEGER NOT NULL DEFAULT 0,
      limpeza_bordas INTEGER NOT NULL DEFAULT 0,
      retrolavagem INTEGER NOT NULL DEFAULT 0,
      aplicacao_cloro INTEGER NOT NULL DEFAULT 0,
      ajuste_ph INTEGER NOT NULL DEFAULT 0,
      aplicacao_algicida INTEGER NOT NULL DEFAULT 0,
      limpeza_pre_filtro INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('before', 'after')),
      file_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (order_id) REFERENCES service_orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS water_indicators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      client_id INTEGER NOT NULL,
      ph REAL,
      free_chlorine REAL,
      alkalinity REAL,
      temperature REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (order_id) REFERENCES service_orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      city TEXT,
      pool_type TEXT,
      message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      unit TEXT NOT NULL DEFAULT 'L',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS client_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      minimum_quantity REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      UNIQUE(client_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS service_order_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      client_id INTEGER NOT NULL,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      unit TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (order_id) REFERENCES service_orders(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      product_id INTEGER,
      order_id INTEGER,
      movement_type TEXT NOT NULL CHECK(movement_type IN ('entrada', 'uso', 'ajuste')),
      quantity REAL NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
      FOREIGN KEY (order_id) REFERENCES service_orders(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS client_otp_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      phone TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS report_delivery_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      client_id INTEGER NOT NULL,
      channel TEXT NOT NULL DEFAULT 'whatsapp',
      recipient TEXT NOT NULL,
      report_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payload TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sent_at TEXT,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (order_id) REFERENCES service_orders(id) ON DELETE CASCADE
    );
  `)

  await ensureColumn("clients", "contracted_products_quantity", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("clients", "portal_enabled", "INTEGER NOT NULL DEFAULT 0");

  const admin = await db.get("SELECT id FROM users WHERE username = ?", "admin");
  if (!admin) {
    const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD || "admin123", 12);
    await db.run("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)", "admin", passwordHash, "admin");
  }
}

async function ensureColumn(table, column, definition) {
  const columns = await db.all(`PRAGMA table_info(${table})`);
  if (!columns.some((item) => item.name === column)) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function parseChecklist(body) {
  const keys = [
    "aspirou_fundo",
    "escovou_paredes",
    "limpeza_bordas",
    "retrolavagem",
    "aplicacao_cloro",
    "ajuste_ph",
    "aplicacao_algicida",
    "limpeza_pre_filtro"
  ];
  return Object.fromEntries(keys.map((key) => [key, body[key] ? 1 : 0]));
}

const checklistLabels = {
  aspirou_fundo: "Aspirou fundo",
  escovou_paredes: "Escovou paredes",
  limpeza_bordas: "Limpeza de bordas",
  retrolavagem: "Retrolavagem",
  aplicacao_cloro: "Aplicacao de cloro",
  ajuste_ph: "Ajuste de pH",
  aplicacao_algicida: "Aplicacao de algicida",
  limpeza_pre_filtro: "Limpeza do pre-filtro"
};

function orderSelect() {
  return `
    SELECT so.*, c.name AS client_name, c.phone AS client_phone, c.whatsapp AS client_whatsapp
    FROM service_orders so
    JOIN clients c ON c.id = so.client_id
  `;
}

async function getOrderDetails(id) {
  const order = await db.get(`${orderSelect()} WHERE so.id = ?`, id);
  if (!order) return null;
  order.photos = await db.all("SELECT * FROM photos WHERE order_id = ? ORDER BY created_at DESC", id);
  order.water = await db.get("SELECT * FROM water_indicators WHERE order_id = ? ORDER BY created_at DESC LIMIT 1", id);
  order.products = await db.all("SELECT * FROM service_order_products WHERE order_id = ? ORDER BY product_name", id);
  return order;
}

function phonesMatch(client, login) {
  const phone = normalizePhone(client.phone);
  const whatsapp = normalizePhone(client.whatsapp);
  return phone === login || whatsapp === login || `55${phone}` === login || `55${whatsapp}` === login;
}

async function findClientByPhone(login) {
  const normalized = normalizePhone(login);
  const allClients = await db.all("SELECT * FROM clients");
  return allClients.find((item) => phonesMatch(item, normalized));
}

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendSmsOtp(phone, code) {
  console.info(`[SMS OTP pendente de integracao] telefone=${phone} codigo=${code}`);
  return { provider: "pending", phone };
}

async function enqueueWhatsAppReport(order) {
  const phone = normalizePhone(order.client_whatsapp || order.client_phone);
  if (!phone) return null;
  const reportUrl = `${PUBLIC_BASE_URL}/api/reports/pdf?order_id=${order.id}`;
  const message = `Ola ${order.client_name}.\n\nA visita tecnica da sua piscina foi concluida. Relatorio tecnico:\n${reportUrl}\n\nVL Cristal Piscinas & Cia`;
  const result = await db.run(
    "INSERT INTO report_delivery_queue (order_id, client_id, recipient, report_url, payload) VALUES (?, ?, ?, ?, ?)",
    order.id,
    order.client_id,
    phone,
    reportUrl,
    JSON.stringify({ message, whatsappUrl: `https://wa.me/55${phone}?text=${encodeURIComponent(message)}` })
  );
  console.info(`[WhatsApp pendente de integracao] fila=${result.lastID} telefone=${phone} relatorio=${reportUrl}`);
  return result.lastID;
}

function parseProductsUsed(body) {
  if (Array.isArray(body.products)) {
    return body.products.map((item) => ({
      product_id: item.product_id || item.produto_id || null,
      product_name: item.product_name || item.produto || item.name || "",
      quantity: Number(item.quantity || item.quantidade || 0),
      unit: item.unit || item.unidade || ""
    })).filter((item) => item.product_name && item.quantity > 0);
  }

  return String(body.produtos_utilizados || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^([\d.,]+)\s*x?\s+(.+)$/i);
      return {
        product_id: null,
        product_name: match ? match[2].trim() : item,
        quantity: match ? Number(match[1].replace(",", ".")) : 1,
        unit: ""
      };
    });
}

async function consumeClientStock(clientId, orderId, products) {
  for (const item of products) {
    if (!item.product_id) {
      await db.run(
        "INSERT INTO service_order_products (order_id, client_id, product_id, product_name, quantity, unit) VALUES (?, ?, ?, ?, ?, ?)",
        orderId,
        clientId,
        null,
        item.product_name,
        item.quantity,
        item.unit || ""
      );
      continue;
    }

    const stock = await db.get(
      "SELECT cs.*, p.name, p.unit FROM client_stock cs JOIN products p ON p.id = cs.product_id WHERE cs.client_id = ? AND cs.product_id = ?",
      clientId,
      item.product_id
    );

    if (!stock || Number(stock.quantity || 0) < item.quantity) {
      throw new Error(`Estoque insuficiente para ${item.product_name || stock?.name || "produto"}.`);
    }

    await db.run(
      "UPDATE client_stock SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE client_id = ? AND product_id = ?",
      item.quantity,
      clientId,
      item.product_id
    );
    await db.run(
      "INSERT INTO service_order_products (order_id, client_id, product_id, product_name, quantity, unit) VALUES (?, ?, ?, ?, ?, ?)",
      orderId,
      clientId,
      item.product_id,
      item.product_name || stock.name,
      item.quantity,
      item.unit || stock.unit || ""
    );
    await db.run(
      "INSERT INTO stock_movements (client_id, product_id, order_id, movement_type, quantity, notes) VALUES (?, ?, ?, 'uso', ?, ?)",
      clientId,
      item.product_id,
      orderId,
      item.quantity,
      `Uso na ordem #${orderId}`
    );
  }
}

app.use(cors());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(PUBLIC_DIR));
app.use(async (_req, _res, next) => {
  await ready;
  next();
});

app.post("/api/auth/admin", async (req, res) => {
  const { username, password } = req.body;
  const user = await db.get("SELECT * FROM users WHERE username = ?", username);

  if (!user || !(await bcrypt.compare(password || "", user.password_hash))) {
    return res.status(401).json({ error: "Credenciais inválidas." });
  }

  res.json({ token: signToken({ sub: user.id, role: user.role || "admin", username: user.username }) });
});

app.post("/api/auth/client/request-otp", async (req, res) => {
  const login = normalizePhone(req.body.login || req.body.phone);
  const client = await findClientByPhone(login);

  if (!client) return res.status(401).json({ error: "Cliente nao encontrado." });
  if (!Number(client.portal_enabled || 0)) {
    return res.status(403).json({ error: "Portal nao habilitado para este cliente." });
  }

  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_EXPIRATION_MINUTES * 60 * 1000).toISOString();

  await db.run(
    "INSERT INTO client_otp_codes (client_id, phone, code_hash, expires_at) VALUES (?, ?, ?, ?)",
    client.id,
    login,
    codeHash,
    expiresAt
  );
  await sendSmsOtp(login, code);

  res.json({
    message: "Codigo SMS gerado. Integracao com provedor pendente.",
    expires_in_minutes: OTP_EXPIRATION_MINUTES,
    dev_code: process.env.NODE_ENV === "production" ? undefined : code
  });
});

app.post("/api/auth/client/verify-otp", async (req, res) => {
  const login = normalizePhone(req.body.login || req.body.phone);
  const code = String(req.body.code || "").trim();
  if (!login || !code) return res.status(400).json({ error: "Telefone e codigo sao obrigatorios." });

  const client = await findClientByPhone(login);
  if (!client) return res.status(401).json({ error: "Cliente nao encontrado." });
  if (!Number(client.portal_enabled || 0)) {
    return res.status(403).json({ error: "Portal nao habilitado para este cliente." });
  }

  const otp = await db.get(
    `SELECT * FROM client_otp_codes
     WHERE client_id = ? AND phone = ? AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    client.id,
    login
  );

  if (!otp || new Date(otp.expires_at).getTime() < Date.now()) {
    return res.status(401).json({ error: "Codigo expirado ou inexistente." });
  }

  if (Number(otp.attempts || 0) >= 5) {
    return res.status(429).json({ error: "Muitas tentativas. Solicite um novo codigo." });
  }

  const valid = await bcrypt.compare(code, otp.code_hash);
  if (!valid) {
    await db.run("UPDATE client_otp_codes SET attempts = attempts + 1 WHERE id = ?", otp.id);
    return res.status(401).json({ error: "Codigo invalido." });
  }

  await db.run("UPDATE client_otp_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?", otp.id);
  res.json({ token: signToken({ sub: client.id, role: "client", name: client.name }), client });
});

app.post("/api/auth/client", async (req, res) => {
  res.status(400).json({ error: "Use /api/auth/client/request-otp e depois /api/auth/client/verify-otp." });
});

app.post("/api/budgets", async (req, res) => {
  const { name, phone, city, pool_type, message } = req.body;
  if (!name || !phone) return res.status(400).json({ error: "Nome e telefone sao obrigatorios." });
  const result = await db.run(
    "INSERT INTO budgets (name, phone, city, pool_type, message) VALUES (?, ?, ?, ?, ?)",
    name,
    phone,
    city || "",
    pool_type || "",
    message || ""
  );
  res.status(201).json({ id: result.lastID });
});

app.get("/api/dashboard", auth("admin"), async (_req, res) => {
  const [clients, orders, nextVisits, lowStock] = await Promise.all([
    db.get("SELECT COUNT(*) AS total FROM clients"),
    db.get("SELECT COUNT(*) AS total FROM service_orders"),
    db.get("SELECT COUNT(*) AS total FROM clients WHERE next_visit IS NOT NULL AND date(next_visit) >= date('now')"),
    db.get("SELECT COUNT(*) AS total FROM client_stock WHERE quantity <= minimum_quantity")
  ]);
  res.json({
    totalClients: clients.total,
    poolsServed: clients.total,
    servicesDone: orders.total,
    nextVisits: nextVisits.total,
    lowStock: lowStock.total
  });
});

app.get("/api/clients", auth("admin"), async (_req, res) => {
  res.json(await db.all("SELECT * FROM clients ORDER BY name"));
});

app.post("/api/clients", auth("admin"), async (req, res) => {
  const { name, phone, whatsapp, address, city, cep, pool_type, pool_volume, notes, next_visit, monthly_value, contracted_products_quantity, portal_enabled } = req.body;
  if (!name || !phone) return res.status(400).json({ error: "Nome e telefone sao obrigatorios." });
  const result = await db.run(
    `INSERT INTO clients (name, phone, whatsapp, address, city, cep, pool_type, pool_volume, notes, next_visit, monthly_value, contracted_products_quantity, portal_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    name,
    phone,
    whatsapp || "",
    address || "",
    city || "",
    cep || "",
    pool_type || "",
    pool_volume || "",
    notes || "",
    next_visit || null,
    Number(monthly_value || 0),
    Number(contracted_products_quantity || 0),
    normalizeBoolean(portal_enabled)
  );
  res.status(201).json(await db.get("SELECT * FROM clients WHERE id = ?", result.lastID));
});

app.put("/api/clients/:id", auth("admin"), async (req, res) => {
  const { name, phone, whatsapp, address, city, cep, pool_type, pool_volume, notes, next_visit, monthly_value, contracted_products_quantity, portal_enabled } = req.body;
  await db.run(
    `UPDATE clients SET name = ?, phone = ?, whatsapp = ?, address = ?, city = ?, cep = ?, pool_type = ?,
     pool_volume = ?, notes = ?, next_visit = ?, monthly_value = ?, contracted_products_quantity = ?, portal_enabled = ? WHERE id = ?`,
    name,
    phone,
    whatsapp || "",
    address || "",
    city || "",
    cep || "",
    pool_type || "",
    pool_volume || "",
    notes || "",
    next_visit || null,
    Number(monthly_value || 0),
    Number(contracted_products_quantity || 0),
    normalizeBoolean(portal_enabled),
    req.params.id
  );
  res.json(await db.get("SELECT * FROM clients WHERE id = ?", req.params.id));
});

app.delete("/api/clients/:id", auth("admin"), async (req, res) => {
  await db.run("DELETE FROM clients WHERE id = ?", req.params.id);
  res.status(204).end();
});

// ===== PRODUCTS =====

app.get("/api/products", auth("admin"), async (_req, res) => {
  res.json(await db.all("SELECT * FROM products ORDER BY name"));
});

app.post("/api/products", auth("admin"), async (req, res) => {
  const { name, unit } = req.body;
  if (!name) return res.status(400).json({ error: "Nome do produto é obrigatório." });
  const result = await db.run(
    "INSERT INTO products (name, unit) VALUES (?, ?)",
    name,
    unit || "L"
  );
  res.status(201).json(await db.get("SELECT * FROM products WHERE id = ?", result.lastID));
});

// ===== CLIENT STOCK =====

app.get("/api/clients/:id/stock", auth("admin"), async (req, res) => {
  const stock = await db.all(`
    SELECT cs.*, p.name, p.unit FROM client_stock cs
    JOIN products p ON p.id = cs.product_id
    WHERE cs.client_id = ?
    ORDER BY p.name ASC
  `, req.params.id);
  res.json(stock);
});

app.post("/api/clients/:id/stock", auth("admin"), async (req, res) => {
  const { product_id, quantity, minimum_quantity } = req.body;
  if (!product_id) return res.status(400).json({ error: "ID do produto é obrigatório." });
  
  const existing = await db.get(
    "SELECT id FROM client_stock WHERE client_id = ? AND product_id = ?",
    req.params.id,
    product_id
  );
  
  if (existing) {
    await db.run(
      "UPDATE client_stock SET quantity = ?, minimum_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE client_id = ? AND product_id = ?",
      Number(quantity || 0),
      Number(minimum_quantity || 0),
      req.params.id,
      product_id
    );
    await db.run(
      "INSERT INTO stock_movements (client_id, product_id, movement_type, quantity, notes) VALUES (?, ?, 'ajuste', ?, ?)",
      req.params.id,
      product_id,
      Number(quantity || 0),
      "Ajuste manual de estoque do cliente"
    );
  } else {
    await db.run(
      "INSERT INTO client_stock (client_id, product_id, quantity, minimum_quantity) VALUES (?, ?, ?, ?)",
      req.params.id,
      product_id,
      Number(quantity || 0),
      Number(minimum_quantity || 0)
    );
    await db.run(
      "INSERT INTO stock_movements (client_id, product_id, movement_type, quantity, notes) VALUES (?, ?, 'entrada', ?, ?)",
      req.params.id,
      product_id,
      Number(quantity || 0),
      "Estoque inicial do cliente"
    );
  }
  
  const updated = await db.get(
    `SELECT cs.*, p.name, p.unit FROM client_stock cs
     JOIN products p ON p.id = cs.product_id
     WHERE cs.client_id = ? AND cs.product_id = ?`,
    req.params.id,
    product_id
  );
  res.json(updated);
});

app.delete("/api/clients/:id/stock/:product_id", auth("admin"), async (req, res) => {
  await db.run(
    "DELETE FROM client_stock WHERE client_id = ? AND product_id = ?",
    req.params.id,
    req.params.product_id
  );
  res.status(204).end();
});


// ===== TESTE SUPABASE =====

app.get("/api/clients-pg", auth("admin"), async (_req, res) => {
  try {
    const result = await pgQuery(
      "SELECT * FROM clients ORDER BY name"
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message
    });
  }
});


app.get("/api/orders", auth("admin"), async (_req, res) => {
  res.json(await db.all(`${orderSelect()} ORDER BY so.service_date DESC, so.hora_servico DESC`));
});

app.post("/api/orders", auth("admin"), async (req, res) => {
  const checklist = parseChecklist(req.body);
  const products = parseProductsUsed(req.body);
  for (const item of products) {
    if (!item.product_id) continue;
    const stock = await db.get(
      "SELECT cs.quantity, p.name FROM client_stock cs JOIN products p ON p.id = cs.product_id WHERE cs.client_id = ? AND cs.product_id = ?",
      req.body.client_id,
      item.product_id
    );
    if (!stock || Number(stock.quantity || 0) < item.quantity) {
      return res.status(400).json({ error: `Estoque insuficiente para ${item.product_name || stock?.name || "produto"}.` });
    }
  }

  const result = await db.run(
    `INSERT INTO service_orders (
      service_date, hora_servico, client_id, employee, servico_realizado, produtos_utilizados, observacoes_tecnicas,
      water_quality, next_visit, revenue, aspirou_fundo, escovou_paredes, limpeza_bordas, retrolavagem,
      aplicacao_cloro, ajuste_ph, aplicacao_algicida, limpeza_pre_filtro
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    req.body.service_date,
    req.body.hora_servico,
    req.body.client_id,
    req.body.employee,
    req.body.servico_realizado,
    req.body.produtos_utilizados || "",
    req.body.observacoes_tecnicas || "",
    req.body.water_quality || "",
    req.body.next_visit || null,
    Number(req.body.revenue || 0),
    checklist.aspirou_fundo,
    checklist.escovou_paredes,
    checklist.limpeza_bordas,
    checklist.retrolavagem,
    checklist.aplicacao_cloro,
    checklist.ajuste_ph,
    checklist.aplicacao_algicida,
    checklist.limpeza_pre_filtro
  );

  if (req.body.next_visit) {
    await db.run("UPDATE clients SET next_visit = ? WHERE id = ?", req.body.next_visit, req.body.client_id);
  }

  await db.run(
    "INSERT INTO water_indicators (order_id, client_id, ph, free_chlorine, alkalinity, temperature) VALUES (?, ?, ?, ?, ?, ?)",
    result.lastID,
    req.body.client_id,
    Number(req.body.ph || 0),
    Number(req.body.free_chlorine || 0),
    Number(req.body.alkalinity || 0),
    Number(req.body.temperature || 0)
  );

  try {
    await consumeClientStock(req.body.client_id, result.lastID, products);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const order = await getOrderDetails(result.lastID);
  await enqueueWhatsAppReport(order);
  res.status(201).json(order);
});

app.post("/api/orders/:id/photos", auth("admin"), upload.fields([{ name: "before", maxCount: 1 }, { name: "after", maxCount: 1 }]), async (req, res) => {
  const order = await db.get("SELECT * FROM service_orders WHERE id = ?", req.params.id);
  if (!order) return res.status(404).json({ error: "Ordem nao encontrada." });

  for (const kind of ["before", "after"]) {
    const file = req.files?.[kind]?.[0];
    if (file) {
      await db.run(
        "INSERT INTO photos (client_id, order_id, kind, file_path) VALUES (?, ?, ?, ?)",
        order.client_id,
        order.id,
        kind,
        `/uploads/${file.filename}`
      );
    }
  }
  res.status(201).json(await getOrderDetails(req.params.id));
});

app.get("/api/orders/:id/whatsapp", auth("admin"), async (req, res) => {
  const order = await getOrderDetails(req.params.id);
  if (!order) return res.status(404).json({ error: "Ordem nao encontrada." });
  const reportLink = `${PUBLIC_BASE_URL}/api/reports/pdf?order_id=${order.id}`;
  const message = `Ola ${order.client_name}.\n\nA visita tecnica da sua piscina foi concluida.\n\nRelatorio tecnico:\n${reportLink}\n\nVL Cristal Piscinas & Cia\nQualidade que se ve na transparencia.`;
  const phone = normalizePhone(order.client_whatsapp || order.client_phone);
  res.json({ message, url: `https://wa.me/55${phone}?text=${encodeURIComponent(message)}` });
});

app.get("/api/client/me", auth("client"), async (req, res) => {
  const client = await db.get("SELECT * FROM clients WHERE id = ?", req.user.sub);
  if (!client || !Number(client.portal_enabled || 0)) {
    return res.status(403).json({ error: "Portal nao habilitado para este cliente." });
  }
  const orders = await db.all(`${orderSelect()} WHERE so.client_id = ? ORDER BY so.service_date DESC`, req.user.sub);
  const photos = await db.all("SELECT p.* FROM photos p JOIN service_orders so ON so.id = p.order_id WHERE so.client_id = ? ORDER BY p.created_at DESC", req.user.sub);
  const water = await db.all("SELECT * FROM water_indicators WHERE client_id = ? ORDER BY created_at ASC", req.user.sub);
  const stock = await db.all(`
    SELECT cs.*, p.name, p.unit FROM client_stock cs
    JOIN products p ON p.id = cs.product_id
    WHERE cs.client_id = ?
    ORDER BY p.name ASC
  `, req.user.sub);
  res.json({ client, orders, photos, water, stock });
});

app.get("/api/reports/pdf", async (req, res) => {
  const { period = "monthly", client_id, order_id } = req.query;
  const params = [];
  let where = "WHERE 1 = 1";

  if (order_id) {
    where += " AND so.id = ?";
    params.push(order_id);
  } else {
    if (period === "weekly") where += " AND date(so.service_date) >= date('now', '-7 day')";
    if (period === "monthly") where += " AND strftime('%Y-%m', so.service_date) = strftime('%Y-%m', 'now')";
    if (client_id) {
      where += " AND so.client_id = ?";
      params.push(client_id);
    }
  }

  let orders = await db.all(`${orderSelect()} ${where} ORDER BY so.service_date DESC, so.hora_servico DESC`, params);
  let source = "sqlite";

  if (!orders.length && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    let supabaseQuery = supabaseAdmin
      .from("ordens_servico")
      .select("*, clientes(nome, telefone, whatsapp)")
      .order("data_agendada", { ascending: false });

    if (order_id) supabaseQuery = supabaseQuery.eq("id", order_id);
    if (!order_id && client_id) supabaseQuery = supabaseQuery.eq("cliente_id", client_id);
    if (!order_id && period === "weekly") {
      const from = new Date();
      from.setDate(from.getDate() - 7);
      supabaseQuery = supabaseQuery.gte("data_agendada", from.toISOString().slice(0, 10));
    }
    if (!order_id && period === "monthly") {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const start = `${year}-${month}-01`;
      const end = `${year}-${month}-${new Date(year, now.getMonth() + 1, 0).getDate()}`;
      supabaseQuery = supabaseQuery.gte("data_agendada", start).lte("data_agendada", end);
    }

    const { data: supabaseOrders, error } = await supabaseQuery;
    if (!error && supabaseOrders?.length) {
      source = "supabase";
      orders = supabaseOrders.map((order) => ({
        ...order,
        service_date: order.data_agendada,
        hora_servico: order.hora_servico || "",
        client_id: order.cliente_id,
        client_name: order.clientes?.nome || "-",
        client_phone: order.clientes?.telefone || "",
        client_whatsapp: order.clientes?.whatsapp || "",
        employee: order.tecnico_responsavel || "",
        water_quality: order.qualidade_agua || "",
        aspirou_fundo: order.aspirou_fundo ? 1 : 0,
        escovou_paredes: order.escovou_paredes ? 1 : 0,
        limpeza_bordas: order.limpeza_bordas ? 1 : 0,
        retrolavagem: order.retrolavagem ? 1 : 0,
        aplicacao_cloro: order.aplicacao_cloro ? 1 : 0,
        ajuste_ph: order.ajuste_ph ? 1 : 0,
        aplicacao_algicida: order.aplicacao_algicida ? 1 : 0,
        limpeza_pre_filtro: order.limpeza_pre_filtro ? 1 : 0
      }));
    }
  }
  const periodLabel = order_id ? "Visita especifica" : period === "weekly" ? "Ultimos 7 dias" : period === "monthly" ? "Mes atual" : "Todo o periodo";
  const clientName = client_id ? orders[0]?.client_name || "Cliente" : order_id ? orders[0]?.client_name || "Cliente" : "Todos os clientes";

  const doc = new PDFDocument({ margin: 44, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename=relatorio-tecnico-${order_id || period}.pdf`);
  doc.pipe(res);

  doc.rect(0, 0, doc.page.width, 92).fill("#0057B8");
  doc.fillColor("#ffffff").fontSize(20).text("VL Cristal Piscinas & Cia", 44, 28);
  doc.fontSize(10).text("Relatorio tecnico de visita", 44, 56);
  doc.moveDown(3);
  doc.fillColor("#1f2937").fontSize(11).text(`Cliente: ${clientName}`);
  doc.text(`Periodo: ${periodLabel}`);
  doc.text(`Visitas no relatorio: ${orders.length}`);
  doc.moveDown();

  if (!orders.length) {
    doc.fontSize(12).text("Nenhuma visita encontrada para os filtros selecionados.");
    doc.end();
    return;
  }

  for (const order of orders) {
    let details = source === "sqlite" ? await getOrderDetails(order.id) : {
      products: [],
      photos: [],
      water: {
        ph: order.ph,
        free_chlorine: order.cloro_livre,
        alkalinity: order.alcalinidade,
        temperature: order.temperatura
      }
    };

    if (source === "supabase") {
      const { data: products } = await supabaseAdmin
        .from("ordem_servico_produtos")
        .select("*")
        .eq("ordem_servico_id", order.id);
      details.products = (products || []).map((product) => ({
        product_name: product.produto_nome,
        quantity: product.quantidade,
        unit: product.unidade
      }));

      const { data: photos } = await supabaseAdmin
        .from("fotos")
        .select("*")
        .eq("ordem_servico_id", order.id);
      details.photos = (photos || []).map((photo) => ({
        ...photo,
        file_path: photo.file_path || photo.url || photo.caminho || "",
        kind: photo.kind || photo.tipo || "after"
      }));
    }
    if (doc.y > 650) doc.addPage();

    doc.roundedRect(44, doc.y, doc.page.width - 88, 24, 4).fill("#EAF4FF");
    doc.fillColor("#0057B8").fontSize(13).text(`Visita #${order.id} - ${order.service_date} ${order.hora_servico}`, 54, doc.y + 6);
    doc.moveDown(1.2);

    doc.fillColor("#1f2937").fontSize(10);
    doc.text(`Cliente: ${order.client_name}`);
    doc.text(`Tecnico responsavel: ${order.employee || "-"}`);
    doc.text(`Servico realizado: ${order.servico_realizado || "-"}`);
    doc.text(`Qualidade da agua: ${order.water_quality || "-"}`);
    doc.text(`Observacoes: ${order.observacoes_tecnicas || "-"}`);
    doc.moveDown(0.5);

    doc.fillColor("#0057B8").fontSize(11).text("Checklist realizado");
    doc.fillColor("#1f2937").fontSize(9);
    Object.entries(checklistLabels).forEach(([key, label]) => {
      doc.text(`${Number(order[key] || 0) ? "[OK]" : "[ ]"} ${label}`);
    });
    doc.moveDown(0.5);

    doc.fillColor("#0057B8").fontSize(11).text("Produtos utilizados");
    doc.fillColor("#1f2937").fontSize(9);
    if (details.products?.length) {
      details.products.forEach((product) => {
        doc.text(`${product.product_name}: ${product.quantity} ${product.unit || ""}`.trim());
      });
    } else {
      doc.text(order.produtos_utilizados || "-");
    }

    if (details.water) {
      doc.moveDown(0.5);
      doc.fillColor("#0057B8").fontSize(11).text("Indicadores da agua");
      doc.fillColor("#1f2937").fontSize(9).text(`pH: ${details.water.ph || "-"} | Cloro livre: ${details.water.free_chlorine || "-"} | Alcalinidade: ${details.water.alkalinity || "-"} | Temperatura: ${details.water.temperature || "-"}`);
    }

    if (details.photos?.length) {
      doc.moveDown(0.7);
      doc.fillColor("#0057B8").fontSize(11).text("Fotos da visita");
      const startX = 44;
      let x = startX;
      let y = doc.y + 6;
      for (const photo of details.photos) {
        if (/^https?:\/\//i.test(photo.file_path)) {
          doc.fillColor("#1f2937").fontSize(8).text(`${photo.kind === "before" ? "Antes" : "Depois"}: ${photo.file_path}`);
          continue;
        }
        const absolutePath = path.join(PUBLIC_DIR, photo.file_path.replace(/^\/+/, ""));
        if (!fs.existsSync(absolutePath)) continue;
        if (x + 170 > doc.page.width - 44) {
          x = startX;
          y += 140;
        }
        if (y > 660) {
          doc.addPage();
          y = 44;
          x = startX;
        }
        doc.image(absolutePath, x, y, { fit: [160, 110] });
        doc.fillColor("#1f2937").fontSize(8).text(photo.kind === "before" ? "Antes" : "Depois", x, y + 114, { width: 160, align: "center" });
        x += 178;
      }
      doc.y = y + 138;
    }

    doc.moveDown();
  }

  doc.end();
});



app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Rota nao encontrada." });
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || "Erro interno." });
});

const ready = initDb();

if (require.main === module) {
  ready.then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`VL Cristal Piscinas rodando em http://${HOST}:${PORT}`);
    });
  });
}

module.exports = app;
