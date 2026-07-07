let clients = [];
let orders = [];
let produtosUtilizados = [];
let produtosDisponiveisCliente = [];

const db = window.db;
const loginScreen = document.querySelector("#loginScreen");
const adminApp = document.querySelector("#adminApp");

/* =========================
   SUPABASE
========================= */


/* =========================
   UTIL
========================= */
function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function formDataJson(form) {
  const data = Object.fromEntries(new FormData(form));

  form.querySelectorAll("input[type=checkbox]").forEach((box) => {
    data[box.name] = box.checked;
  });

  return data;
}

function productName(product) {
  return product?.nome || product?.produto || product?.name || "-";
}

function productUnit(product) {
  return product?.unidade || product?.unit || "";
}

/* =========================
   LOGIN (SUPABASE AUTH)
========================= */
document.querySelector("#adminLogin").addEventListener("submit", async (event) => {
  event.preventDefault();

  const form = Object.fromEntries(new FormData(event.currentTarget));

  const email = form.username; // por enquanto o campo da tela continuará sendo "username"
  const password = form.password;

  const { data, error } = await db.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    document.querySelector("#loginStatus").textContent =
      "E-mail ou senha inválidos";
    return;
  }

  // Verifica se o usuário é administrador
  const { data: profile, error: profileError } = await db
    .from("admin_profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();

  if (profileError || !profile) {
    await db.auth.signOut();
    document.querySelector("#loginStatus").textContent =
      "Usuário não possui permissão de administrador.";
    return;
  }

  requireAdmin();
});
/* =========================
   AUTH CHECK
========================= */
async function requireAdmin() {

  const { data: { session } } = await db.auth.getSession();

  if (!session) {
    loginScreen.style.display = "flex";
    adminApp.style.display = "none";
    return;
  }

  loginScreen.style.display = "none";
  adminApp.style.display = "grid";

  loadAdmin();
}
/* =========================
   LOAD MASTER
========================= */
  async function loadAdmin() {

  try {

    await loadDashboard();
    console.log("Dashboard OK");

    await loadClients();
    console.log("Clientes OK");

    await loadOrders();
    console.log("Ordens OK");

    await loadStock();
    console.log("Estoque OK");

    await loadTopProducts();
    console.log("Top produtos OK");

    await loadTopServices();
    console.log("Top serviços OK");

    await loadProdutosSelect();
    console.log("Produtos OK");

    await loadStockAdjustmentOptions();
    console.log("Ajuste de estoque OK");

  } catch (error) {

    console.error("ERRO LOADADMIN:", error);

  }

  initMenu();
}

/* =========================
   MENU LATERAL (NOVO AJUSTE)
========================= */
function initMenu() {

  document.querySelectorAll("[data-view-button]").forEach((button) => {

    button.onclick = () => {

      document
        .querySelectorAll("[data-view-button]")
        .forEach((b) => b.classList.remove("active"));

      document
        .querySelectorAll(".view")
        .forEach((view) => view.classList.remove("active"));

      button.classList.add("active");

      const target =
        document.getElementById(
          button.dataset.viewButton
        );

      if (target) {
        target.classList.add("active");
      }

    };

  });

}

/* =========================
   DASHBOARD
========================= */
async function loadDashboard() {
  try {
    const [clientsCount, ordersCount, lowStockResult] = await Promise.all([
      db.from("clientes").select("id", { count: "exact", head: true }),
      db.from("ordens_servico").select("id", { count: "exact", head: true }),
      db.from("cliente_estoque").select("id", { count: "exact", head: true }).lte("quantidade", 0)
    ]);

    const totalClients = Number(clientsCount.count || 0);
    const servicesDone = Number(ordersCount.count || 0);
    const lowStock = Number(lowStockResult.count || 0);

    document.querySelector("#stats").innerHTML = `
      <div class="stat"><span>Clientes</span><strong>${totalClients}</strong></div>
      <div class="stat"><span>Ordens</span><strong>${servicesDone}</strong></div>
      <div class="stat"><span>Estoques zerados</span><strong>${lowStock}</strong></div>
    `;
  } catch (error) {
    console.error("Erro ao carregar dashboard:", error);
  }
}

async function loadTopProducts() {
  try {
    const { data, error } = await db
      .from("ordens_servico")
      .select("produtos_utilizados")
      .order("id", { ascending: false });

    if (error) {
      console.error(error);
      return;
    }

    const counts = {};
    (data || []).forEach((row) => {
      const text = row.produtos_utilizados || row.produtos_utilizados || "";
      text.split(",").map((item) => item.trim()).filter(Boolean).forEach((product) => {
        counts[product] = (counts[product] || 0) + 1;
      });
    });

    const topProducts = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    document.querySelector("#topProducts").innerHTML = topProducts.length
      ? topProducts.map(([product, qty]) => `
          <li>${product} <span>(${qty})</span></li>
        `).join("")
      : '<li>Nenhum produto usado ainda</li>';
  } catch (error) {
    console.error("Erro ao carregar top produtos:", error);
  }
}

async function loadTopServices() {
  try {
    const { data, error } = await db
      .from("ordens_servico")
      .select("servico_realizado")
      .order("id", { ascending: false });

    if (error) {
      console.error(error);
      return;
    }

    const counts = {};
    (data || []).forEach((row) => {
      const service = (row.servico_realizado || row.servico_realizado || "").trim();
      if (!service) return;
      counts[service] = (counts[service] || 0) + 1;
    });

    const topServices = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    document.querySelector("#topServices").innerHTML = topServices.length
      ? topServices.map(([service, qty]) => `
          <li>${service} <span>(${qty})</span></li>
        `).join("")
      : '<li>Nenhum serviço registrado ainda</li>';
  } catch (error) {
    console.error("Erro ao carregar top serviços:", error);
  }
}

async function loadStockAdjustmentOptions() {
  try {
    const [clientsResult, productsResult] = await Promise.all([
      db.from("clientes").select("id, nome").order("nome"),
      db.from("produtos").select("id, nome, produto").order("nome")
    ]);

    const clientsOptions = (clientsResult.data || []).map((client) => `
      <option value="${client.id}">${client.nome}</option>
    `).join("");

    const productsOptions = (productsResult.data || []).map((product) => `
      <option value="${product.id}">${product.nome || product.produto}</option>
    `).join("");

    document.querySelector("#stockClient").innerHTML = `
      <option value="">Selecione</option>${clientsOptions}
    `;
    document.querySelector("#stockProduct").innerHTML = `
      <option value="">Selecione</option>${productsOptions}
    `;
  } catch (error) {
    console.error("Erro ao carregar opções de ajuste de estoque:", error);
  }
}

/* =========================
   CLIENTES
========================= */
async function loadClients() {
  const { data } = await db
    .from("clientes")
    .select("*")
    .order("id", { ascending: false });

  clients = data || [];

  document.querySelector("#clientsTable").innerHTML = clients.map((client) => `
    <tr>
      <td>${client.nome}</td>
      <td>${client.telefone || "-"}</td>
      <td>${client.cidade || "-"}</td>
      <td>${client.tipo_piscina || "-"}</td>
      <td>
        <button class="btn secondary" data-edit-client="${client.id}">Editar</button>
        <button class="btn secondary" data-delete-client="${client.id}">Excluir</button>
      </td>
    </tr>
  `).join("");

  const options = clients
    .map((c) => `<option value="${c.id}">${c.nome}</option>`)
    .join("");

  document.querySelector("#orderClient").innerHTML = options;
  document.querySelector("#reportClient").innerHTML =
    `<option value="">Todos</option>${options}`;
}

/* =========================
   SALVAR CLIENTE
========================= */
document.querySelector("#clientForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const form = new FormData(event.target);

  const data = {
  nome: form.get("nome"),
  telefone: form.get("telefone"),
  whatsapp: form.get("whatsapp"),
  cep: form.get("cep"),
  endereco: form.get("endereco"),
  cidade: form.get("cidade"),
  tipo_piscina: form.get("tipo_piscina"),
  volume_piscina: form.get("volume_piscina"),
  quantidade_produtos_contratados: Number(form.get("quantidade_produtos_contratados") || 0),
  portal_habilitado: form.get("portal_habilitado") === "on",
  proxima_visita: form.get("next_visit"),
  observacoes: form.get("observacoes")
};

  const id = document.querySelector('#clientForm [name="id"]').value;

  const { error } = id
    ? await db.from("clientes").update(data).eq("id", id)
    : await db.from("clientes").insert([data]);

  if (error) {
    console.error(error);
    document.querySelector("#clientStatus").textContent = error.message;
    return;
  }

  event.target.reset();
  document.querySelector('#clientForm [name="id"]').value = "";

  document.querySelector("#clientStatus").textContent =
    "Cliente salvo com sucesso";

  await loadClients();
  await loadDashboard();
});


/* =========================
   DELETE / EDIT CLIENTE
========================= */
document.querySelector("#clientsTable").addEventListener("click", async (event) => {

  const editId = event.target.dataset.editClient;
  const deleteId = event.target.dataset.deleteClient;

  if (editId) {

    const client = clients.find(
      (c) => String(c.id) === String(editId)
    );

    if (!client) return;

    document.querySelector('[name="id"]').value =
      client.id || "";

    document.querySelector('[name="nome"]').value =
      client.nome || "";

    document.querySelector('[name="telefone"]').value =
      client.telefone || "";

    document.querySelector('[name="whatsapp"]').value =
      client.whatsapp || "";

    document.querySelector('[name="cep"]').value =
      client.cep || "";

    document.querySelector('[name="endereco"]').value =
      client.endereco || "";

    document.querySelector('[name="cidade"]').value =
      client.cidade || "";

    document.querySelector('[name="tipo_piscina"]').value =
      client.tipo_piscina || "";

    document.querySelector('[name="volume_piscina"]').value =
      client.volume_piscina || "";

    document.querySelector('[name="quantidade_produtos_contratados"]').value =
      client.quantidade_produtos_contratados || "";

    document.querySelector('[name="portal_habilitado"]').checked =
      Boolean(client.portal_habilitado);

    document.querySelector('[name="next_visit"]').value =
      client.proxima_visita || "";

    document.querySelector('[name="observacoes"]').value =
      client.observacoes || "";
  }

  if (deleteId) {

    if (!confirm("Excluir cliente?")) return;

    const { error } = await db
      .from("clientes")
      .delete()
      .eq("id", deleteId);

    if (error) {
      alert(error.message);
      return;
    }

    await loadClients();
    await loadDashboard();
  }
});


/* =========================
   ORDENS
========================= */
async function loadOrders() {

  const { data, error } = await db
    .from("ordens_servico")
    .select(`
      *,
      clientes(nome, telefone, whatsapp)
    `)
    .order("id", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  orders = data || [];

  document.querySelector("#ordersTable").innerHTML =
    orders.map((order) => {
      const orderDate = order.data_agendada || order.service_date || "-";
      return `
      <tr>
        <td>${orderDate}</td>
        <td>${order.clientes?.nome || "-"}</td>
        <td>${order.tecnico_responsavel || "-"}</td>
        <td>${order.produtos_utilizados || "-"}</td>
        <td>
          <button
            class="btn secondary"
            data-whatsapp="${order.id}">
            WhatsApp
          </button>
        </td>
      </tr>
    `;
    }).join("");

  document.querySelector("#photoOrder").innerHTML =
    orders.map((o) => {
      const orderDate = o.data_agendada || o.service_date || "";
      return `
      <option value="${o.id}">
        #${o.id} - ${o.clientes?.nome || "Cliente"} - ${orderDate}
      </option>
    `;
    }).join("");
}
function mapOrderToSupabase(data) {
  return {
    data_agendada: data.service_date,
    hora_servico: data.hora_servico,
    cliente_id: data.client_id,
    tecnico_responsavel: data.tecnico_responsavel,
    servico_realizado: data.servico_realizado,
    produtos_utilizados: data.produtos_utilizados,
    observacoes_tecnicas: data.observacoes_tecnicas,
    qualidade_agua: data.water_quality,
    next_visit: data.next_visit,
    ph: data.ph ? Number(data.ph) : null,
    cloro_livre: data.free_chlorine ? Number(data.free_chlorine) : null,
    alcalinidade: data.alkalinity ? Number(data.alkalinity) : null,
    temperatura: data.temperature ? Number(data.temperature) : null,
    aspirou_fundo: data.aspirou_fundo ? true : false,
    escovou_paredes: data.escovou_paredes ? true : false,
    limpeza_bordas: data.limpeza_bordas ? true : false,
    retrolavagem: data.retrolavagem ? true : false,
    aplicacao_cloro: data.aplicacao_cloro ? true : false,
    ajuste_ph: data.ajuste_ph ? true : false,
    aplicacao_algicida: data.aplicacao_algicida ? true : false,
    limpeza_pre_filtro: data.limpeza_pre_filtro ? true : false
  };
}

async function consumeSupabaseClientStock(clientId, orderId) {
  for (const item of produtosUtilizados) {
    const { data: stock, error } = await db
      .from("cliente_estoque")
      .select("*")
      .eq("cliente_id", clientId)
      .eq("produto_id", item.produto_id)
      .single();

    if (error || !stock) {
      throw new Error(`Estoque do cliente nao encontrado para ${item.produto}.`);
    }

    const available = Number(stock.quantidade || 0);
    if (available < item.quantidade) {
      throw new Error(`Estoque insuficiente para ${item.produto}. Disponivel: ${available}.`);
    }

    const { error: updateError } = await db
      .from("cliente_estoque")
      .update({
        quantidade: available - item.quantidade,
        atualizado_em: new Date().toISOString()
      })
      .eq("id", stock.id);

    if (updateError) throw updateError;

    const { error: movementError } = await db
      .from("estoque_movimentos")
      .insert([{
        cliente_id: clientId,
        produto_id: item.produto_id,
        ordem_servico_id: orderId,
        quantidade: item.quantidade,
        tipo: "uso",
        criado_em: new Date().toISOString()
      }]);

    if (movementError) {
      console.warn("Nao foi possivel registrar movimento de estoque:", movementError.message);
    }

    const { error: orderProductError } = await db
      .from("ordem_servico_produtos")
      .insert([{
        ordem_servico_id: orderId,
        cliente_id: clientId,
        produto_id: item.produto_id,
        produto_nome: item.produto,
        quantidade: item.quantidade,
        unidade: item.unidade || null
      }]);

    if (orderProductError) {
      console.warn("Nao foi possivel registrar produto estruturado da ordem:", orderProductError.message);
    }
  }
}

/* =========================
   SALVAR ORDEM
========================= */
document.querySelector("#orderForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const data = formDataJson(event.target);
  data.produtos_utilizados = produtosUtilizados
    .map((item) => `${item.quantidade}x ${item.produto}`)
    .join(", ");

  const orderPayload = mapOrderToSupabase(data);

  for (const item of produtosUtilizados) {
    const stock = produtosDisponiveisCliente.find((stockItem) => String(stockItem.produto_id) === String(item.produto_id));
    if (!stock || Number(stock.quantidade || 0) < item.quantidade) {
      document.querySelector("#orderStatus").textContent = `Estoque insuficiente para ${item.produto}.`;
      return;
    }
  }

  const { data: insertedOrder, error } = await db
    .from("ordens_servico")
    .insert([orderPayload])
    .select("id")
    .single();

  if (error) {
    console.error(error);
    document.querySelector("#orderStatus").textContent = error.message;
    return;
  }

  try {
    await consumeSupabaseClientStock(data.client_id, insertedOrder.id);
  } catch (stockError) {
    document.querySelector("#orderStatus").textContent = stockError.message;
    return;
  }

  event.target.reset();
  produtosUtilizados = [];
  renderProdutos();
  document.querySelector("#productsUsed").value = "";

  document.querySelector("#orderStatus").textContent = "Ordem registrada e estoque do cliente atualizado.";

  loadOrders();
  loadDashboard();
  loadClients();
});

/* =========================
   WHATSAPP
========================= */
document.querySelector("#ordersTable").addEventListener("click", (event) => {
  const id = event.target.dataset.whatsapp;
  if (!id) return;

  const order = orders.find((o) => String(o.id) === id);

  const reportUrl = `${location.origin}/api/reports/pdf?order_id=${id}`;
  const msg = `Ola ${order?.clientes?.nome || ""}.\n\nA visita tecnica da sua piscina foi concluida.\n\nRelatorio tecnico:\n${reportUrl}\n\nVL Piscinas`;
  const phone = String(order?.clientes?.whatsapp || order?.clientes?.telefone || "").replace(/\D/g, "");
  const url = phone
    ? `https://wa.me/55${phone}?text=${encodeURIComponent(msg)}`
    : `https://wa.me/?text=${encodeURIComponent(msg)}`;

  window.open(url, "_blank");
});

/* =========================
   LOGOUT
========================= */
document.querySelector("#logout").addEventListener("click", async () => {
  await db.auth.signOut();
  location.reload();
});
/* =========================
   ESTOQUE
========================= */

async function loadStock() {
  const { data, error } = await db
    .from("cliente_estoque")
    .select("*, clientes(nome), produtos(nome, produto, unidade)")
    .order("cliente_id");

  if (error) {
    console.error("Erro ao carregar estoque por cliente:", error);
    document.querySelector("#stockTable").innerHTML =
      `<tr><td colspan="3">Crie a tabela cliente_estoque conforme a migration do projeto.</td></tr>`;
    return;
  }

  document.querySelector("#stockTable").innerHTML =
    (data || []).map((item) => `
      <tr>
        <td>${item.clientes?.nome || "-"}</td>
        <td>${productName(item.produtos)}</td>
        <td>${item.quantidade || 0} ${productUnit(item.produtos)}</td>
      </tr>
    `).join("");
}

document.querySelector("#stockForm")
.addEventListener("submit", async (event) => {

  event.preventDefault();

  const form = new FormData(event.target);

  const { error } = await db
    .from("produtos")
    .insert([{
      nome: form.get("produto"),
      produto: form.get("produto"),
      unidade: form.get("unidade")
    }]);

  if (error) {
    alert(error.message);
    return;
  }

  event.target.reset();

  loadStock();
  loadProdutosSelect();
  loadStockAdjustmentOptions();
});

document.querySelector("#stockAdjustmentForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const form = new FormData(event.target);
  const clientId = form.get("client_id");
  const productId = form.get("produto_id");
  const quantity = Number(form.get("quantity") || 0);
  const minimumQuantity = Number(form.get("minimum_quantity") || 0);

  const statusEl = document.querySelector("#stockAdjustmentStatus");
  statusEl.textContent = "";

  if (!clientId || !productId || quantity <= 0) {
    statusEl.textContent = "Preencha cliente, produto e quantidade válidos.";
    return;
  }

  const { data: existingStock } = await db
    .from("cliente_estoque")
    .select("*")
    .eq("cliente_id", clientId)
    .eq("produto_id", productId)
    .maybeSingle();

  const payload = {
    cliente_id: clientId,
    produto_id: productId,
    quantidade: quantity,
    estoque_minimo: minimumQuantity,
    atualizado_em: new Date().toISOString()
  };

  const operation = existingStock
    ? db.from("cliente_estoque").update(payload).eq("id", existingStock.id)
    : db.from("cliente_estoque").insert([payload]);

  const { error: updateError } = await operation;

  if (updateError) {
    statusEl.textContent = updateError.message;
    return;
  }

  const { error: logError } = await db
    .from("estoque_movimentos")
    .insert([{
      cliente_id: clientId,
      produto_id: productId,
      quantidade: quantity,
      tipo: existingStock ? "ajuste" : "entrada",
      criado_em: new Date().toISOString()
    }]);

  if (logError) {
    console.warn("Não foi possível registrar movimento de estoque:", logError.message);
  }

  statusEl.textContent = "Estoque do cliente atualizado com sucesso.";
  event.target.reset();
  loadStock();
  loadStockAdjustmentOptions();
});

document.querySelector("#reportForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const form = new FormData(event.target);
  const period = form.get("period");
  const clientId = form.get("client_id");

  const query = new URLSearchParams();
  query.set("period", period);
  if (clientId) query.set("client_id", clientId);

  window.open(`/api/reports/pdf?${query.toString()}`, "_blank");
});

async function loadProdutosSelect(clientId = document.querySelector("#orderClient")?.value) {

  const selectProduto =
    document.querySelector("#produtoUtilizado");

  if (!selectProduto) return;

  if (clientId) {
    const { data, error } = await db
      .from("cliente_estoque")
      .select("*, produtos(id, nome, produto, unidade)")
      .eq("cliente_id", clientId)
      .gt("quantidade", 0)
      .order("produto_id");

    if (!error) {
      produtosDisponiveisCliente = data || [];
      selectProduto.innerHTML =
        '<option value="">Selecione</option>' +
        produtosDisponiveisCliente.map((stock) => `
          <option value="${stock.produto_id}">
            ${productName(stock.produtos)} - saldo ${stock.quantidade} ${productUnit(stock.produtos)}
          </option>
        `).join("");
      return;
    }

    console.error(error);
  }

  const { data, error } = await db.from("produtos").select("*").order("produto");
  if (error) {
    console.error(error);
    return;
  }
  produtosDisponiveisCliente = [];
  selectProduto.innerHTML =
    '<option value="">Selecione</option>' +
    (data || []).map(produto => `
      <option value="${produto.id}">
        ${productName(produto)}
      </option>
    `).join("");
}

document.querySelector("#orderClient").addEventListener("change", (event) => {
  produtosUtilizados = [];
  renderProdutos();
  loadProdutosSelect(event.target.value);
});
document
  .querySelector("#addProduto")
  .addEventListener("click", async () => {

    const produtoId =
      document.querySelector("#produtoUtilizado").value;

    const quantidade =
      Number(
        document.querySelector("#quantidadeUtilizada").value
      );

    if (!produtoId) {
      alert("Selecione um produto");
      return;
    }

    if (quantidade <= 0) {
      alert("Informe uma quantidade válida");
      return;
    }

    const stock = produtosDisponiveisCliente.find((item) => String(item.produto_id) === String(produtoId));
    if (stock && Number(stock.quantidade || 0) < quantidade) {
      alert(`Estoque insuficiente. Saldo disponivel: ${stock.quantidade}`);
      return;
    }

    const productQuery = stock
      ? { data: stock.produtos, error: null }
      : await db.from("produtos").select("*").eq("id", produtoId).single();

    const { data, error } = productQuery;

    if (error) {
      console.error(error);
      return;
    }

    produtosUtilizados.push({
      produto_id: data.id,
      produto: productName(data),
      quantidade: quantidade,
      unidade: productUnit(data)
    });

    renderProdutos();

    document.querySelector("#quantidadeUtilizada").value = "";
  });
  function renderProdutos() {

  document.querySelector("#listaProdutos").innerHTML =
    produtosUtilizados.map((item, index) => `
      <div style="
        display:flex;
        justify-content:space-between;
        padding:8px;
        border:1px solid #ddd;
        margin-top:5px;
      ">
        <span>
          ${item.produto}
          -
          ${item.quantidade}
        </span>

        <button
          type="button"
          onclick="removerProduto(${index})">
          ❌
        </button>
      </div>
    `).join("");
}
function removerProduto(index) {

  produtosUtilizados.splice(index, 1);

  renderProdutos();
}
/* =========================
   INIT
========================= */
requireAdmin();
