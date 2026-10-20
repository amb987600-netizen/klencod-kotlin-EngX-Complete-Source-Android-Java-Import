import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import express from "express";
import rateLimit from "express-rate-limit";

const ROLES = new Set(["primary", "assistant"]);
const DOMAINS = new Set(["medical", "mobiles", "appliances", "screens", "electronics", "workshops", "sales"]);
const CUSTOM_DOMAIN = /^custom_[a-f0-9]{32}$/;
const BUILTIN_SECTIONS = ["medical","mobiles","appliances","screens","electronics","workshops","sales"];
const controlSections = (db, workspaceIds) => {
  const base = BUILTIN_SECTIONS.map(id => ({id, label:id, labelEn:id, description:"", archived:false}));
  const scoped = workspaceIds.flatMap(workspace_id => db.prepare("SELECT id,label,labelEn,description,archived FROM section_definitions WHERE workspace_id=?").all(workspace_id).map(x => ({...x, workspace_id, archived:!!x.archived})));
  return [...base, ...scoped];
};
const TYPES = new Set(["device", "order", "part", "usage", "plan", "event", "attachment", "comment", "correction", "checklist", "calibration", "sale", "purchase", "report"]);
const emailOk = (x) => typeof x === "string" && x.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const hashCode = (x) => crypto.createHash("sha256").update(x).digest("hex");
const safeEqual = (a, b) => { try { const x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex"); return x.length === y.length && crypto.timingSafeEqual(x, y); } catch { return false; } };
const hashPassword = (p) => { const s = crypto.randomBytes(16).toString("hex"); return `${s}:${crypto.scryptSync(p, s, 64).toString("hex")}`; };
const passwordOk = (p, h) => { try { const [s, x] = String(h).split(":"); const y = crypto.scryptSync(p, s, 64), z = Buffer.from(x, "hex"); return y.length === z.length && crypto.timingSafeEqual(y, z); } catch { return false; } };
const cleanGrants = (g = {}) => ({ workspaceIds: Array.isArray(g.workspaceIds) ? g.workspaceIds : [], domains: Array.isArray(g.domains) ? g.domains : [], recordTypes: Array.isArray(g.recordTypes) ? g.recordTypes : [], canViewUsers: g.canViewUsers === true, canViewAudit: g.canViewAudit === true, canSuspendMembers: g.canSuspendMembers === true });
const validGrants = (g, db) => {
  if (!g || !Array.isArray(g.workspaceIds) || !Array.isArray(g.domains) || !Array.isArray(g.recordTypes)) return false;
  if ([...g.workspaceIds, ...g.domains, ...g.recordTypes].some(x => typeof x !== "string" || !x || x === "*")) return false;
  if (new Set(g.workspaceIds).size !== g.workspaceIds.length || new Set(g.domains).size !== g.domains.length || new Set(g.recordTypes).size !== g.recordTypes.length) return false;
  if (g.workspaceIds.some(x => !db.prepare("SELECT 1 FROM workspaces WHERE id=? AND revoked=0").get(x)) || g.domains.some(x => !DOMAINS.has(x) && !(CUSTOM_DOMAIN.test(x) && g.workspaceIds.some(w => db.prepare("SELECT 1 FROM section_definitions WHERE workspace_id=? AND id=?").get(w,x)))) || g.recordTypes.some(x => !TYPES.has(x))) return false;
  return typeof g.canViewUsers === "boolean" && typeof g.canViewAudit === "boolean" && typeof g.canSuspendMembers === "boolean";
};

export function installControl(app, db, cfg) {
  db.exec(`CREATE TABLE IF NOT EXISTS control_accounts (id TEXT PRIMARY KEY, slot INTEGER NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('primary','assistant')), name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, grants_json TEXT NOT NULL DEFAULT '{}', token_version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(role,slot));
CREATE TABLE IF NOT EXISTS control_setup_codes (id TEXT PRIMARY KEY, purpose TEXT NOT NULL CHECK(purpose IN ('setup','reset')), code_hash TEXT NOT NULL, email TEXT, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS control_one_primary ON control_accounts(role) WHERE role='primary';
CREATE TABLE IF NOT EXISTS control_audit (id TEXT PRIMARY KEY, actor_id TEXT, action TEXT NOT NULL, workspace_id TEXT, domain TEXT, record_type TEXT, details_json TEXT NOT NULL, created_at TEXT NOT NULL);`);
  const router = express.Router();
  const key = new TextEncoder().encode(crypto.createHash("sha256").update(String(cfg.jwt || "engx-control-development-key")).update("engx-control").digest());
  const fail = (res, code, status = 403) => res.status(status).json({ code });
  const accountDto = (a) => ({ id: a.id, name: a.name, email: a.email, role: a.role, slot: a.slot, grants: a.role === "primary" ? { workspaceIds: [], domains: [], recordTypes: [], canViewUsers: true, canViewAudit: true, canSuspendMembers: true } : cleanGrants(JSON.parse(a.grants_json || "{}")), active: !!a.active });
  const recordAudit = (actor, action, data = {}) => db.prepare("INSERT INTO control_audit (id,actor_id,action,workspace_id,domain,record_type,details_json,created_at) VALUES (?,?,?,?,?,?,?,?)").run(id(), actor?.id || null, action, data.workspace_id || null, data.domain || null, data.type || null, JSON.stringify(data.details || {}), now());
  const issue = async (a) => new SignJWT({ sub: a.id, kind: "control", token_version: a.token_version }).setProtectedHeader({ alg: "HS256" }).setAudience("engx-control").setIssuedAt().setExpirationTime("8h").sign(key);
  async function controlAuth(req, res, next) {
    try {
      const h = req.headers.authorization || ""; if (!h.startsWith("Bearer ")) throw Error();
      const { payload } = await jwtVerify(h.slice(7), key, { audience: "engx-control" });
      const a = db.prepare("SELECT * FROM control_accounts WHERE id=?").get(payload.sub);
      if (!a || !a.active || a.token_version !== payload.token_version) throw Error();
      req.control = a; next();
    } catch { recordAudit(null, "denied_control_access", { details: { path: req.path } }); return fail(res, "UNAUTHORIZED", 401); }
  }
  const primary = (req, res, next) => { if (req.control.role !== "primary") { recordAudit(req.control, "denied_control_access", { details: { path: req.path } }); return fail(res, "PRIMARY_REQUIRED"); } next(); };
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 80, standardHeaders: true, legacyHeaders: false, keyGenerator: req => `${req.ip}:${String(req.body?.email || "").toLowerCase()}` });
  router.use((_req,res,next)=>{res.set("Cache-Control","no-store");next();});
  router.use(limiter);
  router.get("/status", (_req, res) => res.json({ configured: !!db.prepare("SELECT 1 FROM control_accounts WHERE role='primary'").get() }));
  router.post("/setup", async (req, res) => {
    try {
      const { code, email, password, name } = req.body || {}; if (!code || !emailOk(email) || typeof password !== "string" || password.length < 12 || password.length > 200 || typeof name !== "string" || !name.trim()) return fail(res, "INVALID_INPUT", 400);
      if (db.prepare("SELECT 1 FROM control_accounts WHERE role='primary'").get()) return fail(res, "ALREADY_CONFIGURED", 409);
      const c = db.prepare("SELECT * FROM control_setup_codes WHERE purpose='setup' AND used_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1").get(now()); if (!c || !safeEqual(c.code_hash, hashCode(code))) return fail(res, "INVALID_CODE", 400);
      const a = { id: id(), slot: 0, role: "primary", name: name.trim().slice(0, 120), email: email.trim().toLowerCase(), password_hash: hashPassword(password), active: 1, grants_json: JSON.stringify(cleanGrants()), token_version: 0, created_at: now(), updated_at: now() };
      db.transaction(() => { db.prepare("INSERT INTO control_accounts VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(a.id,a.slot,a.role,a.name,a.email,a.password_hash,a.active,a.grants_json,a.token_version,a.created_at,a.updated_at); db.prepare("UPDATE control_setup_codes SET used_at=? WHERE id=?").run(now(),c.id); })(); recordAudit(a, "primary_setup"); return res.status(201).json({ token: await issue(a), account: accountDto(a) });
    } catch (e) { return fail(res, e.code === "SQLITE_CONSTRAINT_UNIQUE" ? "EMAIL_EXISTS" : "BAD_REQUEST", e.code === "SQLITE_CONSTRAINT_UNIQUE" ? 409 : 400); }
  });
  router.post("/reset", async (req, res) => {
    const { code, email, password } = req.body || {}; if (!code || !emailOk(email) || typeof password !== "string" || password.length < 12 || password.length > 200) return fail(res, "INVALID_INPUT", 400);
    const a = db.prepare("SELECT * FROM control_accounts WHERE role='primary'").get(), c = db.prepare("SELECT * FROM control_setup_codes WHERE purpose='reset' AND used_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1").get(now());
    if (!a || !c || c.email !== email.trim().toLowerCase() || !safeEqual(c.code_hash, hashCode(code))) { recordAudit(null, "denied_control_access", { details: { action: "reset" } }); return fail(res, "INVALID_CODE", 400); }
    const updatedHash = hashPassword(password);
    try { db.transaction(() => { const claimed = db.prepare("UPDATE control_setup_codes SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>?").run(now(),c.id,now()); if (claimed.changes !== 1) throw Error("CODE_USED"); db.prepare("UPDATE control_accounts SET password_hash=?,token_version=token_version+1,updated_at=? WHERE id=?").run(updatedHash,now(),a.id); })(); } catch { return fail(res,"INVALID_CODE",400); } const fresh=db.prepare("SELECT * FROM control_accounts WHERE id=?").get(a.id); recordAudit(fresh,"primary_reset"); return res.json({ token: await issue(fresh), account: accountDto(fresh) });
  });
  router.post("/login", async (req, res) => { const { email, password } = req.body || {}, a = db.prepare("SELECT * FROM control_accounts WHERE email=?").get(String(email || "").trim().toLowerCase()); if (!a || !a.active || typeof password !== "string" || password.length>200 || !passwordOk(password,a.password_hash)) { recordAudit(null,"denied_control_access",{details:{action:"login",email:String(email||"").slice(0,254)}}); return fail(res,"INVALID_CREDENTIALS",401); } recordAudit(a,"control_login"); return res.json({ token: await issue(a), account: accountDto(a) }); });
  router.get("/me", controlAuth, (req,res) => res.json({ account: accountDto(req.control) }));
  router.post("/password", controlAuth, async (req,res) => { const { currentPassword, newPassword }=req.body||{}; if(typeof newPassword!=="string"||newPassword.length<12||newPassword.length>200||!passwordOk(currentPassword,req.control.password_hash)) return fail(res,"INVALID_PASSWORD",400); db.prepare("UPDATE control_accounts SET password_hash=?,token_version=token_version+1,updated_at=? WHERE id=?").run(hashPassword(newPassword),now(),req.control.id); const a=db.prepare("SELECT * FROM control_accounts WHERE id=?").get(req.control.id); recordAudit(a,"control_password_changed"); return res.json({token:await issue(a),account:accountDto(a)}); });
  router.get("/assistants", controlAuth, primary, (_req,res) => res.json({ accounts: db.prepare("SELECT * FROM control_accounts WHERE role='assistant' ORDER BY slot").all().map(accountDto) }));
  router.put("/assistants/:slot", controlAuth, primary, async (req,res) => { const slot=Number(req.params.slot), b=req.body||{}; if(![1,2,3].includes(slot)||typeof b.name!=="string"||!emailOk(b.email)||typeof b.active!=="boolean"||!validGrants(b.grants,db)||(b.password!==undefined&&(typeof b.password!=="string"||b.password.length<12||b.password.length>200))) return fail(res,"INVALID_INPUT",400); const old=db.prepare("SELECT * FROM control_accounts WHERE slot=?").get(slot); if(!old&&!b.password) return fail(res,"PASSWORD_REQUIRED",400); const a={id:old?.id||id(),slot,role:"assistant",name:b.name.trim().slice(0,120),email:b.email.trim().toLowerCase(),password_hash:b.password?hashPassword(b.password):(old?.password_hash||hashPassword(crypto.randomBytes(32).toString("hex"))),active:b.active?1:0,grants_json:JSON.stringify(cleanGrants(b.grants)),token_version:(old?.token_version||0)+1,created_at:old?.created_at||now(),updated_at:now()}; try { if(old) db.prepare("UPDATE control_accounts SET name=?,email=?,password_hash=?,active=?,grants_json=?,token_version=?,updated_at=? WHERE slot=?").run(a.name,a.email,a.password_hash,a.active,a.grants_json,a.token_version,a.updated_at,slot); else db.prepare("INSERT INTO control_accounts VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(a.id,a.slot,a.role,a.name,a.email,a.password_hash,a.active,a.grants_json,a.token_version,a.created_at,a.updated_at); } catch(e) { return fail(res,e.code?.includes("CONSTRAINT")?"EMAIL_EXISTS":"BAD_REQUEST",400); } recordAudit(req.control,"assistant_changed",{details:{slot,grants:cleanGrants(b.grants),active:a.active}}); return res.json({account:accountDto(a)}); });
  const grant = (req, res, kind) => { const g=cleanGrants(JSON.parse(req.control.grants_json||"{}")); if(!g.workspaceIds.includes(req.query.workspace_id||req.body?.workspace_id)) return false; if(kind && !g[kind]) return false; return g; };
  router.get("/overview", controlAuth, (req,res) => { const a=req.control; recordAudit(a,"overview_read"); if(a.role==="primary") { const workspaces=db.prepare("SELECT id,name,owner_id FROM workspaces WHERE revoked=0").all(), users=db.prepare("SELECT id,name,email FROM users").all().map(u=>({...u,memberships:db.prepare("SELECT workspace_id,role,status FROM memberships WHERE user_id=?").all(u.id)})); return res.json({workspaces,users,sections:controlSections(db,workspaces.map(w=>w.id)),counts:{workspaces:workspaces.length,users:users.length}}); } const g=cleanGrants(JSON.parse(a.grants_json||"{}")), workspaces=db.prepare(`SELECT id,name,owner_id FROM workspaces WHERE revoked=0 AND id IN (${g.workspaceIds.map(()=>"?").join(",")||"NULL"})`).all(...g.workspaceIds); let users=[]; if(g.canViewUsers) users=db.prepare(`SELECT id,name,email FROM users WHERE id IN (SELECT DISTINCT user_id FROM memberships WHERE workspace_id IN (${g.workspaceIds.map(()=>"?").join(",")||"NULL"}))`).all(...g.workspaceIds).map(u=>({...u,memberships:db.prepare(`SELECT workspace_id,role,status FROM memberships WHERE user_id=? AND workspace_id IN (${g.workspaceIds.map(()=>"?").join(",")||"NULL"})`).all(u.id,...g.workspaceIds)})); return res.json({workspaces, sections:controlSections(db,workspaces.map(w=>w.id)), ...(g.canViewUsers?{users}:{}), counts:{workspaces:workspaces.length,...(g.canViewUsers?{users:users.length}:{})}}); });
  router.get("/records", controlAuth, (req,res) => {
    const a=req.control, wid=req.query.workspace_id || null, domain=req.query.domain || null, type=req.query.type || null;
    if ([wid,domain,type].some(x=>x!==null&&typeof x!=="string")) return fail(res,"INVALID_INPUT",400);
    const params=[wid,wid,domain,domain,type,type];
    let query="SELECT r.* FROM records r JOIN workspaces w ON w.id=r.workspace_id WHERE w.revoked=0 AND (? IS NULL OR r.workspace_id=?) AND (? IS NULL OR r.domain=?) AND (? IS NULL OR r.type=?) AND r.deleted_at IS NULL";
    if(a.role!=="primary") {
      const g=cleanGrants(JSON.parse(a.grants_json||"{}"));
      if ((wid&&!g.workspaceIds.includes(wid))||(domain&&!g.domains.includes(domain))||(type&&!g.recordTypes.includes(type))) { recordAudit(a,"denied_record_read",{workspace_id:wid,domain,type}); return fail(res,"OUT_OF_SCOPE"); }
      query+=" AND r.workspace_id IN (SELECT value FROM json_each(?)) AND r.domain IN (SELECT value FROM json_each(?)) AND r.type IN (SELECT value FROM json_each(?))";
      params.push(JSON.stringify(g.workspaceIds),JSON.stringify(g.domains),JSON.stringify(g.recordTypes));
    }
    const rows=db.prepare(query+" ORDER BY r.updated_at DESC,r.id").all(...params);
    recordAudit(a,"records_read",{workspace_id:wid,domain,type,details:{count:rows.length}});
    return res.json({records:rows.map(r=>({...r,data:JSON.parse(r.data)}))});
  });
  router.get("/audit", controlAuth, (req,res) => { const a=req.control; let rows; if(a.role==="primary") rows=[...db.prepare("SELECT * FROM audit ORDER BY created_at DESC").all(),...db.prepare("SELECT * FROM control_audit ORDER BY created_at DESC").all()]; else { const g=cleanGrants(JSON.parse(a.grants_json||"{}")); if(!g.canViewAudit) { recordAudit(a,"denied_control_access",{details:{action:"audit"}}); return fail(res,"FORBIDDEN"); } rows=db.prepare("SELECT * FROM audit WHERE workspace_id IN (SELECT value FROM json_each(?)) AND domain IN (SELECT value FROM json_each(?)) AND entity_type IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC").all(JSON.stringify(g.workspaceIds),JSON.stringify(g.domains),JSON.stringify(g.recordTypes)); } recordAudit(a,"audit_read"); return res.json({events:rows}); });
  router.patch("/memberships", controlAuth, (req,res) => { const {workspace_id,user_id,status}=req.body||{}; if(!workspace_id||!user_id||!["active","suspended"].includes(status)) return fail(res,"INVALID_INPUT",400); const m=db.prepare("SELECT m.*,w.owner_id FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=? AND m.user_id=?").get(workspace_id,user_id); if(!m) return fail(res,"NOT_FOUND",404); if(req.control.role!=="primary") { const g=cleanGrants(JSON.parse(req.control.grants_json||"{}")); if(!g.canSuspendMembers||!g.workspaceIds.includes(workspace_id)||m.role==="owner"||m.user_id===m.owner_id) return fail(res,"FORBIDDEN"); } db.prepare("UPDATE memberships SET status=? WHERE workspace_id=? AND user_id=?").run(status,workspace_id,user_id); recordAudit(req.control,"membership_changed",{workspace_id,details:{user_id,status}}); return res.json({ok:true}); });
  app.use("/api/control", router);
  return { router };
}
