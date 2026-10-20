import {ClearableTextarea} from './ClearableInput';
import { markTeamMessagesRead } from "./notifications";
import LocalAI from "./LocalAI";
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import * as lib from "./lib";
import { cacheChatFile, chatDb, chatDomainMatches, enqueueChatMessage, flushChatOutbox, getCachedChatFile, retryChatMessage, syncChatOnce, MAX_CHAT_FILE, type ChatFile, type ChatMessage } from "./chat";
import VoiceRecorder from "./VoiceRecorder";
import "./chat.css";

type Props = { notify?: (message: string) => void };
const tell = (notify: Props["notify"], message: string) => notify?.(message);
const dataUrl = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("تعذر قراءة الملف")); reader.readAsDataURL(file); });
const formatBytes = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} ك.ب` : `${(n / 1024 / 1024).toFixed(1)} م.ب`;
const formatDate = (value: string) => { try { return new Date(value).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" }); } catch { return value; } };

export default function TeamChat({ notify }: Props) {
  const settings = lib.useSettings(), workspaceId = settings?.workspace?.id || "", activeDomain = settings?.activeDomain;
  const messages = useLiveQuery(async () => workspaceId ? (await chatDb.messages.where("workspace_id").equals(workspaceId).sortBy("seq")).filter((m) => chatDomainMatches(m.domain, activeDomain)).sort((a, b) => a.created_at.localeCompare(b.created_at)) : [], [workspaceId, activeDomain], []);
  const files = useLiveQuery(async () => workspaceId ? (await chatDb.files.where("workspace_id").equals(workspaceId).toArray()).filter((f) => chatDomainMatches(f.domain, activeDomain)) : [], [workspaceId, activeDomain], []);
  const outbox = useLiveQuery(async () => workspaceId ? (await chatDb.outbox.where("workspace_id").equals(workspaceId).toArray()).filter((q) => chatDomainMatches(q.domain, activeDomain) && q.owner_id === settings?.user?.id) : [], [workspaceId, activeDomain, settings?.user?.id], []);
  const [sending, setSending] = useState(false);
  const sendLock = useRef(false);
  const scopeKey = `${workspaceId}:${settings?.user.id}:${String(activeDomain)}`;
  const currentScope = useRef(scopeKey); currentScope.current = scopeKey;
  const [text, setText] = useState(""), [attachment, setAttachment] = useState<File | null>(null), [refreshing, setRefreshing] = useState(false);
  const bottom = useRef<HTMLDivElement>(null), online = typeof navigator === "undefined" || navigator.onLine, configured = Boolean(settings?.cloudEnabled && settings?.token && workspaceId), viewer = settings?.role === "viewer";
  useEffect(() => { const read = () => { if (workspaceId && document.visibilityState === "visible" && messages?.length) void markTeamMessagesRead(workspaceId, String(activeDomain || "medical"), messages); }; read(); document.addEventListener("visibilitychange", read); return () => document.removeEventListener("visibilitychange", read); }, [workspaceId, activeDomain, messages]);
  useEffect(() => { if (!workspaceId) return; const tick = () => { if (navigator.onLine) void flushChatOutbox().then(() => { if (configured) return syncChatOnce(); }).catch(() => undefined); }; tick(); const timer = window.setInterval(tick, 4000); window.addEventListener("online", tick); return () => { window.clearInterval(timer); window.removeEventListener("online", tick); }; }, [workspaceId, configured, activeDomain, settings?.user?.id]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages?.length]);
  const refresh = async () => { if (!configured || !online) return; setRefreshing(true); try { await syncChatOnce(); } catch (e) { tell(notify, e instanceof Error ? e.message : "تعذر تحديث المحادثة"); } finally { setRefreshing(false); } };
  const chooseFile = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; if (file.size > MAX_CHAT_FILE) { tell(notify, "الحد الأقصى للملف 10 م.ب"); return; } setAttachment(file); };
  useEffect(() => {setText(""); setAttachment(null);}, [scopeKey]);
  const send = async (voice?: File) => {
    if (sendLock.current || viewer || (!text.trim() && !attachment && !voice)) return;
    sendLock.current = true; setSending(true);
    const startedScope = scopeKey;
    try {
      const selected = voice || attachment;
      await enqueueChatMessage({text, expectedScope: {workspace_id: workspaceId, sender_id: settings!.user.id, domain: activeDomain}, file: selected ? {name: selected.name, mime: selected.type || "application/octet-stream", size: selected.size, content: await dataUrl(selected)} : undefined});
      if (currentScope.current === startedScope) {setText(""); setAttachment(null);}
      tell(notify, online && configured ? "تم وضع الرسالة في قائمة الإرسال" : configured ? "حُفظت الرسالة محليًا وستُرسل عند عودة الاتصال" : "حُفظت محليًا فقط؛ يلزم إعداد السحابة وحساب الفريق للإرسال");
    } catch (e) {if (voice) throw e; tell(notify, e instanceof Error ? e.message : "تعذر حفظ الرسالة");}
    finally {sendLock.current = false; setSending(false);}
  };
  const loadRemoteFile = async (message: ChatMessage) => {
    if (!message.file || !workspaceId) return;
    try { let cached = await getCachedChatFile(message.file.id, activeDomain); if (!cached) { if (!online || !configured) { tell(notify, "الصوت غير محفوظ محلياً؛ اتصل بالإنترنت لتنزيله"); return; } const response = await lib.teamRequest(`/api/chat/files/${encodeURIComponent(message.file.id)}?workspace_id=${encodeURIComponent(workspaceId)}&domain=${encodeURIComponent(String(activeDomain || "medical"))}`); if (!response?.content) throw new Error("الملف غير متاح"); cached = { ...response, workspace_id: workspaceId, domain: response.domain || message.domain || activeDomain } as ChatFile; await cacheChatFile(cached); }
      if (!cached.content) throw new Error("الصوت غير متاح");
    } catch (e) { tell(notify, e instanceof Error ? e.message : "تعذر تحميل الصوت"); }
  };
  const download = async (message: ChatMessage) => { await loadRemoteFile(message); const cached = message.file && await getCachedChatFile(message.file.id, activeDomain); if (cached?.content) { const blob = await (await fetch(cached.content)).blob(); await lib.downloadBlob(blob, cached.name); } };
  if (!settings) return <section className="team-chat"><p>جارٍ تحميل المحادثة…</p></section>;
  return <section className="team-chat" dir="rtl">
    <header className="team-chat-head"><div><h2>محادثة مساحة العمل</h2><p>الأعضاء • رقم داخلي افتراضي وليس رقم هاتف</p></div><button className="chat-refresh" type="button" onClick={() => void refresh()} disabled={refreshing || !configured || !online}>↻ {refreshing ? "جارٍ التحديث" : "تحديث"}</button></header>
    <LocalAI messages={messages || []} notify={notify}/><div className="chat-status"><span className={online ? "status-dot online" : "status-dot"} />{online && configured ? "متصل — إرسال ومزامنة تلقائيان" : online ? "الخدمة السحابية غير مفعلة — تُحفظ الرسائل محلياً" : "غير متصل — تُحفظ الرسائل محلياً فقط"}</div>
    <div className="chat-privacy">لا ترسل بيانات مرضى. التسجيل لا يبدأ إلا بعد ضغط زر الميكروفون. الصوت البعيد لا يُحمّل تلقائياً. مشاركة الفريق تحتاج خادم HTTPS وحسابًا؛ ليست بتشفير طرف لطرف.</div>
    <div className="chat-log" aria-live="polite">{!messages?.length && <div className="chat-empty">لا توجد رسائل محفوظة في هذه المساحة.</div>}{messages?.map((message) => { const queued = outbox?.find((q) => q.client_id === message.client_id); const cached = message.file && files?.find((f) => f.id === message.file?.id); const audio = Boolean(message.file?.mime.startsWith("audio/")); return <article className="chat-message" key={message.id}><div className="chat-message-meta"><strong>{message.sender_name || "عضو"}</strong><span>{message.virtual_number ? `رقم داخلي: ${message.virtual_number}` : `المعرّف: ${message.sender_id}`}</span><time>{formatDate(message.created_at)}</time>{queued ? <small className={queued.status === "failed" ? "chat-failed" : "chat-pending"}>{queued.status === "failed" ? "فشل — " + (queued.last_error || "أعد المحاولة") : "قيد الانتظار"}<button type="button" onClick={() => void retryChatMessage(queued.client_id)}>إعادة</button></small> : <small>مخزنة محلياً</small>}</div>{message.text && <p>{message.text}</p>}{message.file && (audio ? cached?.content ? <audio controls preload="none" src={cached.content} /> : <button className="chat-file" type="button" onClick={() => void loadRemoteFile(message)}>تحميل الرسالة الصوتية</button> : <button className="chat-file" type="button" onClick={() => void download(message)}>{cached ? "تنزيل من المحفوظ: " : "تنزيل: "}{message.file.name} ({formatBytes(message.file.size)})</button>)}</article>; })}<div ref={bottom}/></div>
    <div className="chat-compose">{viewer && <div className="chat-readonly">حسابك للقراءة فقط.</div>}<ClearableTextarea value={text} onChange={(e) => setText(e.target.value)} disabled={viewer || sending} placeholder="اكتب رسالة…" aria-label="نص الرسالة"/><div className="chat-compose-row"><label className="chat-attach"><input type="file" onChange={chooseFile} disabled={viewer || sending} />إرفاق ملف</label>{attachment && <span className="chat-selected">{attachment.name} ({formatBytes(attachment.size)}) <button type="button" onClick={() => setAttachment(null)}>×</button></span>}<button className="chat-send" type="button" onClick={() => void send()} disabled={sending || viewer || (!text.trim() && !attachment)}>إرسال</button></div><VoiceRecorder disabled={viewer} scopeKey={scopeKey} notify={notify} onSend={(file) => send(file)}/></div>
  </section>;
}
