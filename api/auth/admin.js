const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Método não permitido" });
  }

  try {
    const { username, password } = req.body;

    const adminUser = process.env.ADMIN_USER;
    const passwordHash = process.env.ADMIN_PASSWORD_HASH;

    if (username !== adminUser) {
      return res.status(401).json({ message: "Usuário inválido" });
    }

    const isValid = await bcrypt.compare(password, passwordHash);

    if (!isValid) {
      return res.status(401).json({ message: "Senha inválida" });
    }

    const token = jwt.sign({ username: adminUser }, process.env.JWT_SECRET, { expiresIn: "8h" });

    return res.json({ token });
  } catch (err) {
    return res.status(500).json({ message: "Erro no servidor" });
  }
};
