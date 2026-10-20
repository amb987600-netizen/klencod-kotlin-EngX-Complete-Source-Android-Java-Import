import { Capacitor, registerPlugin } from "@capacitor/core";

export type RememberedAccount = { id: string; email: string; name: string; serverUrl: string };
type NativeSession = {
  get(options: { id: string }): Promise<{ token?: string; account?: RememberedAccount }>;
  save(options: { id: string; token: string; account: RememberedAccount }): Promise<void>;
  remove(options: { id: string; keepIdentifier?: boolean }): Promise<void>;
  list(): Promise<{ accounts: RememberedAccount[] }>;
};
const NativeSession = registerPlugin<NativeSession>("EngXSession");
const rememberedKey = "engx-remembered-accounts-v1";
let activeToken: string | undefined;
let activeAccountId: string | undefined;
let epoch = 0;

function originOf(serverUrl: string) {
  try { return new URL(serverUrl).origin.toLowerCase(); } catch { return serverUrl.trim().replace(/\/$/, "").toLowerCase(); }
}
export function accountId(serverUrl: string, userId: string) {
  return `${originOf(serverUrl)}|${String(userId).trim()}`;
}
export function sessionEpoch() { return epoch; }
function bump() { epoch += 1; if (typeof window !== "undefined") window.dispatchEvent(new Event("engx:session-changed")); }
function webAccounts(): RememberedAccount[] {
  try { return JSON.parse(localStorage.getItem(rememberedKey) || "[]"); } catch { return []; }
}
function writeWebAccounts(accounts: RememberedAccount[]) {
  try { localStorage.setItem(rememberedKey, JSON.stringify(accounts.map(({ id, email, name, serverUrl }) => ({ id, email, name, serverUrl })))); } catch { /* private browsing */ }
}
function hasNative() { return Capacitor.isNativePlatform(); }

export async function getSessionToken(id?: string) {
  if (id && activeAccountId && id !== activeAccountId) return undefined;
  if (activeToken) return activeToken;
  if (id && hasNative()) {
    const result = await NativeSession.get({ id });
    if (result?.token) { activeToken = result.token; activeAccountId = id; bump(); return activeToken; }
  } else {
    try { activeToken = sessionStorage.getItem("engx-session-token") || undefined; if (activeToken) activeAccountId = id; } catch { /* unavailable */ }
  }
  return activeToken;
}
export async function setSessionToken(token: string | undefined, id?: string, remember = false, account?: RememberedAccount) {
  activeToken = token;
  activeAccountId = id;
  try { if (token && !hasNative()) sessionStorage.setItem("engx-session-token", token); else sessionStorage.removeItem("engx-session-token"); } catch { /* unavailable */ }
  if (!remember && id && hasNative()) await NativeSession.remove({id, keepIdentifier: true});
  if (remember && token && id && account) {
    if (hasNative()) await NativeSession.save({ id, token, account });
    const accounts = webAccounts().filter((a) => a.id !== id);
    writeWebAccounts([account, ...accounts]);
  }
  bump();
}
export async function clearSessionToken(id?: string) {
  const target = id || activeAccountId;
  activeToken = undefined; activeAccountId = undefined;
  try { sessionStorage.removeItem("engx-session-token"); } catch { /* unavailable */ }
  if (target && hasNative()) await NativeSession.remove({ id: target, keepIdentifier: true });
  bump();
}
export async function listRememberedAccounts(): Promise<RememberedAccount[]> {
  if (hasNative()) {
    const result = await NativeSession.list();
    return (result?.accounts || []).map(({ id, email, name, serverUrl }) => ({ id, email, name, serverUrl }));
  }
  return webAccounts();
}
export async function forgetRememberedAccount(id: string) {
  if (hasNative()) await NativeSession.remove({ id });
  writeWebAccounts(webAccounts().filter((a) => a.id !== id));
  if (activeAccountId === id) await clearSessionToken(id);
}
export function rememberedAccountFor(serverUrl: string, user: { id: string; email?: string; name?: string }): RememberedAccount {
  return { id: accountId(serverUrl, user.id), email: user.email || "", name: user.name || "", serverUrl: originOf(serverUrl) };
}
export { epoch as sessionChangeEpoch };
