import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SignJWT, jwtVerify } from "jose";
import { OAuth2Client } from "google-auth-library";
import { installControl } from "./control.mjs";

const cfg = {
  port: Number(process.env.PORT || 3001),
  db: process.env.DATABASE_PATH || "./engx.sqlite",
  jwt: process.env.JWT_SECRET || "",
  origin: process.env.CORS_ORIGIN || "http://localhost:5173,https://localhost,capacitor://localhost",
  google: process.env.GOOGLE_CLIENT_ID || "",
  backup: process.env.BACKUP_DIR || "./backups",
};
if (cfg.jwt.length < 32 && process.env.NODE_ENV === "production")
  throw new Error("JWT_SECRET must be at least 32 characters");
const db = new Database(path.resolve(cfg.db));
db.pragma("foreign_keys=ON");
db.pragma("journal_mode=WAL");
db.exec(
  `CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT,google_sub TEXT UNIQUE,created_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_id TEXT NOT NULL REFERENCES users(id),revoked INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS memberships(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL CHECK(role IN ('owner','admin','technician','viewer')),status TEXT NOT NULL DEFAULT 'active',UNIQUE(workspace_id,user_id));CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT,created_by TEXT NOT NULL,domain TEXT NOT NULL,type TEXT NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);CREATE INDEX IF NOT EXISTS records_ws ON records(workspace_id,type);CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT,domain TEXT NOT NULL,action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,before TEXT,after TEXT,hash TEXT NOT NULL,previous_hash TEXT);CREATE TABLE IF NOT EXISTS ops(id TEXT NOT NULL,workspace_id TEXT NOT NULL,accepted_at TEXT NOT NULL,PRIMARY KEY(id,workspace_id));CREATE TABLE IF NOT EXISTS backups(workspace_id TEXT PRIMARY KEY,encrypted TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS invitations(code TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,email TEXT NOT NULL,role TEXT NOT NULL,expires_at TEXT NOT NULL,used_at TEXT);CREATE TABLE IF NOT EXISTS section_definitions(id TEXT NOT NULL,workspace_id TEXT NOT NULL REFERENCES workspaces(id),label TEXT NOT NULL,labelEn TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',archived INTEGER NOT NULL DEFAULT 0,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(workspace_id,id));CREATE INDEX IF NOT EXISTS section_definitions_ws ON section_definitions(workspace_id);`,
);

const builtinSections = [
  { id:"medical", label:"الأجهزة الطبية", labelEn:"Medical devices", description:"", archived:false },
  { id:"mobiles", label:"الموبايلات", labelEn:"Mobiles", description:"", archived:false },
  { id:"appliances", label:"الأجهزة المنزلية", labelEn:"Home appliances", description:"", archived:false },
  { id:"screens", label:"الشاشات", labelEn:"Screens", description:"", archived:false },
  { id:"electronics", label:"الإلكترونيات", labelEn:"Electronics", description:"", archived:false },
  { id:"workshops", label:"الورش الأخرى", labelEn:"Other workshops", description:"", archived:false },
  { id:"sales", label:"بيع المنتجات", labelEn:"Product sales", description:"", archived:false },
];
const domainIds = new Set(builtinSections.map(x => x.id));
const customIdRe = /^custom_[a-f0-9]{32}$/;
const isCustomId = (v) => typeof v === "string" && customIdRe.test(v);
const normalizeDomain = (v) => domainIds.has(v) || isCustomId(v) ? v : "medical";

try { db.exec("ALTER TABLE users ADD COLUMN virtual_number TEXT"); } catch {}
const newVirtualNumber = () => { for (let i=0;i<100;i++) { const n=String(crypto.randomInt(10000000,100000000)); if (!db.prepare("SELECT 1 FROM users WHERE virtual_number=?").get(n)) return n; } throw new Error("VIRTUAL_NUMBER_EXHAUSTED"); };
const missingUsers = db.prepare("SELECT id FROM users WHERE virtual_number IS NULL OR virtual_number=''").all();
if (missingUsers.length) db.transaction(() => { const q=db.prepare("UPDATE users SET virtual_number=? WHERE id=?"); for (const u of missingUsers) q.run(newVirtualNumber(),u.id); });
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_virtual_number_uq ON users(virtual_number)"); } catch {}
db.exec(`CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,workspace_id TEXT NOT NULL REFERENCES workspaces(id),sender_id TEXT NOT NULL REFERENCES users(id),text TEXT NOT NULL,created_at TEXT NOT NULL,client_id TEXT NOT NULL,UNIQUE(workspace_id,client_id));CREATE INDEX IF NOT EXISTS messages_ws_seq ON messages(workspace_id,seq);CREATE TABLE IF NOT EXISTS chat_files(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,content TEXT NOT NULL);`);
try { db.exec("ALTER TABLE messages ADD COLUMN domain TEXT NOT NULL DEFAULT 'medical'"); } catch {}
try {
  db.exec(
    `CREATE TRIGGER IF NOT EXISTS audit_immutable_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'AUDIT_APPEND_ONLY'); END;CREATE TRIGGER IF NOT EXISTS audit_immutable_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'AUDIT_APPEND_ONLY'); END;`,
  );
} catch {}
const now = () => new Date().toISOString(),
  uid = () => crypto.randomUUID(),
  parse = (x) => {
    try {
      return JSON.parse(x);
    } catch {
      return null;
    }
  },
  safeJson = (x) => JSON.stringify(x ?? null);
const RECORD_PREFIX = { device:"DEV", order:"WO", part:"PART", plan:"PM", event:"EVT", usage:"USE", comment:"NOTE", correction:"NOTE", checklist:"NOTE", attachment:"DOC", calibration:"CAL", sale:"SAL", purchase:"PUR", report:"REP" };
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function recordCode(type, id) {
  const prefix = RECORD_PREFIX[type], value = String(id || "");
  if (!prefix) return null;
  if (/^[0-9a-f]{32}$/i.test(value.replaceAll("-",""))) { let n=BigInt("0x"+value.replaceAll("-","")), out=""; for(let i=0;i<26;i++){out=CROCKFORD[Number(n&31n)]+out;n>>=5n;} return `${prefix}-${out}`; }
  return `${prefix}-${value.toUpperCase().replace(/[^A-Z0-9]+/g,"_").replace(/^_|_$/g,"")||"ID"}`;
}
// Migrate legacy payloads without touching their timestamps, then enforce global uniqueness (including tombstones).
for (const row of db.prepare("SELECT id,type,data FROM records").all()) { const data=parse(row.data)||{}; if(!data.record_code){const code=recordCode(row.type,row.id); if(code) db.prepare("UPDATE records SET data=? WHERE id=?").run(safeJson({...data,record_code:code}),row.id);} }
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS records_record_code_uq ON records(json_extract(data,'$.record_code') COLLATE NOCASE)");
const types = new Set([
  "device",
  "order",
  "part",
  "usage",
  "plan",
  "event",
  "attachment",
  "comment",
  "correction",
  "checklist",
  "calibration",
  "sale",
  "purchase",
  "report",
]);
const roles = new Set(["owner", "admin", "technician", "viewer"]);
const app = express();
app.use(helmet());
app.use(
  cors({
    origin: (o, cb) => {
      if (
        !o ||
        cfg.origin
          .split(",")
          .map((x) => x.trim())
          .includes(o)
      )
        cb(null, true);
      else cb(new Error("CORS"));
    },
    credentials: true,
  }),
);
app.use("/api/backups",express.json({limit:"155mb"}));
app.use(express.json({ limit: "32mb" }));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
// Install control tables only after the ordinary application schema is ready.
installControl(app, db, cfg);
const secret = cfg.jwt || crypto.randomBytes(48).toString("base64url"),
  key = new TextEncoder().encode(secret);
const passwordHash = (p) => {
  const s = crypto.randomBytes(16).toString("hex");
  return `${s}:${crypto.scryptSync(p, s, 64).toString("hex")}`;
};
const passwordOk = (p, h) => {
  try {
    const [s, x] = h.split(":");
    const a = Buffer.from(x, "hex"),
      b = crypto.scryptSync(p, s, 64);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
};
const validEmail = (e) =>
  typeof e === "string" &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) &&
  e.length <= 254;
async function makeToken(u) {
  return new SignJWT({ sub: u.id, email: u.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key);
}
async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    if (!h.startsWith("Bearer "))
      return res.status(401).json({ code: "UNAUTHORIZED" });
    req.user = (await jwtVerify(h.slice(7), key)).payload;
    next();
  } catch {
    return res.status(401).json({ code: "UNAUTHORIZED" });
  }
}
function member(uid, wid) {
  return db
    .prepare(
      "SELECT m.*,w.name workspace_name,w.owner_id,w.revoked FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=? AND m.workspace_id=?",
    )
    .get(uid, wid);
}
function ws(req, res, wid, allowed = []) {
  const m = member(req.user.sub, wid);
  if (!m) return res.status(403).json({ code: "FORBIDDEN" });
  if (m.revoked) return res.status(403).json({ code: "WORKSPACE_REVOKED" });
  if (m.status !== "active")
    return res.status(403).json({ code: "MEMBERSHIP_INACTIVE" });
  if (allowed.length && !allowed.includes(m.role))
    return res.status(403).json({ code: "ROLE_FORBIDDEN" });
  return m;
}
function registeredDomain(workspaceId, domain) {
  return domainIds.has(domain) || (isCustomId(domain) && !!db.prepare("SELECT 1 FROM section_definitions WHERE workspace_id=? AND id=?").get(workspaceId, domain));
}
function sectionDto(row) { return { id:row.id, label:row.label, labelEn:row.labelEn, description:row.description || "", archived:!!row.archived }; }
function workspaceSections(workspaceId) {
  const overrides = new Map(db.prepare("SELECT * FROM section_definitions WHERE workspace_id=?").all(workspaceId).map(x => [x.id, x]));
  return [...builtinSections.map(x => overrides.has(x.id) ? {...x, ...sectionDto(overrides.get(x.id))} : x), ...[...overrides.values()].filter(x => isCustomId(x.id)).map(sectionDto)];
}
const validSectionText = (v, required=false) => { if (v === undefined && !required) return true; return typeof v === "string" && [...v.trim()].length >= 1 && [...v.trim()].length <= 80; };
function sectionInput(body, existing) {
  if (!validSectionText(body.label, true) || (body.labelEn !== undefined && !validSectionText(body.labelEn)) || (body.description !== undefined && typeof body.description !== "string")) return { code:"INVALID_SECTION" };
  const label = body.label.trim(), labelEn = body.labelEn === undefined ? (existing?.labelEn || label) : body.labelEn.trim(), description = body.description === undefined ? (existing?.description || "") : body.description.trim();
  if ([...labelEn].length > 80 || [...description].length > 1000 || (body.archived !== undefined && typeof body.archived !== "boolean")) return { code:"INVALID_SECTION" };
  return { label, labelEn, description, archived: body.archived === undefined ? !!existing?.archived : body.archived };
}

function authDto(u, w, m, t) {
  return {
    token: t,
    user: { id: u.id, name: u.name, email: u.email, virtual_number: u.virtual_number },
    workspace: { id: w.id, name: w.name, owner_id: w.owner_id },
    membership: { role: m.role, status: m.status },
  };
}
function createUser({ email, name, password, google_sub }) {
  const u = {
    id: uid(),
    email: email.trim().toLowerCase(),
    name: (name || email.split("@")[0]).trim().slice(0, 120),
    virtual_number: newVirtualNumber(),
  };
  db.prepare("INSERT INTO users (id,name,email,password_hash,google_sub,created_at,virtual_number) VALUES (?,?,?,?,?,?,?)").run(
    u.id,
    u.name,
    u.email,
    password ? passwordHash(password) : null,
    google_sub || null,
    now(),
    u.virtual_number,
  );
  const w = { id: uid(), name: `مساحة ${u.name}`, owner_id: u.id };
  db.prepare("INSERT INTO workspaces VALUES (?,?,?,?,?)").run(
    w.id,
    w.name,
    u.id,
    0,
    now(),
  );
  const m = {
    id: uid(),
    workspace_id: w.id,
    user_id: u.id,
    role: "owner",
    status: "active",
  };
  db.prepare("INSERT INTO memberships VALUES (?,?,?,?,?)").run(
    m.id,
    w.id,
    u.id,
    "owner",
    "active",
  );
  return { u, w, m };
}
function audit(w, user, op, before, after) {
  const prev =
    db
      .prepare(
        "SELECT hash FROM audit WHERE workspace_id=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(w)?.hash || null;
  const a = {
    id: uid(),
    workspace_id: w,
    created_by: user,
    created_at: now(),
    updated_at: now(),
    deleted_at: null,
    domain: normalizeDomain(op._auditDomain || op.record?.domain || op.domain || "medical"),
    action: op.action,
    entity_type: String(op.record?.type || op.entity_type || "activity").slice(
      0,
      80,
    ),
    entity_id: String(op.record?.id || op.entity_id || op.id),
    before,
    after,
    previous_hash: prev,
  };
  a.hash = crypto.createHash("sha256").update(safeJson(a)).digest("hex");
  db.prepare("INSERT INTO audit VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
    a.id,
    w,
    user,
    a.created_at,
    a.updated_at,
    null,
    a.domain,
    a.action,
    a.entity_type,
    a.entity_id,
    safeJson(before),
    safeJson(after),
    a.hash,
    prev,
  );
  return a;
}
function recordRow(r, w, t, user) {
  return {
    id: r.id,
    type: r.type,
    workspace_id: w,
    created_at: r.created_at || t,
    updated_at: r.updated_at || t,
    deleted_at: null,
    created_by: r.created_by || user,
    domain: normalizeDomain(r.domain),
    data: r.data,
    version: Number(r.version || 1),
  };
}
function assetConflict(w, data, id, domain) {
  if (!data?.asset_code) return false;
  return !!db
    .prepare(
      "SELECT id FROM records WHERE workspace_id=? AND domain=? AND type='device' AND lower(json_extract(data,'$.asset_code'))=lower(?) AND deleted_at IS NULL AND id<>?",
    )
    .get(w, normalizeDomain(domain), String(data.asset_code), id || "");
}
function orderFor(w, id) {
  return db
    .prepare(
      "SELECT * FROM records WHERE workspace_id=? AND id=? AND type='order' AND deleted_at IS NULL",
    )
    .get(w, id);
}
function validateData(r) {
  if (!r || typeof r.data !== "object" || Array.isArray(r.data) || !types.has(r.type)) return "INVALID_RECORD";
  if (r.type === "device" && (!String(r.data.name || "").trim() || !String(r.data.asset_code || "").trim())) return "INVALID_DEVICE";
  if (r.type === "part" && ["quantity", "min_quantity", "purchase_price"].some(k => r.data[k] !== undefined && (!Number.isFinite(Number(r.data[k])) || Number(r.data[k]) < 0))) return "INVALID_STOCK";
  if (r.type === "usage" && (!Number.isFinite(Number(r.data.quantity)) || Number(r.data.quantity) <= 0 || !r.data.order_id || !r.data.part_id)) return "INVALID_USAGE";
  if (r.type === "calibration" && (!r.data.device_id || !String(r.data.reference || "").trim() || !String(r.data.result || "").trim() || !Number.isFinite(Date.parse(r.data.performed_at)) || (r.data.next_due !== undefined && r.data.next_due !== null && !Number.isFinite(Date.parse(r.data.next_due))))) return "INVALID_CALIBRATION";
  if (["sale", "purchase"].includes(r.type)) { if (!String(r.data.title || "").trim() || !String(r.data.currency || "").trim()) return "INVALID_BUSINESS_RECORD"; if (r.data.quantity !== undefined && (!Number.isFinite(Number(r.data.quantity)) || Number(r.data.quantity) <= 0)) return "INVALID_BUSINESS_ITEM"; if (r.data.price !== undefined && (!Number.isFinite(Number(r.data.price)) || Number(r.data.price) < 0)) return "INVALID_BUSINESS_ITEM"; for (const item of (Array.isArray(r.data.items) ? r.data.items : [])) if (!Number.isFinite(Number(item?.qty ?? item?.quantity)) || Number(item.qty ?? item.quantity) <= 0 || !Number.isFinite(Number(item?.unit_price ?? item?.price)) || Number(item.unit_price ?? item.price) < 0) return "INVALID_BUSINESS_ITEM"; }
  return null;
}
function authorize(op, m, ex) {
 if(ex?.type==="usage"&&op.action!=="create")return "USAGE_IMMUTABLE";
 if(op.action==="create"&&ex)return "ID_EXISTS";
  const r = op.record || {};
  if (m.role === "viewer") return "ROLE_FORBIDDEN";
  if (["sale", "purchase"].includes(r.type) && !["owner", "admin"].includes(m.role)) return "ROLE_FORBIDDEN";
  if (["device", "part", "plan"].includes(r.type) && m.role === "technician")
    return "ROLE_FORBIDDEN";
  if (op.action === "delete" && m.role === "technician")
    return "ROLE_FORBIDDEN";
  if (
    r.type === "calibration" &&
    m.role === "technician" &&
    op.action !== "create" &&
    ex?.created_by !== m.user_id
  )
    return "NOT_OWNER";
  if (ex?.type && ex.type !== r.type) return "TYPE_IMMUTABLE";
  if (ex?.deleted_at) return "RECORD_DELETED";
  if (ex?.type === "order" && parse(ex.data)?.status === "closed")
    return "ORDER_CLOSED";
  if (r.type === "order") {
    const d = r.data || {};
    if(m.role==="technician"&&ex&&parse(ex.data)?.assigned_to!==m.user_id)return "NOT_ASSIGNED";
    if(["closed","pending_approval"].includes(d.status)&&!String(d.tests||" ").trim())return "TEST_RESULTS_REQUIRED";
    if (
      m.role === "technician" &&
      op.action !== "create" &&
      d.assigned_to !== m.user_id
    )
      return "NOT_ASSIGNED";
    if (
      m.role === "technician" &&
      op.action === "create" &&
      d.assigned_to &&
      d.assigned_to !== m.user_id
    )
      return "NOT_ASSIGNED";
    if (
      d.status === "pending_approval" &&
      (!Array.isArray(d.checklist) ||
        d.checklist.length < 4 ||
        d.checklist.some(
          (x) => !x.checked || !x.confirmed_by || !x.confirmed_at,
        ))
    )
      return "CHECKLIST_INCOMPLETE";
    if (d.status === "closed") {
      if (
        m.role === "technician" ||
        (op.action === "update" &&
          parse(ex?.data)?.status !== "pending_approval")
      )
        return "CLOSE_FORBIDDEN";
      if (
        !Array.isArray(d.checklist) ||
        d.checklist.length < 4 ||
        d.checklist.some(
          (x) => !x.checked || !x.confirmed_by || !x.confirmed_at,
        )
      )
        return "CHECKLIST_INCOMPLETE";
      if (!d.approved_by || d.approved_by !== m.user_id || !d.approved_at)
        return "APPROVAL_REQUIRED";
    }
  }
  return null;
}
function findRecord(id) {
  return db.prepare("SELECT * FROM records WHERE id=?").get(id);
}
function normalizeRecord(op, existing) {
  const r=op.record||{}, expected=recordCode(r.type,r.id); if(!expected) return "INVALID_RECORD";
  const supplied=r.data && typeof r.data === "object" ? r.data.record_code : undefined;
  if(supplied !== undefined && String(supplied).toUpperCase() !== expected.toUpperCase()) return "INVALID_CODE";
  const old=existing ? parse(existing.data) || {} : {}; r.data={...(r.data||{}),record_code:old.record_code||expected};
  if(old.record_code && r.data.record_code !== old.record_code) return "INVALID_CODE";
  if(["sale","purchase"].includes(r.type) && Array.isArray(r.data.items)) r.data.total=r.data.items.reduce((sum,item)=>sum+Number(item.qty ?? item.quantity)*Number(item.unit_price ?? item.price),0);
  return null;
}
function sameDomainReferences(r, workspaceId) {
  const d = normalizeDomain(r.domain), data = r.data || {};
  const ids = [data.device_id, data.order_id, data.part_id, data.entity_id].filter(Boolean);
  for (const id of ids) {
    const target = db.prepare("SELECT * FROM records WHERE workspace_id=? AND id=? AND deleted_at IS NULL").get(workspaceId, String(id));
    if (!target || normalizeDomain(target.domain) !== d) return false;
    if (["attachment", "comment"].includes(r.type) && data.entity_type && target.type !== data.entity_type) return false;
  }
  return true;
}
function applyOp(op, m, ex, skipStock = false) {
  const r = op.record,
    t = now();
  r.domain = normalizeDomain(r.domain);
  if (!sameDomainReferences(r, m.workspace_id)) return "CROSS_DOMAIN_REFERENCE";
  if (op.action === "create") {
    if (ex) return "ID_EXISTS";
    if (r.workspace_id && r.workspace_id !== m.workspace_id)
      return "WORKSPACE_MISMATCH";
    if (r.created_by && r.created_by !== m.user_id && m.role === "technician")
      return "CREATOR_MISMATCH";
    if (assetConflict(m.workspace_id, r.data, r.id, r.domain)) return "ASSET_CODE_EXISTS";
    const row = recordRow(r, m.workspace_id, t, m.user_id);
    db.prepare("INSERT INTO records VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      row.id,
      m.workspace_id,
      row.created_at,
      t,
      null,
      row.created_by,
      row.domain,
      row.type,
      safeJson(row.data),
      1,
    );
    audit(m.workspace_id, m.user_id, op, null, row);
    return null;
  }
  if (!ex) return "NOT_FOUND";
  const base = Number(op.base_version);
  if (
    !Number.isInteger(base) ||
    base !== ex.version ||
    Number(r.version) !== ex.version + 1
  )
    return "VERSION_CONFLICT";
  if (op.action === "update") {
    if (normalizeDomain(ex.domain) !== r.domain) return "DOMAIN_IMMUTABLE";
    op._auditDomain = normalizeDomain(ex.domain);
    if (assetConflict(m.workspace_id, r.data, r.id, r.domain)) return "ASSET_CODE_EXISTS";
    db.prepare(
      "UPDATE records SET updated_at=?,deleted_at=?,data=?,version=? WHERE id=? AND workspace_id=?",
    ).run(
      t,
      r.deleted_at || null,
      safeJson(r.data),
      r.version,
      r.id,
      m.workspace_id,
    );
    audit(m.workspace_id, m.user_id, op, { ...ex, data: parse(ex.data) }, r);
    return null;
  }
  if (op.action === "delete") {
    op._auditDomain = normalizeDomain(ex.domain);
    db.prepare(
      "UPDATE records SET updated_at=?,deleted_at=?,version=? WHERE id=? AND workspace_id=?",
    ).run(t, t, r.version, r.id, m.workspace_id);
    audit(m.workspace_id, m.user_id, op, { ...ex, data: parse(ex.data) }, null);
    return null;
  }
  return "INVALID_ACTION";
}
function stockPair(ops, i, m) {
  const u = ops[i],
    r = u.record,
    d = r?.data || {};
  if (u.action !== "create" || r.type !== "usage") return null;
  if (d.historical === true) {
    if (!['owner', 'admin'].includes(m.role)) return 'ROLE_FORBIDDEN';
    const histOrder = orderFor(m.workspace_id, d.order_id);
    const histPart = db.prepare("SELECT * FROM records WHERE workspace_id=? AND id=? AND type='part' AND deleted_at IS NULL").get(m.workspace_id, d.part_id);
    if (!histOrder || !histPart || normalizeDomain(histOrder.domain) !== normalizeDomain(r.domain) || normalizeDomain(histPart.domain) !== normalizeDomain(r.domain)) return 'INVALID_REFERENCE';
    return null;
  }
  const p = ops[i + 1],
    pr = p?.record;
  if (!p || p.action !== "update" || pr.type !== "part" || pr.id !== d.part_id)
    return "MISSING_STOCK_PAIR";
  const part = db
      .prepare(
        "SELECT * FROM records WHERE workspace_id=? AND id=? AND type='part' AND deleted_at IS NULL",
      )
      .get(m.workspace_id, d.part_id),
    ord = orderFor(m.workspace_id, d.order_id);
  if (!part || !ord) return "INVALID_REFERENCE";
  const od = parse(ord.data) || {};
  if(["closed","pending_approval"].includes(od.status))return "ORDER_CLOSED";
  if(pr.workspace_id&&pr.workspace_id!==m.workspace_id)return "WORKSPACE_MISMATCH";
  if(validateData(pr))return "INVALID_STOCK";
  if (m.role === "technician" && od.assigned_to !== m.user_id)
    return "NOT_ASSIGNED";
  const old = parse(part.data) || {};
  if(m.role==="technician"){const a={...old},b={...pr.data};delete a.quantity;delete b.quantity;if(safeJson(a)!==safeJson(b))return "ROLE_FORBIDDEN";}
  const
    q = Number(d.quantity),
    oldq = Number(old.quantity),
    proposed = Number(pr.data?.quantity);
  if (
    !Number.isFinite(q) ||
    q <= 0 ||
    !Number.isFinite(oldq) ||
    oldq < q ||
    proposed !== oldq - q ||
    p.base_version !== part.version ||
    pr.version !== part.version + 1
  )
    return "STOCK_CONFLICT";
  return null;
}
app.get("/api/config", (_, res) =>
  res.json({ googleClientId: cfg.google || null }),
);
app.get("/health", (_, res) => res.json({ ok: true }));
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    if (
      !validEmail(email) ||
      typeof password !== "string" ||
      password.length < 8 ||
      password.length > 200
    )
      return res.status(400).json({ code: "INVALID_INPUT" });
    const x = createUser({ email, name, password }),
      t = await makeToken(x.u);
    res.status(201).json(authDto(x.u, x.w, x.m, t));
  } catch {
    return res.status(409).json({ code: "EMAIL_EXISTS" });
  }
});
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {},
    u = db.prepare("SELECT * FROM users WHERE email=?").get(
      String(email || "")
        .trim()
        .toLowerCase(),
    );
  if (!u || !passwordOk(String(password || ""), u.password_hash))
    return res.status(401).json({ code: "INVALID_CREDENTIALS" });
  const m = db
    .prepare(
      "SELECT * FROM memberships WHERE user_id=? AND status='active' ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END LIMIT 1",
    )
    .get(u.id);
  if (!m) return res.status(403).json({ code: "MEMBERSHIP_INACTIVE" });
  const w = db
    .prepare("SELECT * FROM workspaces WHERE id=?")
    .get(m.workspace_id);
  if (w.revoked) return res.status(403).json({ code: "WORKSPACE_REVOKED" });
  res.json(authDto(u, w, m, await makeToken(u)));
});
app.post("/api/auth/google", async (req, res) => {
  try {
    if (!cfg.google)
      return res.status(503).json({ code: "GOOGLE_NOT_CONFIGURED" });
    const p = (
      await new OAuth2Client(cfg.google).verifyIdToken({
        idToken: req.body?.credential,
        audience: cfg.google,
      })
    ).getPayload();
    if (!p?.sub || !validEmail(p.email) || p.email_verified !== true) throw Error();
    let u = db.prepare("SELECT * FROM users WHERE google_sub=?").get(p.sub),
      x;
    if (!u) x = createUser({ email: p.email, name: p.name, google_sub: p.sub });
    else {
      x = {
        u,
        m: db.prepare("SELECT * FROM memberships WHERE user_id=? AND status='active' ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END LIMIT 1").get(u.id),
        w: null,
      };
    }
    if (!x.m) return res.status(403).json({ code: "MEMBERSHIP_INACTIVE" });
    x.w = db.prepare("SELECT * FROM workspaces WHERE id=?").get(x.m.workspace_id);
    if (!x.w || x.w.revoked) return res.status(403).json({ code: "WORKSPACE_REVOKED" });
    res.json(authDto(x.u, x.w, x.m, await makeToken(x.u)));
  } catch {
    res.status(401).json({ code: "INVALID_GOOGLE_TOKEN" });
  }
});
app.get("/api/sections", auth, (req, res) => {
  const m = ws(req, res, req.query.workspace_id); if (!m?.workspace_id) return m;
  return res.json({ sections: workspaceSections(m.workspace_id) });
});
app.put("/api/sections/:id", auth, (req, res) => {
  const id = String(req.params.id || ""), body = req.body || {}, m = ws(req, res, body.workspace_id, ["owner"]);
  if (!m?.workspace_id) return m;
  if (!domainIds.has(id) && !isCustomId(id)) return res.status(400).json({code:"INVALID_SECTION_ID"});
  const existing = db.prepare("SELECT * FROM section_definitions WHERE workspace_id=? AND id=?").get(m.workspace_id,id), input = sectionInput(body, existing);
  if (input.code) return res.status(400).json(input);
  if (id === "medical") input.archived = false;
  const duplicate = workspaceSections(m.workspace_id).find(x => x.id !== id && x.label.trim().toLocaleLowerCase() === input.label.toLocaleLowerCase());
  if (duplicate) return res.status(409).json({code:"DUPLICATE_SECTION_LABEL"});
  const t=now(); db.prepare(`INSERT INTO section_definitions(id,workspace_id,label,labelEn,description,archived,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,id) DO UPDATE SET label=excluded.label,labelEn=excluded.labelEn,description=excluded.description,archived=excluded.archived,updated_at=excluded.updated_at`).run(id,m.workspace_id,input.label,input.labelEn,input.description,input.archived?1:0,m.user_id,existing?.created_at||t,t);
  audit(m.workspace_id,m.user_id,{action:existing?"section_updated":"section_created",_auditDomain:id,entity_type:"section_definition",entity_id:id},existing?sectionDto(existing):null,{id,...input});
  return res.json({section:workspaceSections(m.workspace_id).find(x=>x.id===id)});
});
app.get("/api/me", auth, (req, res) => {
  const u = db
    .prepare("SELECT id,name,email,virtual_number FROM users WHERE id=?")
    .get(req.user.sub);
  const wid = req.query.workspace_id;
  const m = wid
    ? member(req.user.sub, wid)
    : db
        .prepare(
          "SELECT * FROM memberships WHERE user_id=? ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END LIMIT 1",
        )
        .get(req.user.sub);
  if (!u || !m) return res.status(404).json({ code: "NOT_FOUND" });
  const w = db
    .prepare("SELECT * FROM workspaces WHERE id=?")
    .get(m.workspace_id);
  if (w.revoked) return res.status(403).json({ code: "WORKSPACE_REVOKED" });
  if (m.status !== "active")
    return res.status(403).json({ code: "MEMBERSHIP_INACTIVE" });
  res.json(authDto(u, w, m, undefined));
});
app.post("/api/sync", auth, (req, res) => {
  const { workspace_id, operations = [], since = 0 } = req.body || {},
    m = ws(req, res, workspace_id);
  if (!m?.workspace_id) return m;
  if (!Array.isArray(operations) || operations.length > 500)
    return res.status(400).json({ code: "INVALID_EVENTS" });
  const accepted = [],
    rejected = [];
  try {
    db.transaction(() => {
      for (let i = 0; i < operations.length; i++) {
        const op = operations[i],
          oid = String(op?.id || "");
        if (!oid || oid.length > 200) {
          rejected.push({ id: oid, reason: "INVALID_OPERATION" });
          continue;
        }
        if (
          db
            .prepare("SELECT 1 FROM ops WHERE id=? AND workspace_id=?")
            .get(oid, workspace_id)
        ) {
          accepted.push(oid);
          continue;
        }
        const r = op.record || {},
          existing = findRecord(r.id);
        if (!registeredDomain(workspace_id, r.domain)) { rejected.push({ id: oid, reason: "INVALID_DOMAIN" }); continue; }
        r.domain = r.domain;
        const codeReason = normalizeRecord(op, existing),
          basic = codeReason || validateData(r);
        let reason = basic || authorize(op, m, existing);
      if(!reason&&["order","plan","calibration"].includes(r.type)&&!db.prepare("SELECT 1 FROM records WHERE workspace_id=? AND id=? AND type='device' AND deleted_at IS NULL").get(workspace_id,r.data.device_id))reason="INVALID_REFERENCE";
        if (
          !reason &&
          r.type === "calibration" &&
          !db
            .prepare(
              "SELECT 1 FROM records WHERE workspace_id=? AND id=? AND type='device' AND deleted_at IS NULL",
            )
            .get(workspace_id, r.data.device_id)
        )
          reason = "INVALID_REFERENCE";
        if (
          !reason &&
          op.action === "create" &&
          r.created_by &&
          r.created_by !== m.user_id &&
          m.role !== "owner" &&
          m.role !== "admin"
        )
          reason = "CREATOR_MISMATCH";
        if (
          !reason &&
          op.action !== "create" &&
          (!existing || existing.workspace_id !== workspace_id)
        )
          reason = "NOT_FOUND";
        if (
          !reason &&
          op.action !== "create" &&
          existing.workspace_id !== workspace_id
        )
          reason = "FORBIDDEN";
        let pairReason = null;
        if (!reason && r.type === "usage" && op.action === "create")
          pairReason = stockPair(operations, i, m);
        if (pairReason) reason = pairReason;
        if (reason) {
          rejected.push({ id: oid, reason });
          if (pairReason && operations[i + 1]?.id)
            rejected.push({ id: operations[i + 1].id, reason: pairReason });
          if (pairReason) i++;
          continue;
        }
        if (
          r.type === "usage" &&
          op.action === "create" &&
          !r.data.historical
        ) {
          const stockFailure=applyOp(operations[i + 1], m, findRecord(r.data.part_id));if(stockFailure)throw Error(stockFailure);
          db.prepare("INSERT INTO ops VALUES (?,?,?)").run(
            operations[i + 1].id,
            workspace_id,
            now(),
          );
          accepted.push(operations[i + 1].id);
          i++;
        }
        const failure = applyOp(op, m, existing);
        if (failure) {
          rejected.push({ id: oid, reason: failure });
          continue;
        }
        db.prepare("INSERT INTO ops VALUES (?,?,?)").run(
          oid,
          workspace_id,
          now(),
        );
        accepted.push(oid);
      }
    })();
  } catch (e) {
    return res
      .status(400)
      .json({
        code: "OPERATION_REJECTED",
        message: "One or more operations were rejected safely",
      });
  }
  const cut = new Date(Math.max(0,(Number(since)||0)-1)).toISOString(),
    rows = db
      .prepare(
        "SELECT * FROM records WHERE workspace_id=? AND (updated_at>? OR deleted_at>?) ORDER BY updated_at,id",
      )
      .all(workspace_id, cut, cut)
      .map((x) => ({ ...x, data: parse(x.data) })),
    aud = db
      .prepare(
        "SELECT * FROM audit WHERE workspace_id=? AND created_at>? ORDER BY created_at,id",
      )
      .all(workspace_id, cut)
      .map((x) => ({ ...x, before: parse(x.before), after: parse(x.after) }));
  res.json({
    accepted,
    rejected,
    records: rows,
    audit: aud,
    cursor: Date.now(),
  });
});
app.post("/api/activity", auth, (req, res) => {
  const { workspace_id, events = [] } = req.body || {},
    m = ws(req, res, workspace_id);
  if (!m?.workspace_id) return m;
  if (!Array.isArray(events) || events.length > 500)
    return res.status(400).json({ code: "INVALID_EVENTS" });
  const accepted = [];
  try {
    db.transaction(() => {
      for (const ev of events) {
        const idv = String(ev?.id || "");
        if (
          !idv ||
          db
            .prepare("SELECT 1 FROM ops WHERE id=? AND workspace_id=?")
            .get(idv, workspace_id)
        ) {
          if (idv) accepted.push(idv);
          continue;
        }
        audit(
          workspace_id,
          m.user_id,
          {
            ...ev,
            id: idv,
            action: String(ev.action || "event"),
            record: {
              id: String(ev.entity_id || idv),
              type: String(ev.entity_type || "activity"),
              domain: String(ev.domain || "activity"),
            },
          },
          ev.before ?? null,
          ev.after ?? ev.data ?? null,
        );
        db.prepare("INSERT INTO ops VALUES (?,?,?)").run(
          idv,
          workspace_id,
          now(),
        );
        accepted.push(idv);
      }
    })();
  } catch {
    return res.status(400).json({ code: "ACTIVITY_REJECTED" });
  }
  res.json({ accepted });
});
app.get("/api/team", auth, (req, res) => {
  const m = ws(req, res, req.query.workspace_id);
  if (!m?.workspace_id) return m;
  res.json({
    members: db
      .prepare(
        "SELECT m.id,m.user_id,m.role,m.status,u.name,u.email,u.virtual_number FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=?",
      )
      .all(m.workspace_id),
  });
});
const chatExtensions = new Set(["pdf","doc","docx","xls","xlsx","ppt","pptx","txt","csv","zip","png","jpg","jpeg","gif","webp","heic","odt","ods","mp4","m4a","webm","ogg","wav"]);
const chatMime = new Set(["application/pdf","text/plain","text/csv","application/zip","image/png","image/jpeg","image/gif","image/webp","image/heic","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-powerpoint","application/vnd.openxmlformats-officedocument.presentationml.presentation","application/vnd.oasis.opendocument.text","application/vnd.oasis.opendocument.spreadsheet","audio/mp4","audio/webm","audio/ogg","audio/wav","audio/x-wav"]);
function chatFile(input) {
  if (!input || typeof input !== "object" || typeof input.name !== "string" || typeof input.mime !== "string" || typeof input.content !== "string") return { code: "INVALID_FILE" };
  const name = path.basename(input.name).replace(/[\\\x00-\x1f\x7f]/g, "_").slice(0, 120), ext = name.toLowerCase().split(".").pop();
  const mime = input.mime.trim().toLowerCase().replace(/\s*;\s*/g, ";").replace(/\s*=\s*/g, "=");
  const baseMime = mime.split(";")[0];
  const validMime = /^[a-z0-9!#$&^_.+\-]+\/[a-z0-9!#$&^_.+\-]+(?:;codecs=(?:"[a-z0-9., _\-]+"|[a-z0-9.,_\-]+))?$/.test(mime);
  if (!name || !validMime || !chatExtensions.has(ext) || !chatMime.has(baseMime) || (mime.includes(";") && !baseMime.startsWith("audio/")) || /(?:html?|xhtml|exe|apk|js)$/i.test(ext)) return { code: "FILE_TYPE_FORBIDDEN" };
  const match = /^data:([^,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(input.content);
  if (!match || match[1].toLowerCase().replace(/\s*;\s*/g, ";").replace(/\s*=\s*/g, "=") !== mime || match[2].length % 4 === 1) return { code: "INVALID_FILE" };
  const buf = Buffer.from(match[2], "base64");
  if (buf.length > 10 * 1024 * 1024 || !Number.isInteger(input.size) || input.size !== buf.length) return { code: "FILE_TOO_LARGE" };
  return { name, mime, size: buf.length, content: input.content };
}
function chatDto(r, file) { return { id:r.id, seq:Number(r.seq), workspace_id:r.workspace_id, sender_id:r.sender_id, sender_name:r.sender_name, virtual_number:r.virtual_number, text:r.text, created_at:r.created_at, domain:normalizeDomain(r.domain), ...(file ? {file:{id:file.id,name:file.name,mime:file.mime,size:file.size}} : {}) }; }
app.get("/api/chat", auth, (req, res) => {
  const m = ws(req, res, req.query.workspace_id); if (!m?.workspace_id) return m;
  const after = Number(req.query.after || 0); if (!Number.isInteger(after) || after < 0) return res.status(400).json({code:"INVALID_CURSOR"});
  const domain = req.query.domain === undefined ? "medical" : String(req.query.domain);
  if (!registeredDomain(m.workspace_id, domain)) return res.status(400).json({code:"INVALID_DOMAIN"});
  const rows = db.prepare("SELECT x.*,u.name sender_name,u.virtual_number FROM messages x JOIN users u ON u.id=x.sender_id WHERE x.workspace_id=? AND x.seq>? AND COALESCE(x.domain,'medical')=? ORDER BY x.seq ASC LIMIT 101").all(m.workspace_id, after, domain);
  const more = rows.length > 100, shown = rows.slice(0,100), cursor = shown.length ? Number(shown[shown.length-1].seq) : after;
  const files = shown.length ? db.prepare("SELECT id,message_id,name,mime,size FROM chat_files WHERE workspace_id=? AND message_id IN (SELECT id FROM messages WHERE workspace_id=? AND seq>?)").all(m.workspace_id,m.workspace_id,after) : [];
  const by = new Map(files.map(f=>[f.message_id,f])); res.json({messages:shown.map(r=>chatDto(r,by.get(r.id))),cursor,more});
});
app.post("/api/chat/messages", auth, (req, res) => {
  const body=req.body||{}, m=ws(req,res,body.workspace_id,["owner","admin","technician"]); if(!m?.workspace_id) return m;
  const domain = body.domain === undefined ? "medical" : String(body.domain);
  if (!registeredDomain(m.workspace_id, domain)) return res.status(400).json({code:"INVALID_DOMAIN"});
  if(typeof body.client_id!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.client_id)) return res.status(400).json({code:"INVALID_CLIENT_ID"});
  const text=typeof body.text==="string"?body.text:"", file=body.file?chatFile(body.file):null; if(text.length>8000) return res.status(400).json({code:"TEXT_TOO_LONG"}); if(file?.code) return res.status(400).json(file); if(!text.trim()&&!file) return res.status(400).json({code:"MESSAGE_REQUIRED"});
  const old=db.prepare("SELECT x.*,u.name sender_name,u.virtual_number FROM messages x JOIN users u ON u.id=x.sender_id WHERE x.workspace_id=? AND x.client_id=?").get(m.workspace_id,body.client_id); if(old){if(normalizeDomain(old.domain)!==domain) return res.status(409).json({code:"CLIENT_ID_DOMAIN_CONFLICT"}); if(old.sender_id!==m.user_id)return res.status(409).json({code:"CLIENT_ID_CONFLICT"}); const f=db.prepare("SELECT id,name,mime,size FROM chat_files WHERE message_id=?").get(old.id); return res.json({message:chatDto(old,f)});}
  const row={id:uid(),workspace_id:m.workspace_id,sender_id:m.user_id,text,created_at:now(),client_id:body.client_id,domain};
  try { db.transaction(()=>{db.prepare("INSERT INTO messages(id,workspace_id,sender_id,text,created_at,client_id,domain) VALUES (?,?,?,?,?,?,?)").run(row.id,row.workspace_id,row.sender_id,row.text,row.created_at,row.client_id,row.domain); if(file) db.prepare("INSERT INTO chat_files VALUES (?,?,?,?,?,?,?)").run(uid(),m.workspace_id,row.id,file.name,file.mime,file.size,file.content); audit(m.workspace_id,m.user_id,{action:"chat_message_sent",record:{id:row.id,type:"chat_message",domain:"chat"}},null,{text_length:text.length,file:file?{name:file.name,mime:file.mime,size:file.size}:null}); if(file) audit(m.workspace_id,m.user_id,{action:"file_uploaded",record:{id:row.id,type:"chat_file",domain:"chat"}},null,{name:file.name,mime:file.mime,size:file.size}); })(); } catch(e){if(String(e).includes("UNIQUE")) return res.status(409).json({code:"CLIENT_ID_CONFLICT"}); throw e;}
  const saved=db.prepare("SELECT x.*,u.name sender_name,u.virtual_number FROM messages x JOIN users u ON u.id=x.sender_id WHERE x.id=?").get(row.id), f=db.prepare("SELECT id,name,mime,size FROM chat_files WHERE message_id=?").get(row.id); res.status(201).json({message:chatDto(saved,f)});
});
app.get("/api/chat/files/:id", auth, (req,res) => { const m=ws(req,res,req.query.workspace_id); if(!m?.workspace_id)return m; const fileDomain=req.query.domain === undefined ? "medical" : String(req.query.domain); if(!registeredDomain(m.workspace_id,fileDomain)) return res.status(400).json({code:"INVALID_DOMAIN"}); const f=db.prepare("SELECT f.id,f.name,f.mime,f.size,f.content,m.domain FROM chat_files f JOIN messages m ON m.id=f.message_id WHERE f.id=? AND f.workspace_id=? AND COALESCE(m.domain,'medical')=?").get(req.params.id,m.workspace_id,fileDomain); if(!f)return res.status(404).json({code:"NOT_FOUND"}); audit(m.workspace_id,m.user_id,{action:"file_downloaded",record:{id:f.id,type:"chat_file",domain:"chat"}},null,{name:f.name,mime:f.mime,size:f.size}); res.json(f); });
app.post("/api/invitations", auth, (req, res) => {
  const {
      workspace_id,
      email,
      role = "technician",
      expires_days = 7,
    } = req.body || {},
    m = ws(req, res, workspace_id, ["owner", "admin"]);
  if (!m?.workspace_id) return m;
  if (m.role === "admin" && role === "admin")
    return res.status(403).json({ code: "ADMIN_INVITE_FORBIDDEN" });
  if (
    !validEmail(email) ||
    !["admin", "technician", "viewer"].includes(role) ||
    !Number.isFinite(Number(expires_days)) ||
    expires_days <= 0 ||
    expires_days > 30
  )
    return res.status(400).json({ code: "INVALID_INPUT" });
  const exp = new Date(Date.now() + Number(expires_days) * 864e5).toISOString(),
    code = crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO invitations VALUES (?,?,?,?,?,NULL)").run(
    code,
    workspace_id,
    email.trim().toLowerCase(),
    role,
    exp,
  );
  audit(
    workspace_id,
    m.user_id,
    {
      action: "invite",
      record: { id: code, type: "invitation", domain: "team" },
    },
    null,
    { email: email.trim().toLowerCase(), role, expires_at: exp },
  );
  res
    .status(201)
    .json({
      code,
      workspace_id,
      email: email.trim().toLowerCase(),
      role,
      expires_at: exp,
    });
});
app.get("/api/invitations", auth, (req, res) => {
  const m = ws(req, res, req.query.workspace_id);
  if (!m?.workspace_id) return m;
  res.json({
    invitations: db
      .prepare(
        "SELECT code,workspace_id,email,role,expires_at,used_at FROM invitations WHERE workspace_id=? ORDER BY expires_at DESC",
      )
      .all(m.workspace_id),
  });
});
app.delete("/api/invitations/:code", auth, (req, res) => {
  const m = ws(req, res, req.query.workspace_id, ["owner", "admin"]);
  if (!m?.workspace_id) return m;
  const x = db
    .prepare("SELECT * FROM invitations WHERE code=? AND workspace_id=?")
    .get(req.params.code, m.workspace_id);
  if (!x) return res.status(404).json({ code: "NOT_FOUND" });
  db.prepare("DELETE FROM invitations WHERE code=?").run(x.code);
  audit(
    m.workspace_id,
    m.user_id,
    {
      action: "invite_cancel",
      record: { id: x.code, type: "invitation", domain: "team" },
    },
    x,
    null,
  );
  res.json({ ok: true });
});
app.post("/api/invitations/accept", auth, (req, res) => {
  try {
    const i = db
        .prepare("SELECT * FROM invitations WHERE code=? AND used_at IS NULL")
        .get(req.body?.code),
      u = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.sub);
    if (!i || !u || new Date(i.expires_at) <= new Date() || i.email !== u.email)
      return res.status(400).json({ code: "INVITATION_INVALID" });
    if(member(u.id,i.workspace_id))return res.status(409).json({code:"ALREADY_MEMBER"});
    const w = db
      .prepare("SELECT id,name,owner_id,revoked FROM workspaces WHERE id=?")
      .get(i.workspace_id);
    if (w.revoked) return res.status(403).json({ code: "WORKSPACE_REVOKED" });
    const x = {
      id: uid(),
      workspace_id: i.workspace_id,
      user_id: u.id,
      role: i.role,
      status: "active",
    };
    const out = db.transaction(() => {
      db.prepare(
        "INSERT INTO memberships VALUES (?,?,?,?,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role,status='active'",
      ).run(x.id, x.workspace_id, x.user_id, x.role, x.status);
      db.prepare(
        "UPDATE invitations SET used_at=? WHERE code=? AND used_at IS NULL",
      ).run(now(), i.code);
      audit(
        i.workspace_id,
        u.id,
        {
          action: "invite_accept",
          record: { id: i.code, type: "invitation", domain: "team" },
        },
        null,
        x,
      );
      return db
        .prepare("SELECT * FROM memberships WHERE workspace_id=? AND user_id=?")
        .get(i.workspace_id, u.id);
    })();
    res.json({
      workspace: { id: w.id, name: w.name, owner_id: w.owner_id },
      membership: out,
      user: { id: u.id, name: u.name, email: u.email },
    });
  } catch {
    return res.status(400).json({ code: "INVITATION_INVALID" });
  }
});
app.patch("/api/members/:id",auth,(req,res)=>{
const x=db.prepare('SELECT * FROM memberships WHERE id=?').get(req.params.id);if(!x)return res.status(404).json({code:'NOT_FOUND'});
const me=ws(req,res,x.workspace_id,['owner','admin']);if(!me?.workspace_id)return me;
if(x.role==='owner'||(me.role==='admin'&&(x.role==='admin'||x.user_id===me.user_id)))return res.status(403).json({code:'ROLE_FORBIDDEN'});
const {role,status}=req.body||{};if(role===undefined&&status===undefined)return res.status(400).json({code:'INVALID_INPUT'});
if(role!==undefined&&(!['admin','technician','viewer'].includes(role)||(me.role==='admin'&&role==='admin')))return res.status(403).json({code:'ROLE_FORBIDDEN'});
if(status!==undefined&&!['active','suspended'].includes(status))return res.status(400).json({code:'INVALID_STATUS'});
db.transaction(()=>{db.prepare('UPDATE memberships SET role=COALESCE(?,role),status=COALESCE(?,status) WHERE id=?').run(role??null,status??null,x.id);if(status==='suspended'){const email=db.prepare('SELECT email FROM users WHERE id=?').get(x.user_id).email;db.prepare('DELETE FROM invitations WHERE workspace_id=? AND email=? AND used_at IS NULL').run(x.workspace_id,email);}audit(x.workspace_id,me.user_id,{action:'member_updated',record:{id:x.id,type:'membership',domain:'team'}},{role:x.role,status:x.status},{role:role??x.role,status:status??x.status});})();
res.json(db.prepare('SELECT * FROM memberships WHERE id=?').get(x.id));});
app.post("/api/workspace/transfer", auth, (req, res) => {
  const { workspace_id, member_id } = req.body || {},
    m = ws(req, res, workspace_id, ["owner"]);
  if (!m?.workspace_id) return m;
  const n = db
    .prepare(
      "SELECT * FROM memberships WHERE id=? AND workspace_id=? AND role='admin' AND status='active'",
    )
    .get(member_id, workspace_id);
  if (!n) return res.status(400).json({ code: "TRANSFER_TARGET_INVALID" });
  db.transaction(() => {
    db.prepare(
      "UPDATE memberships SET role='admin' WHERE workspace_id=? AND role='owner'",
    ).run(workspace_id);
    db.prepare("UPDATE memberships SET role='owner' WHERE id=?").run(n.id);
    db.prepare("UPDATE workspaces SET owner_id=? WHERE id=?").run(
      n.user_id,
      workspace_id,
    );
    audit(
      workspace_id,
      m.user_id,
      {
        action: "workspace_transfer",
        record: { id: workspace_id, type: "workspace", domain: "team" },
      },
      null,
      { owner_id: n.user_id },
    );
  })();
  res.json({ ok: true });
});
app.post("/api/backups", auth, (req, res) => {
  const { workspace_id, encrypted } = req.body || {},
    m = ws(req, res, workspace_id, ["owner", "admin"]);
  if (!m?.workspace_id) return m;
  if (
    typeof encrypted !== "string" ||
    !encrypted ||
    encrypted.length > 150 * 1024 * 1024
  )
    return res.status(400).json({ code: "INVALID_BACKUP" });
  const t = now();
  db.prepare(
    "INSERT INTO backups VALUES (?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET encrypted=excluded.encrypted,updated_at=excluded.updated_at",
  ).run(workspace_id, encrypted, t);
  fs.mkdirSync(path.resolve(cfg.backup), { recursive: true });
  fs.writeFileSync(
    path.join(path.resolve(cfg.backup, `${workspace_id}.json`)),
    safeJson({ workspace_id, encrypted, updated_at: t }),
    { mode: 0o600 },
  );
  audit(
    workspace_id,
    m.user_id,
    {
      action: "backup_write",
      record: { id: workspace_id, type: "backup", domain: "backup" },
    },
    null,
    { updated_at: t },
  );
  res.json({ ok: true, updated_at: t });
});
app.get("/api/backups/latest", auth, (req, res) => {
  const m = ws(req, res, req.query.workspace_id, ["owner", "admin"]);
  if (!m?.workspace_id) return m;
  const b = db
    .prepare(
      "SELECT workspace_id,encrypted,updated_at FROM backups WHERE workspace_id=?",
    )
    .get(m.workspace_id);
  if (!b) return res.status(404).json({ code: "NOT_FOUND" });
  res.json({
    encrypted: b.encrypted,
    workspace_id: b.workspace_id,
    updated_at: b.updated_at,
  });
});
app.use((e, req, res, next) => {
  if (res.headersSent) return next(e);
  res.status(400).json({ code: "BAD_REQUEST" });
});
if (process.env.NODE_ENV !== "test")
  app.listen(cfg.port, "0.0.0.0", () =>
    console.log(`EngX server listening on ${cfg.port}`),
  );
export { app, db };
