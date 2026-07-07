const clientLoginScreen = document.querySelector("#clientLoginScreen");
const clientApp = document.querySelector("#clientApp");
let pendingLogin = "";

function requireClient() {
  const token = localStorage.getItem("clientToken");
  clientLoginScreen.hidden = Boolean(token);
  clientApp.hidden = !token;
  if (token) loadClientPortal();
}

function drawChart(rows) {
  const canvas = document.querySelector("#waterChart");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--panel");
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const metrics = [
    ["ph", "#0057B8", "pH"],
    ["free_chlorine", "#00BFFF", "Cloro"],
    ["alkalinity", "#16a34a", "Alcal."],
    ["temperature", "#f97316", "Temp."]
  ];
  const padding = 44;
  const values = rows.flatMap((row) => metrics.map(([key]) => Number(row[key] || 0))).filter(Boolean);
  const max = Math.max(10, ...values);

  ctx.strokeStyle = "#d9e6f2";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padding + ((canvas.height - padding * 2) / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(canvas.width - padding, y);
    ctx.stroke();
  }

  metrics.forEach(([key, color, label], metricIndex) => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    rows.forEach((row, index) => {
      const x = padding + (index / Math.max(1, rows.length - 1)) * (canvas.width - padding * 2);
      const y = canvas.height - padding - (Number(row[key] || 0) / max) * (canvas.height - padding * 2);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      ctx.moveTo(x, y);
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.fillText(label, padding + metricIndex * 86, 22);
  });
}

async function loadClientPortal() {
  const data = await api.request("/api/client/me");
  const lastOrder = data.orders[0];
  document.querySelector("#clientName").textContent = data.client.name;
  document.querySelector("#nextVisit").textContent = data.client.next_visit || "-";
  document.querySelector("#serviceCount").textContent = data.orders.length;
  document.querySelector("#waterQuality").textContent = lastOrder?.water_quality || "-";

  const photosByOrder = (data.photos || []).reduce((acc, photo) => {
    acc[photo.order_id] = acc[photo.order_id] || [];
    acc[photo.order_id].push(photo);
    return acc;
  }, {});

  document.querySelector("#clientOrders").innerHTML = data.orders.map((order) => `
    <tr>
      <td>${order.service_date} ${order.hora_servico}</td>
      <td>${order.servico_realizado}</td>
      <td>${order.produtos_utilizados || "-"}</td>
      <td>${order.observacoes_tecnicas || "-"}</td>
      <td>${order.water_quality || "-"}</td>
    </tr>
  `).join("");

  document.querySelector("#clientPhotos").innerHTML = data.orders.map((order) => `
    <article class="card visit-photos">
      <h3>${order.service_date} ${order.hora_servico} - ${order.employee || "Tecnico"}</h3>
      <p>${order.observacoes_tecnicas || "Sem observacoes."}</p>
      <div class="photos">
        ${(photosByOrder[order.id] || []).map((photo) => `
          <figure>
            <img src="${photo.file_path}" alt="${photo.kind === "before" ? "Antes" : "Depois"}">
            <figcaption>${photo.kind === "before" ? "Antes da limpeza" : "Depois da limpeza"}</figcaption>
          </figure>
        `).join("") || "<p>Sem fotos cadastradas para esta visita.</p>"}
      </div>
    </article>
  `).join("");

  document.querySelector("#clientStock").innerHTML = (data.stock || []).map((item) => {
    const status = Number(item.quantity || 0) <= Number(item.minimum_quantity || 0) ? "Baixo" : "Disponivel";
    return `
      <tr>
        <td>${item.name}</td>
        <td>${item.quantity || 0} ${item.unit || ""}</td>
        <td>${item.minimum_quantity || 0} ${item.unit || ""}</td>
        <td>${status}</td>
      </tr>
    `;
  }).join("");

  drawChart(data.water);
}

document.querySelector("#clientLogin").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));

    if (!pendingLogin) {
      const response = await api.request("/api/auth/client/request-otp", {
        method: "POST",
        body: JSON.stringify({ login: data.login })
      });
      pendingLogin = data.login;
      document.querySelector("#otpCodeField").hidden = false;
      document.querySelector("#otpCodeField input").required = true;
      document.querySelector("#clientLoginButton").textContent = "Validar código";
      document.querySelector("#clientLoginStatus").textContent = response.dev_code
        ? `Codigo enviado. Ambiente dev: ${response.dev_code}`
        : "Codigo enviado por SMS.";
      return;
    }

    const auth = await api.request("/api/auth/client/verify-otp", {
      method: "POST",
      body: JSON.stringify({ login: pendingLogin, code: data.code })
    });
    localStorage.setItem("clientToken", auth.token);
    requireClient();
  } catch (error) {
    document.querySelector("#clientLoginStatus").textContent = error.message;
  }
});

document.querySelector("#clientLogout").addEventListener("click", () => {
  localStorage.removeItem("clientToken");
  location.reload();
});

requireClient();
