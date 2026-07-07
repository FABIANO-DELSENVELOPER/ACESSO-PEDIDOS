const jwt = require("jsonwebtoken");

function verifyToken(req) {
  const auth = req.headers.authorization;

  if (!auth) return null;

  const token = auth.split(" ")[1];

  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return null;
  }
}

module.exports = { verifyToken };
