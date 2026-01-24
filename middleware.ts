import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { proxy } from "./proxy";

const CRON_PATH = "/api/ops/pedidos/gestor/sync";

export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === CRON_PATH) {
    return NextResponse.next();
  }
  return proxy(req);
}

export const config = {
  matcher: ["/:path*"],
};
