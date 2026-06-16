import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, normalize, resolve } from "node:path";
import { randomBytes, pbkdf2Sync, timingSafeEqual, createHash } from "node:crypto";
import { initDb, getDb, seedIfEmpty } from "./src/db.mjs";

const env = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "127.0.0.1",
  sessionSecret: process.env.SESSION_SECRET || "dev-only-change-me-legacyvault",
  databasePath: process.env.DATABASE_PATH || "./data/legacyvault.sqlite",
  uploadDir: process.env.UPLOAD_DIR || "./uploads",
  emergencyDelayDays: Number(process.env.EMERGENCY_ACCESS_DELAY_DAYS || 7)
};

await mkdir(resolve(env.uploadDir), { recursive: true });
initDb(env.databasePath);
seedIfEmpty();

const db = getDb();
const publicDir = resolve("public");
const uploadRoot = resolve(env.uploadDir);
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".json", "application/json; charset=utf-8"]
]);

function json(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "same-origin"
  });
  res.end(JSON.stringify(payload));
}

function badRequest(res, message) {
  json(res, 400, { error: message });
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => {
    const [key, ...value] = part.trim().split("=");
    return [key, decodeURIComponent(value.join("=") || "")];
  }).filter(([key]) => key));
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = pbkdf2Sync(password, salt, 210000, 32, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const attempt = hashPassword(password, salt).split(":")[1];
  return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(attempt, "hex"));
}

function sessionToken() {
  return randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return createHash("sha256").update(`${env.sessionSecret}:${token}`).digest("hex");
}

function getSession(req) {
  const token = parseCookies(req.headers.cookie).lv_session;
  if (!token) return null;
  return db.prepare(`
    SELECT sessions.id, sessions.user_id, users.email, users.name, users.role
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE token_hash = ? AND expires_at > datetime('now')
  `).get(hashToken(token)) || null;
}

function requireAuth(req, res) {
  const session = getSession(req);
  if (!session) {
    json(res, 401, { error: "Please sign in to continue." });
    return null;
  }
  return session;
}

function audit(userId, action, details = "") {
  db.prepare("INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)").run(userId, action, details);
}

async function readBody(req, limit = 8 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const body = await readBody(req);
  if (!body.length) return {};
  return JSON.parse(body.toString("utf8"));
}

function parseMultipart(buffer, contentType) {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/?.[1] || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/?.[2];
  if (!boundary) return { fields: {}, files: {} };
  const raw = buffer.toString("binary");
  const parts = raw.split(`--${boundary}`).slice(1, -1);
  const fields = {};
  const files = {};
  for (const part of parts) {
    const trimmed = part.replace(/^\r\n/, "");
    const [rawHeaders, ...bodyParts] = trimmed.split("\r\n\r\n");
    const body = bodyParts.join("\r\n\r\n").replace(/\r\n$/, "");
    const name = rawHeaders.match(/name="([^"]+)"/)?.[1];
    const filename = rawHeaders.match(/filename="([^"]*)"/)?.[1];
    if (!name) continue;
    if (filename) {
      const contentTypeHeader = rawHeaders.match(/content-type:\s*([^\r\n]+)/i)?.[1] || "application/octet-stream";
      files[name] = { filename, contentType: contentTypeHeader, buffer: Buffer.from(body, "binary") };
    } else {
      fields[name] = body;
    }
  }
  return { fields, files };
}

function mapRows(table, where = "user_id = ?", params = []) {
  return db.prepare(`SELECT * FROM ${table} WHERE ${where} ORDER BY created_at DESC`).all(...params);
}

function estateMetrics(userId) {
  const assets = db.prepare("SELECT COALESCE(SUM(value), 0) AS total FROM assets WHERE user_id = ?").get(userId).total;
  const liabilities = db.prepare("SELECT COALESCE(SUM(value), 0) AS total FROM liabilities WHERE user_id = ?").get(userId).total;
  const documents = db.prepare("SELECT COUNT(*) AS total FROM documents WHERE user_id = ?").get(userId).total;
  const contacts = db.prepare("SELECT COUNT(*) AS total FROM contacts WHERE user_id = ? AND role IN ('Spouse','Executor','Financial adviser','Attorney','Beneficiary')").get(userId).total;
  const netWorth = assets - liabilities;
  const estateDuty = calculateEstateDuty(netWorth);
  const executorFees = netWorth > 0 ? netWorth * 0.035 * 1.15 : 0;
  const cashAssets = db.prepare("SELECT COALESCE(SUM(value), 0) AS total FROM assets WHERE user_id = ? AND type IN ('Bank account','Life policy')").get(userId).total;
  const liquidityShortfall = Math.max(0, estateDuty + executorFees + liabilities - cashAssets);
  return { assets, liabilities, netWorth, estateDuty, executorFees, liquidityShortfall, documents, contacts };
}

function calculateEstateDuty(netWorth) {
  const taxable = Math.max(0, netWorth - 3500000);
  const firstBand = Math.min(taxable, 30000000 - 3500000);
  const secondBand = Math.max(0, taxable - firstBand);
  return firstBand * 0.2 + secondBand * 0.25;
}

function toAssetPayload(body) {
  return [
    body.name,
    body.type,
    Number(body.value || 0),
    body.institution || "",
    body.accountNumber || "",
    body.notes || "",
    body.documentId || null,
    body.beneficiary || ""
  ];
}

async function handleApi(req, res, pathname) {
  try {
    if (pathname === "/api/health" && req.method === "GET") {
      return json(res, 200, {
        ok: true,
        name: "LegacyVault",
        status: "healthy",
        timestamp: new Date().toISOString()
      });
    }

    if (pathname === "/api/auth/register" && req.method === "POST") {
      const body = await readJson(req);
      if (!body.email || !body.password || !body.name) return badRequest(res, "Name, email and password are required.");
      if (body.password.length < 10) return badRequest(res, "Use a password of at least 10 characters.");
      const role = body.role || "Owner";
      const info = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)").run(body.name, body.email.toLowerCase(), hashPassword(body.password), role);
      audit(info.lastInsertRowid, "REGISTERED", `Role: ${role}`);
      return json(res, 201, { ok: true });
    }

    if (pathname === "/api/auth/login" && req.method === "POST") {
      const body = await readJson(req);
      const user = db.prepare("SELECT * FROM users WHERE email = ?").get(String(body.email || "").toLowerCase());
      if (!user || !verifyPassword(String(body.password || ""), user.password_hash)) return json(res, 401, { error: "Invalid email or password." });
      const token = sessionToken();
      db.prepare("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, datetime('now', '+8 hours'))").run(user.id, hashToken(token));
      audit(user.id, "SIGNED_IN", "Password login");
      res.setHeader("set-cookie", `lv_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
      return json(res, 200, { ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    }

    if (pathname === "/api/auth/logout" && req.method === "POST") {
      const cookies = parseCookies(req.headers.cookie);
      if (cookies.lv_session) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(cookies.lv_session));
      res.setHeader("set-cookie", "lv_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
      return json(res, 200, { ok: true });
    }

    if (pathname === "/api/auth/reset" && req.method === "POST") {
      const body = await readJson(req);
      const user = db.prepare("SELECT id FROM users WHERE email = ?").get(String(body.email || "").toLowerCase());
      if (user) audit(user.id, "PASSWORD_RESET_REQUESTED", "Email delivery placeholder");
      return json(res, 200, { ok: true, message: "If the email exists, a reset link would be sent." });
    }

    const session = requireAuth(req, res);
    if (!session) return;

    if (pathname === "/api/me" && req.method === "GET") {
      return json(res, 200, {
        user: { id: session.user_id, name: session.name, email: session.email, role: session.role },
        twoFactor: { enabled: false, status: "Placeholder" }
      });
    }

    if (pathname === "/api/dashboard" && req.method === "GET") {
      return json(res, 200, {
        metrics: estateMetrics(session.user_id),
        recentActivity: mapRows("audit_logs", "user_id = ?", [session.user_id]).slice(0, 8),
        emergencyContacts: db.prepare("SELECT * FROM contacts WHERE user_id = ? AND access_level IN ('Emergency access','Executor access') ORDER BY name").all(session.user_id)
      });
    }

    if (pathname === "/api/documents" && req.method === "GET") {
      return json(res, 200, { documents: mapRows("documents", "user_id = ?", [session.user_id]) });
    }

    if (pathname === "/api/documents" && req.method === "POST") {
      const body = await readBody(req);
      const { fields, files } = parseMultipart(body, req.headers["content-type"] || "");
      const file = files.file;
      let storedPath = "";
      let originalName = "";
      if (file?.filename) {
        const safeName = file.filename.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120);
        const ext = extname(safeName).toLowerCase();
        const allowed = new Set([".pdf", ".png", ".jpg", ".jpeg", ".doc", ".docx", ".txt"]);
        if (!allowed.has(ext)) return badRequest(res, "Upload a PDF, image, Word or text document.");
        const storedName = `${Date.now()}-${randomBytes(8).toString("hex")}${ext}`;
        await writeFile(join(uploadRoot, storedName), file.buffer);
        storedPath = storedName;
        originalName = safeName;
      }
      db.prepare(`
        INSERT INTO documents (user_id, title, category, notes, owner_name, access_permissions, file_name, stored_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(session.user_id, fields.title, fields.category, fields.notes || "", fields.owner || session.name, fields.accessPermissions || "Owner only", originalName, storedPath);
      audit(session.user_id, "DOCUMENT_UPLOADED", fields.title || "Untitled document");
      return json(res, 201, { ok: true });
    }

    if (pathname === "/api/assets" && req.method === "GET") return json(res, 200, { assets: mapRows("assets", "user_id = ?", [session.user_id]) });
    if (pathname === "/api/assets" && req.method === "POST") {
      const body = await readJson(req);
      db.prepare(`
        INSERT INTO assets (user_id, name, type, value, institution, account_number, notes, document_id, beneficiary)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(session.user_id, ...toAssetPayload(body));
      audit(session.user_id, "ASSET_ADDED", body.name);
      return json(res, 201, { ok: true });
    }

    if (pathname === "/api/liabilities" && req.method === "GET") return json(res, 200, { liabilities: mapRows("liabilities", "user_id = ?", [session.user_id]) });
    if (pathname === "/api/liabilities" && req.method === "POST") {
      const body = await readJson(req);
      db.prepare(`
        INSERT INTO liabilities (user_id, name, type, value, institution, account_number, notes, document_id, beneficiary)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(session.user_id, ...toAssetPayload(body));
      audit(session.user_id, "LIABILITY_ADDED", body.name);
      return json(res, 201, { ok: true });
    }

    if (pathname === "/api/contacts" && req.method === "GET") return json(res, 200, { contacts: mapRows("contacts", "user_id = ?", [session.user_id]) });
    if (pathname === "/api/contacts" && req.method === "POST") {
      const body = await readJson(req);
      db.prepare(`
        INSERT INTO contacts (user_id, name, role, email, mobile, company, notes, access_level)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(session.user_id, body.name, body.role, body.email || "", body.mobile || "", body.company || "", body.notes || "", body.accessLevel || "View only");
      audit(session.user_id, "CONTACT_ADDED", `${body.name} (${body.role})`);
      return json(res, 201, { ok: true });
    }

    if (pathname === "/api/beneficiaries" && req.method === "GET") return json(res, 200, { beneficiaries: mapRows("beneficiaries", "user_id = ?", [session.user_id]) });
    if (pathname === "/api/beneficiaries" && req.method === "POST") {
      const body = await readJson(req);
      db.prepare(`
        INSERT INTO beneficiaries (user_id, name, relationship, email, mobile, linked_asset, notes, notification_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(session.user_id, body.name, body.relationship, body.email || "", body.mobile || "", body.linkedAsset || "", body.notes || "", body.notificationStatus || "Draft");
      audit(session.user_id, "BENEFICIARY_ADDED", body.name);
      return json(res, 201, { ok: true });
    }

    if (pathname === "/api/access-requests" && req.method === "GET") return json(res, 200, { requests: mapRows("access_requests", "owner_user_id = ?", [session.user_id]) });
    if (pathname === "/api/access-requests" && req.method === "POST") {
      const body = await readJson(req);
      db.prepare(`
        INSERT INTO access_requests (owner_user_id, requester_name, requester_email, access_level, reason, release_at, status)
        VALUES (?, ?, ?, ?, ?, datetime('now', ?), 'Pending owner review')
      `).run(session.user_id, body.name, body.email, body.accessLevel || "Emergency access", body.reason || "", `+${env.emergencyDelayDays} days`);
      audit(session.user_id, "EMERGENCY_ACCESS_REQUESTED", `${body.name}: delayed ${env.emergencyDelayDays} days`);
      return json(res, 201, { ok: true });
    }

    if (pathname === "/api/adviser" && req.method === "GET") {
      const clients = db.prepare("SELECT * FROM adviser_clients WHERE adviser_user_id = ? ORDER BY client_name").all(session.user_id);
      const missing = ["Signed will", "Updated beneficiary nominations", "Liquidity plan", "Executor appointment letter"];
      return json(res, 200, { clients, missing, whiteLabel: "Placeholder for adviser branding" });
    }

    if (pathname === "/api/calculators" && req.method === "POST") {
      const body = await readJson(req);
      const assets = Number(body.assets || 0);
      const liabilities = Number(body.liabilities || 0);
      const cash = Number(body.cash || 0);
      const netWorth = assets - liabilities;
      const estateDuty = calculateEstateDuty(netWorth);
      const executorFees = Math.max(0, netWorth * 0.035 * 1.15);
      return json(res, 200, { netWorth, estateDuty, executorFees, liquidityShortfall: Math.max(0, estateDuty + executorFees + liabilities - cash) });
    }

    if (pathname === "/api/settings" && req.method === "PATCH") {
      const body = await readJson(req);
      db.prepare("UPDATE users SET role = ?, name = ? WHERE id = ?").run(body.role || session.role, body.name || session.name, session.user_id);
      audit(session.user_id, "SETTINGS_UPDATED", "Profile settings");
      return json(res, 200, { ok: true });
    }

    json(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    json(res, 500, { error: error.message || "Something went wrong." });
  }
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(publicDir, `.${safePath}`);
  if (!filePath.startsWith(publicDir)) return json(res, 403, { error: "Forbidden" });
  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes.get(extname(filePath)) || "application/octet-stream",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      "referrer-policy": "same-origin"
    });
    res.end(file);
  } catch {
    const app = await readFile(join(publicDir, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(app);
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url.pathname);
  if (url.pathname.startsWith("/uploads/")) {
    const candidate = resolve(uploadRoot, url.pathname.replace("/uploads/", ""));
    if (!candidate.startsWith(uploadRoot) || !existsSync(candidate)) return json(res, 404, { error: "Not found" });
    res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": "attachment" });
    return res.end(await readFile(candidate));
  }
  return serveStatic(req, res, url.pathname);
}).listen(env.port, env.host, () => {
  console.log(`LegacyVault running at http://${env.host}:${env.port}`);
});