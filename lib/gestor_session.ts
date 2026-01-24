import "server-only";
import crypto from "node:crypto";
import { q } from "@/lib/db";

type CookieJar = Record<string, string>;

type GestorSession = {
  cookies: CookieJar;
  createdAt: number;
};

let cachedSession: GestorSession | null = null;

function envRequired(name: string): string {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`${name} ausente`);
  return v;
}

function sessionTtlMs(): number {
  const mins = Number(process.env.GESTOR_SESSION_TTL_MIN || 120);
  return Math.max(5, mins) * 60 * 1000;
}

function cookieSecretKey(): Buffer {
  const raw = String(process.env.GESTOR_COOKIE_SECRET || "").trim();
  if (raw.length < 16) {
    throw new Error("GESTOR_COOKIE_SECRET ausente ou fraca (>=16 chars)");
  }
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

function encryptCookieJar(jar: CookieJar): string {
  const key = cookieSecretKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(jar), "utf8");
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decryptCookieJar(payload: string): CookieJar {
  const key = cookieSecretKey();
  const raw = Buffer.from(payload, "base64");
  if (raw.length < 12 + 16) throw new Error("Cookie payload invalido");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  const jar = JSON.parse(dec.toString("utf8"));
  return jar && typeof jar === "object" ? (jar as CookieJar) : {};
}

async function loadSessionFromDb(): Promise<GestorSession | null> {
  const res = await q<{ cookies_encrypted: string; created_at: string }>(
    "select cookies_encrypted, created_at from gestor_sessions where session_key = $1",
    ["default"]
  );
  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  const cookies = decryptCookieJar(row.cookies_encrypted);
  const createdAt = row.created_at ? new Date(row.created_at).getTime() : 0;
  return { cookies, createdAt };
}

async function saveSessionToDb(sess: GestorSession) {
  const enc = encryptCookieJar(sess.cookies);
  await q(
    `
    insert into gestor_sessions (session_key, cookies_encrypted, created_at, updated_at)
    values ($1, $2, to_timestamp($3), now())
    on conflict (session_key)
    do update set cookies_encrypted = excluded.cookies_encrypted, created_at = excluded.created_at, updated_at = now()
    `,
    ["default", enc, Math.floor(sess.createdAt / 1000)]
  );
}

function getSetCookieHeaders(headers: Headers): string[] {
  const anyHeaders = headers as any;
  if (typeof anyHeaders.getSetCookie === "function") {
    return anyHeaders.getSetCookie() as string[];
  }
  const raw = headers.get("set-cookie");
  if (!raw) return [];
  return raw.split(/,(?=[^;]+?=)/g).map((s) => s.trim()).filter(Boolean);
}

function mergeCookies(jar: CookieJar, setCookies: string[]) {
  for (const sc of setCookies) {
    const [pair] = sc.split(";");
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (name) jar[name] = value;
  }
}

function cookieHeader(jar: CookieJar): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function parseHiddenInputs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const inputRe = /<input\b[^>]*>/gi;
  const attrRe = /(\w+)\s*=\s*["']([^"']*)["']/gi;

  const inputs = html.match(inputRe) || [];
  for (const input of inputs) {
    let type = "";
    let name = "";
    let value = "";
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(input))) {
      const key = m[1].toLowerCase();
      const val = m[2];
      if (key === "type") type = val.toLowerCase();
      if (key === "name") name = val;
      if (key === "value") value = val;
    }
    if (type === "hidden" && name) out[name] = value;
  }
  return out;
}

function parseFormAction(html: string): string | null {
  const formRe = /<form\b[^>]*>/i;
  const m = html.match(formRe);
  if (!m) return null;
  const tag = m[0];
  const actionRe = /action\s*=\s*["']([^"']*)["']/i;
  const action = tag.match(actionRe);
  return action ? action[1] : null;
}

async function fetchWithCookies(
  url: string,
  init: RequestInit,
  jar: CookieJar,
  maxRedirects = 5
): Promise<{ res: Response; finalUrl: string }> {
  let currentUrl = url;
  let method = init.method || "GET";
  let body = init.body;

  for (let i = 0; i <= maxRedirects; i++) {
    const headers = new Headers(init.headers || {});
    const cookie = cookieHeader(jar);
    if (cookie) headers.set("cookie", cookie);

    let res: Response;
    try {
      res = await fetch(currentUrl, {
        ...init,
        method,
        body,
        headers,
        redirect: "manual",
      });
    } catch (err: any) {
      console.warn("gestor fetch failed", {
        url: currentUrl,
        method,
        message: String(err?.message || err),
        name: String(err?.name || ""),
        code: String(err?.code || ""),
      });
      throw err;
    }

    mergeCookies(jar, getSetCookieHeaders(res.headers));

    const loc = res.headers.get("location");
    if (loc && res.status >= 300 && res.status < 400) {
      currentUrl = new URL(loc, currentUrl).toString();
      method = "GET";
      body = undefined;
      continue;
    }

    return { res, finalUrl: currentUrl };
  }

  throw new Error("Redirecionamentos em excesso no login");
}

export function getCachedGestorSession(): GestorSession | null {
  if (!cachedSession) return null;
  if (Date.now() - cachedSession.createdAt > sessionTtlMs()) return null;
  return cachedSession;
}

export async function getGestorSession(): Promise<GestorSession | null> {
  const mem = getCachedGestorSession();
  if (mem) return mem;

  const db = await loadSessionFromDb().catch(() => null);
  if (!db) return null;
  if (Date.now() - db.createdAt > sessionTtlMs()) return null;
  cachedSession = db;
  return db;
}

export async function clearGestorSession() {
  cachedSession = null;
  await q("delete from gestor_sessions where session_key = $1", ["default"]);
}

export async function fetchGestorWithSession(
  url: string,
  init: RequestInit = {},
  maxRedirects = 5
): Promise<{ res: Response; finalUrl: string }> {
  const sess = await getGestorSession();
  if (!sess) throw new Error("Sessao do Gestor ausente");

  const result = await fetchWithCookies(url, init, sess.cookies, maxRedirects);
  cachedSession = { cookies: sess.cookies, createdAt: sess.createdAt };
  await saveSessionToDb(cachedSession);
  return result;
}

export async function loginGestor(force = false): Promise<{
  ok: boolean;
  message: string;
  finalUrl?: string;
  ageMinutes?: number;
}> {
  const existing = getCachedGestorSession();
  if (existing && !force) {
    return {
      ok: true,
      message: "Sessao ja ativa",
      ageMinutes: Math.round((Date.now() - existing.createdAt) / 60000),
    };
  }
  if (!force) {
    const db = await getGestorSession();
    if (db) {
      return {
        ok: true,
        message: "Sessao ja ativa",
        ageMinutes: Math.round((Date.now() - db.createdAt) / 60000),
      };
    }
  }

  const loginUrl = String(process.env.GESTOR_LOGIN_URL || "").trim() ||
    "https://www.gestorsistemas.inf.br/sistema/app/login/";
  const user = envRequired("GESTOR_USER");
  const pass = envRequired("GESTOR_PASS");
  const userField = String(process.env.GESTOR_LOGIN_USER_FIELD || "usuario");
  const passField = String(process.env.GESTOR_LOGIN_PASS_FIELD || "senha");
  const extraRaw = String(process.env.GESTOR_LOGIN_EXTRA_FIELDS_JSON || "").trim();
  let extraFields: Record<string, string> = {};
  if (extraRaw) {
    try {
      extraFields = JSON.parse(extraRaw) as Record<string, string>;
    } catch {
      throw new Error("GESTOR_LOGIN_EXTRA_FIELDS_JSON invalido");
    }
  }

  const jar: CookieJar = {};

  const { res: loginPageRes, finalUrl: loginFinalUrl } = await fetchWithCookies(
    loginUrl,
    { method: "GET", headers: { "user-agent": "Mozilla/5.0" } },
    jar
  );

  const loginHtml = await loginPageRes.text();
  const hiddenFields = parseHiddenInputs(loginHtml);
  const actionRaw = process.env.GESTOR_LOGIN_ACTION || parseFormAction(loginHtml) || loginFinalUrl;
  const actionUrl = new URL(actionRaw, loginFinalUrl).toString();

  const bodyParams = new URLSearchParams({
    ...hiddenFields,
    ...extraFields,
    [userField]: user,
    [passField]: pass,
  });

  const { res: postRes, finalUrl: postFinalUrl } = await fetchWithCookies(
    actionUrl,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        referer: loginFinalUrl,
        "user-agent": "Mozilla/5.0",
      },
      body: bodyParams.toString(),
    },
    jar
  );

  const bodyText = await postRes.text().catch(() => "");
  const successHint = String(process.env.GESTOR_LOGIN_SUCCESS_SUBSTRING || "").trim();
  const looksLoggedIn = successHint
    ? bodyText.includes(successHint)
    : !postFinalUrl.includes("/login");

  if (!looksLoggedIn) {
    return {
      ok: false,
      message: "Login aparentemente falhou (ainda em /login).",
      finalUrl: postFinalUrl,
    };
  }

  cachedSession = { cookies: jar, createdAt: Date.now() };
  await saveSessionToDb(cachedSession);

  return {
    ok: true,
    message: "Login OK",
    finalUrl: postFinalUrl,
  };
}

export async function getGestorCookieHeader(): Promise<string | null> {
  const sess = await getGestorSession();
  if (!sess) return null;
  const cookie = cookieHeader(sess.cookies);
  return cookie || null;
}
