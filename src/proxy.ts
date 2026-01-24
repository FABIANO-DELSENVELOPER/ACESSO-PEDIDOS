import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cookieName, verifySession } from "@/lib/ops_auth";

function isPublicPath(pathname: string) {
  if (pathname === "/login") return true;
  if (pathname === "/ops/login") return true;
  if (pathname.startsWith("/api/ops/login")) return true;
  if (pathname.startsWith("/api/ops/pedidos/gestor/sync")) return true;
  if (pathname.startsWith("/api/auth/login")) return true;
  if (pathname.startsWith("/api/auth/logout")) return true;
  if (pathname.startsWith("/_next")) return true;
  if (pathname === "/favicon.ico") return true;
  return false;
}

function isCronAuthorized(req: NextRequest) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization") || "";
  const headerSecret = req.headers.get("x-cron-secret") || "";
  return auth === `Bearer ${secret}` || headerSecret === secret;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicPath(pathname)) return NextResponse.next();
  if (isCronAuthorized(req)) return NextResponse.next();

  const token = req.cookies.get(cookieName())?.value || null;
  const v = await verifySession(token);

  if (!v.ok) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
