import { NextResponse } from "next/server";
import { cookieName, getUsers, isValidPass, signSession } from "@/lib/ops_auth";

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return bad("JSON inválido");

  const user = String(body.user ?? body.username ?? "");
  const pass = String(body.pass ?? body.password ?? "");

  const users = getUsers();

  if (!user || !pass) return bad("Usuário e senha são obrigatórios.", 400);

  if (!users[user]) return bad("Usuário inválido", 401);

  // mantém sua regra de 8 dígitos
  if (!isValidPass(pass)) return bad("Senha inválida", 401);

  // ✅ evita bug number vs string
  if (String(users[user]) !== pass) return bad("Senha incorreta", 401);

  const token = await signSession(user, 60 * 60 * 24 * 30);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return res;
}
