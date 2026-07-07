// gerarHash.js
const bcrypt = require("bcrypt");

(async () => {
  const hash = await bcrypt.hash("suaSenhaForte123", 10);
  console.log(hash);
})();
