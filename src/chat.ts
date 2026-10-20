import Dexie, { type Table } from "dexie";
import { getSettings, teamRequest } from "./lib";
import { normalizeDomain, type DomainId } from "./domains";

export const MAX_CHAT_FILE = 10 * 1024 * 1024;
export type ChatFile = { id: string; name: string; mime: string; size: number; content?: string; workspace_id: string; domain?: DomainId | string };
export type ChatMessage = {
  id: string; seq: number; workspace_id: string; sender_id: string; sender_name: string;
  virtual_number?: string; text: string; created_at: string;
  file?: { id: string; name: string; mime: string; size: number };
  domain?: DomainId | string; client_id?: string; pending?: boolean; failed?: boolean;
};
export type ChatOutbox = {
  client_id: string; workspace_id: string; domain: DomainId | string; owner_id: string;
  sender_id: string; sender_name: string; text: string; file?: ChatFile;
  created_at: string; status: "pending" | "failed"; attempts: number; last_error?: string;
};
export const chatDomainMatches = (value: unknown, activeDomain: unknown): boolean => normalizeDomain(value) === normalizeDomain(activeDomain);

class ChatDB extends Dexie {
  messages!: Table<ChatMessage, string>; files!: Table<ChatFile, string>; outbox!: Table<ChatOutbox, string>;
  constructor() {
    super("engx-chat-v1");
    this.version(1).stores({ messages: "id,[workspace_id+seq],workspace_id", files: "id,workspace_id" });
    this.version(2).stores({ messages: "id,[workspace_id+seq],workspace_id", files: "id,workspace_id", outbox: "client_id,workspace_id,[workspace_id+domain],owner_id" });
  }
}
export const chatDb = new ChatDB();
const online = () => typeof navigator === "undefined" || navigator.onLine;
const signedIn = (s: any) => Boolean(s?.cloudEnabled && s?.token && s?.workspace?.id);
const uuid = () => crypto.randomUUID();
let flushLock: Promise<void> | undefined;

export async function syncChatOnce(): Promise<void> {
  if (!online()) return;
  const s = await getSettings();
  if (!signedIn(s)) return;
  await flushChatOutbox();
  const workspace_id = s.workspace.id;
  let after = (await chatDb.messages.where("workspace_id").equals(workspace_id).toArray()).filter((row) => chatDomainMatches(row.domain, s.activeDomain)).reduce((max, row) => Math.max(max, Number(row.seq) || 0), 0);
  for (let page = 0; page < 100; page++) {
    if (!online()) return;
    const result = await teamRequest(`/api/chat?workspace_id=${encodeURIComponent(workspace_id)}&after=${after}&domain=${encodeURIComponent(normalizeDomain(s.activeDomain))}`);
    const messages: ChatMessage[] = Array.isArray(result?.messages) ? result.messages : [];
    if (messages.length) { await chatDb.messages.bulkPut(messages.map((m) => ({ ...m, workspace_id }))); after = Math.max(after, ...messages.map((m) => Number(m.seq) || 0)); }
    if (!result?.more || messages.length === 0) return;
  }
}

export async function enqueueChatMessage(input: { text?: string; file?: Omit<ChatFile, "id" | "workspace_id" | "domain">; client_id?: string; expectedScope?: {workspace_id: string; sender_id: string; domain: unknown} }): Promise<string> {
  const s = await getSettings();
  if (s.role === "viewer") throw new Error("حسابك للقراءة فقط");
  if (input.expectedScope && (s.workspace.id !== input.expectedScope.workspace_id || s.user.id !== input.expectedScope.sender_id || normalizeDomain(s.activeDomain) !== normalizeDomain(input.expectedScope.domain))) throw new Error("تغير القسم أو الحساب؛ أعد الإرسال من القسم الصحيح");
  const workspace_id = s.workspace.id, domain = normalizeDomain(s.activeDomain), sender_id = s.user.id;
  if (!input.text?.trim() && !input.file) throw new Error("لا يمكن حفظ رسالة فارغة");
  if ((input.text || "").length > 8000) throw new Error("الرسالة طويلة جدًا؛ الحد 8000 حرف");
  if (input.file && (input.file.size > MAX_CHAT_FILE || input.file.size <= 0)) throw new Error("الحد الأقصى للملف 10 م.ب");
  if (input.file?.mime.startsWith("audio/") && (!input.file.content || !input.file.content.startsWith("data:"))) throw new Error("محتوى التسجيل غير صالح");
  const client_id = input.client_id || uuid();
  const file = input.file ? { ...input.file, id: `${client_id}-file`, workspace_id, domain } : undefined;
  const row: ChatOutbox = { client_id, workspace_id, domain, owner_id: sender_id, sender_id, sender_name: s.user.name || "عضو", text: input.text || "", file, created_at: new Date().toISOString(), status: "pending", attempts: 0 };
  await chatDb.transaction("rw", chatDb.outbox, chatDb.files, chatDb.messages, async () => {
    await chatDb.outbox.put(row);
    if (file) await chatDb.files.put(file);
    await chatDb.messages.put({ id: client_id, seq: -Date.now(), workspace_id, sender_id, sender_name: row.sender_name, text: row.text, created_at: row.created_at, domain, client_id, pending: true, file: file && { id: file.id, name: file.name, mime: file.mime, size: file.size } });
  });
  if (online() && signedIn(s)) void flushChatOutbox().catch(() => undefined);
  return client_id;
}

export async function flushChatOutbox(): Promise<void> {
  if (flushLock) return flushLock;
  flushLock = (async () => {
  if (!online()) return;
  const s = await getSettings();
  if (!signedIn(s) || s.role === "viewer") return;
  const workspace_id = s.workspace.id, owner_id = s.user.id;
  const rows = (await chatDb.outbox.where("workspace_id").equals(workspace_id).toArray()).filter((r) => r.owner_id === owner_id && r.sender_id === owner_id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (rows.length && (s.sectionChanges?.length || rows.some((r) => String(r.domain).startsWith("custom_")))) { const sections = (await import("./lib")) as any; if (typeof sections.syncSections === "function") await sections.syncSections(); }
  for (const row of rows) {
    if (!online()) return;
    const latest = await getSettings();
    if (!signedIn(latest) || latest.role === "viewer" || latest.workspace.id !== workspace_id || latest.user.id !== owner_id) return;
    try {
      const file = row.file && { name: row.file.name, mime: row.file.mime, size: row.file.size, content: row.file.content };
      const response = await teamRequest("/api/chat/messages", "POST", { workspace_id, domain: row.domain, client_id: row.client_id, text: row.text, ...(file ? { file } : {}) });
      if (!response?.message) throw new Error("رد الرسالة غير صالح");
      await chatDb.transaction("rw", chatDb.outbox, chatDb.messages, chatDb.files, async () => {
        await chatDb.messages.delete(row.client_id);
        if (row.file) await chatDb.files.delete(row.file.id);
        const confirmed = response.message as ChatMessage;
        if (row.file && confirmed.file) await chatDb.files.put({ ...row.file, id: confirmed.file.id, name: confirmed.file.name, mime: confirmed.file.mime, size: confirmed.file.size, workspace_id, domain: row.domain });
        await chatDb.messages.put({ ...confirmed, workspace_id, domain: confirmed.domain || row.domain, client_id: row.client_id });
        await chatDb.outbox.delete(row.client_id);
      });
    } catch (e) {
      await chatDb.outbox.update(row.client_id, { status: "failed", attempts: row.attempts + 1, last_error: e instanceof Error ? e.message : "تعذر الإرسال" });
    }
  }
  })();
  try { await flushLock; } finally { flushLock = undefined; }
}

export async function retryChatMessage(client_id: string): Promise<void> { await chatDb.outbox.update(client_id, { status: "pending", last_error: undefined }); await flushChatOutbox(); }
export async function exportCachedChat(workspace_id: string): Promise<{ messages: any[]; files: any[]; outbox: any[] }> { return { messages: await chatDb.messages.where("workspace_id").equals(workspace_id).toArray(), files: await chatDb.files.where("workspace_id").equals(workspace_id).toArray(), outbox: await chatDb.outbox.where("workspace_id").equals(workspace_id).toArray() }; }
export async function restoreCachedChat(workspace_id: string, archive: { messages?: any[]; files?: any[]; outbox?: any[] }): Promise<void> {
  await chatDb.transaction("rw", chatDb.messages, chatDb.files, chatDb.outbox, async () => {
    await chatDb.messages.where("workspace_id").equals(workspace_id).delete(); await chatDb.files.where("workspace_id").equals(workspace_id).delete(); await chatDb.outbox.where("workspace_id").equals(workspace_id).delete();
    const messages = (archive?.messages || []).filter((m) => m?.workspace_id === workspace_id);
    const files = (archive?.files || []).filter((f) => f?.workspace_id === workspace_id && Number(f.size) <= MAX_CHAT_FILE);
    const outbox = (archive?.outbox || []).filter((q) => q?.workspace_id === workspace_id && q?.owner_id && q?.sender_id);
    if (messages.length) await chatDb.messages.bulkPut(messages); if (files.length) await chatDb.files.bulkPut(files); if (outbox.length) await chatDb.outbox.bulkPut(outbox);
  });
}
export async function clearWorkspaceChat(workspace_id: string): Promise<void> { await chatDb.transaction("rw", chatDb.messages, chatDb.files, chatDb.outbox, async () => { await chatDb.messages.where("workspace_id").equals(workspace_id).delete(); await chatDb.files.where("workspace_id").equals(workspace_id).delete(); await chatDb.outbox.where("workspace_id").equals(workspace_id).delete(); }); }
export async function cacheChatMessage(message: ChatMessage): Promise<void> { await chatDb.messages.put(message); }
export async function cacheChatFile(file: ChatFile): Promise<void> { await chatDb.files.put(file); }
export async function getCachedChatFile(id: string, activeDomain?: unknown): Promise<ChatFile | undefined> { const file = await chatDb.files.get(id); return file && (activeDomain === undefined || chatDomainMatches(file.domain, activeDomain)) ? file : undefined; }

/** Only called when the initial, unauthenticated local workspace is explicitly linked by sign-in. */
export async function migrateGuestChat(fromWorkspace: string, fromUser: string, toWorkspace: string, toUser: string, senderName: string): Promise<void> {
  if (fromWorkspace === toWorkspace && fromUser === toUser) return;
  await chatDb.transaction("rw", chatDb.messages, chatDb.files, chatDb.outbox, async () => {
    const queued = (await chatDb.outbox.where("workspace_id").equals(fromWorkspace).toArray()).filter(q => q.owner_id === fromUser && q.sender_id === fromUser);
    for (const q of queued) {
      const file = q.file && {...q.file, workspace_id: toWorkspace};
      await chatDb.outbox.put({...q, workspace_id: toWorkspace, owner_id: toUser, sender_id: toUser, sender_name: senderName, file});
      if (file) await chatDb.files.put(file);
      const message = await chatDb.messages.get(q.client_id);
      if (message) await chatDb.messages.put({...message, workspace_id: toWorkspace, sender_id: toUser, sender_name: senderName});
    }
  });
}
