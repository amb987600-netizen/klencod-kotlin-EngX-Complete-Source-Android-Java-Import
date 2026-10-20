import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import { installControl } from "./control.mjs";

const cfg = { db: process.env.DATABASE_PATH || "./engx.sqlite", jwt: process.env.JWT_SECRET || "" };
const db = new Database(path.resolve(cfg.db));
// Keep the CLI schema identical to the server without importing server.mjs/listening.
installControl({ use() {} }, db, cfg);
const command = process.argv[2];
if (!["setup-code", "reset-primary"].includes(command)) { console.error("usage: node control-cli.mjs setup-code | reset-primary"); process.exitCode = 2; }
else {
  const code = crypto.randomBytes(32).toString("base64url");
  const purpose = command === "setup-code" ? "setup" : "reset";
  const email = command === "reset-primary" ? db.prepare("SELECT email FROM control_accounts WHERE role='primary'").get()?.email : null;
  if (purpose === "reset" && !email) { console.error("primary control account is not configured"); process.exitCode = 1; }
  else {
    db.prepare("INSERT INTO control_setup_codes (id,purpose,code_hash,email,expires_at,used_at,created_at) VALUES (?,?,?,?,?,NULL,?)").run(crypto.randomUUID(), purpose, crypto.createHash("sha256").update(code).digest("hex"), email || null, new Date(Date.now()+30*60*1000).toISOString(), new Date().toISOString());
    console.log(JSON.stringify({ code, purpose, email: email || undefined, expiresInMinutes: 30 }));
  }
}
db.close();
