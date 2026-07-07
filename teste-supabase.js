import { query } from "./lib/postgres.js";

try {
  const result = await query("SELECT NOW()");
  console.log(result.rows);
} catch (err) {
  console.error(err);
}
