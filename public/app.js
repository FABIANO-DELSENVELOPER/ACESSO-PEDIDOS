
const supabaseUrl = "https://foultkvpbrckebujpytz.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvdWx0a3ZwYnJja2VidWpweXR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NjkxNjEsImV4cCI6MjA5NjQ0NTE2MX0.b3RyZ0YKSI1UFOgjRgYN0Af3Ypitp87q84OH-GRcXHI";

window.db = typeof supabase !== "undefined" ? supabase.createClient(supabaseUrl, supabaseKey) : null;

window.api = {
  async request(url, options = {}) {
    const headers = { ...(options.headers || {}) };

    if (options.body && !(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }

    const token = localStorage.getItem("clientToken");
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, { ...options, headers });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.error || payload?.message || "Erro na requisição.");
    }

    return payload;
  }
};

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}



function setTheme() {
  document.body.classList.toggle("dark", localStorage.getItem("theme") === "dark");
}

function toggleTheme() {
  localStorage.setItem("theme", localStorage.getItem("theme") === "dark" ? "light" : "dark");
  setTheme();
}

setTheme();

document.querySelectorAll("[data-theme]").forEach((button) => button.addEventListener("click", toggleTheme));
const budgetForm = document.querySelector("#budgetForm");

if (budgetForm) {
  budgetForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const data = Object.fromEntries(new FormData(budgetForm));
    const msg = `Olá, tenho interesse em orçamento para piscina.\nNome: ${data.name || "-"}\nTelefone: ${data.phone || "-"}\nCidade: ${data.city || "-"}\nTipo de piscina: ${data.pool_type || "-"}\nMensagem: ${data.message || "-"}`;
    const url = `https://wa.me/5517988320003?text=${encodeURIComponent(msg)}`;

    window.open(url, "_blank");
    budgetForm.reset();

    const status = document.querySelector("#budgetStatus");
    if (status) {
      status.textContent = "Abrindo WhatsApp para enviar seu orçamento...";
    }
  });
}
