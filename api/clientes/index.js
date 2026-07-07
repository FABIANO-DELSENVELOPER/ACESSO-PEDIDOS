const { verifyToken } = require("../../lib/auth");
const { supabaseAdmin } = require("../../lib/supabaseAdmin");

module.exports = async function handler(req, res) {
  const user = verifyToken(req);

  if (!user) {
    return res.status(401).json({ message: "Não autorizado" });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({ error: "Supabase não configurado." });
  }

  const { data, error } = await supabaseAdmin.from("clientes").select("*");

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json(data);
};
