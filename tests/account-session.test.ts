// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  db,
  createBackup,
  createRecord,
  getSettings,
  init,
  restoreBackup,
  searchRecords,
  signIn,
  signOut,
} from "../src/lib";
import { accountId, clearSessionToken, forgetRememberedAccount, listRememberedAccounts, setSessionToken } from "../src/accountSession";
import { chatDb, enqueueChatMessage } from "../src/chat";

const serverUrl = "https://api.example.test";
const accounts = {
  a: { id: "user-a", email: "a@example.test", name: "Account A", workspace: { id: "workspace-a", name: "Workspace A", owner_id: "user-a" }, token: "bearer-a" },
  b: { id: "user-b", email: "b@example.test", name: "Account B", workspace: { id: "workspace-b", name: "Workspace B", owner_id: "user-b" }, token: "bearer-b" },
};

function mockLogin() {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}"));
    const account = body.email === accounts.b.email ? accounts.b : accounts.a;
    return {
      ok: true,
      json: async () => ({
        token: account.token,
        serverUrl,
        user: { id: account.id, email: account.email, name: account.name },
        workspace: account.workspace,
        membership: { role: "owner" },
      }),
    };
  }));
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await clearSessionToken();
  localStorage.clear();
  sessionStorage.clear();
  await db.delete();
  await db.open();
  await chatDb.delete();
  await chatDb.open();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: false, storage: { persist: async () => true } },
  });
  await init();
});

describe("account-scoped sessions", () => {
  it("links initial local record and voice outboxes to the first authenticated workspace", async () => {
    mockLogin();
    await db.settings.update("settings", {serverUrl});
    const record = await createRecord("device", {name: "قبل الدخول", asset_code: "LOCAL-FIRST"});
    const chatId = await enqueueChatMessage({file: {name: "voice.mp4", mime: "audio/mp4", size: 2, content: "data:audio/mp4;base64,SGk="}});
    await signIn("login", {email: accounts.a.email, password: "private", rememberMe: false});
    expect((await db.records.get(record.id))?.workspace_id).toBe(accounts.a.workspace.id);
    expect((await db.queue.where("entity_id").equals(record.id).first())?.record.workspace_id).toBe(accounts.a.workspace.id);
    expect(await chatDb.outbox.get(chatId)).toMatchObject({workspace_id: accounts.a.workspace.id, owner_id: accounts.a.id, sender_id: accounts.a.id, file: {workspace_id: accounts.a.workspace.id}});
    expect((await chatDb.messages.get(chatId))?.workspace_id).toBe(accounts.a.workspace.id);
  });

  it("never persists bearer tokens or passwords in settings, snapshots, remembered identifiers, or backups", async () => {
    await db.settings.update("settings", { serverUrl, token: "legacy-bearer" });
    expect((await db.settings.get("settings"))?.token).toBe("legacy-bearer");
    const settings = await getSettings();
    expect(settings.token).toBe("legacy-bearer");
    expect((await db.settings.get("settings"))?.token).toBeUndefined();

    await db.accountSnapshots.put({
      id: "snapshot-a",
      serverUrl,
      userId: "user-a",
      workspaceId: "workspace-a",
      settings: { ...settings, token: undefined },
      queue: [],
      savedAt: new Date().toISOString(),
    });
    const backup = await createBackup("never-store-this-password");
    const raw = String(backup);
    expect(raw).not.toContain("never-store-this-password");
    expect(raw).not.toContain("legacy-bearer");
    expect(JSON.stringify(await db.settings.toArray())).not.toContain("legacy-bearer");
    expect(JSON.stringify(await db.accountSnapshots.toArray())).not.toContain("legacy-bearer");
    expect(localStorage.getItem("engx-remembered-accounts-v1") || "").not.toContain("never-store-this-password");
  });

  it("isolates A and B while logout hides A and a later A sign-in restores its context", async () => {
    mockLogin();
    await db.settings.update("settings", { serverUrl });
    await signIn("login", { email: accounts.a.email, password: "a-password" });
    const aSettings = await getSettings();
    const aRecord = await createRecord("device", { name: "A-only device", asset_code: "A-1" });
    await enqueueChatMessage({ text: "A pending message", client_id: "a-outbox" });
    await db.settings.update("settings", {
      sectionDefinitions: [{ id: "custom_a", label: "A section", icon: "folder" }],
      sectionChanges: [{ key: "change-a", section: { id: "custom_a", label: "A section", icon: "folder" } }],
      activeDomain: "custom_a",
      lastSync: 42,
    });
    await signOut();

    const guest = await getSettings();
    expect(guest.cloudEnabled).toBe(false);
    expect(guest.user.email).toBe("");
    expect(guest.user.id).not.toBe(accounts.a.id);
    expect(await searchRecords("A-only device")).toEqual([]);
    expect(await db.records.get(aRecord.id)).toMatchObject({ workspace_id: aSettings.workspace.id });
    expect(await chatDb.outbox.get("a-outbox")).toMatchObject({ workspace_id: aSettings.workspace.id });

    await db.settings.update("settings", { serverUrl });
    await signIn("login", { email: accounts.b.email, password: "b-password" });
    expect((await getSettings()).workspace.id).toBe(accounts.b.workspace.id);
    expect(await searchRecords("A-only device")).toEqual([]);
    expect(await db.records.get(aRecord.id)).toMatchObject({ workspace_id: aSettings.workspace.id });
    expect(await chatDb.outbox.get("a-outbox")).toMatchObject({ workspace_id: aSettings.workspace.id });
    await signOut();

    await db.settings.update("settings", { serverUrl });
    await signIn("login", { email: accounts.a.email, password: "a-password" });
    const restored = await getSettings();
    expect(restored.workspace.id).toBe(accounts.a.workspace.id);
    expect(restored.user.id).toBe(accounts.a.id);
    expect(restored.activeDomain).toBe("custom_a");
    expect(restored.sectionDefinitions).toEqual(expect.arrayContaining([expect.objectContaining({ id: "custom_a", label: "A section" })]));
    expect(restored.sectionChanges).toEqual(expect.arrayContaining([expect.objectContaining({ key: "change-a" })]));
    expect(restored.lastSync).toBe(42);
    expect(await searchRecords("A-only device")).toHaveLength(1);
    expect(await chatDb.outbox.get("a-outbox")).toMatchObject({ workspace_id: aSettings.workspace.id });
  });

  it("keeps remember=false out of durable web storage, opts identifiers into remember=true, and forgets only the identifier", async () => {
    const id = accountId(serverUrl, accounts.a.id);
    await setSessionToken(accounts.a.token, id, false, { id, email: accounts.a.email, name: accounts.a.name, serverUrl });
    expect(sessionStorage.getItem("engx-session-token")).toBe(accounts.a.token);
    expect(localStorage.getItem("engx-remembered-accounts-v1")).toBeNull();
    expect(JSON.stringify(await listRememberedAccounts())).not.toContain(accounts.a.email);

    const row = await createRecord("device", { name: "Keep me", asset_code: "KEEP" });
    await setSessionToken(accounts.a.token, id, true, { id, email: accounts.a.email, name: accounts.a.name, serverUrl });
    expect(await listRememberedAccounts()).toEqual([expect.objectContaining({ id, email: accounts.a.email })]);
    await forgetRememberedAccount(id);
    expect(await listRememberedAccounts()).toEqual([]);
    expect(await db.records.get(row.id)).toBeTruthy();
  });

  it("migrates a legacy durable token into the session and removes the durable copy during init", async () => {
    await db.settings.update("settings", { serverUrl, token: "legacy-token" });
    await clearSessionToken();
    await init();
    expect((await db.settings.get("settings"))?.token).toBeUndefined();
    expect((await getSettings()).token).toBe("legacy-token");
    expect(sessionStorage.getItem("engx-session-token")).toBe("legacy-token");
  });
});
