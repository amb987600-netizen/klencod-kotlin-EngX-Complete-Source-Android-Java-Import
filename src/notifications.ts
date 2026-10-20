import { useEffect, useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { useRecords, useSettings, saveSettings, type RecordRow, type Settings } from "./lib";
import { chatDb, chatDomainMatches, type ChatMessage } from "./chat";
import { useLiveQuery } from "dexie-react-hooks";

export const NOTIFICATION_CATEGORIES = ["maintenance", "calibration", "stock", "approvals", "assignments", "messages"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type AlertLevel = "imminent" | "overdue" | "info";
export type SmartAlert = {
  id: string; category: NotificationCategory; level: AlertLevel; title: string; body: string;
  genericTitle: string; genericBody: string; createdAt: string; dueAt?: string;
  domain?: string; orderId?: string; deviceId?: string; recordId?: string;
  nativeEligible?: boolean;
};
export type NotificationPreferences = Partial<Record<NotificationCategory, boolean>> & {
  enabled?: boolean; showDetails?: boolean; daysBefore?: number; nativeEnabled?: boolean;
};
export type NotificationSettings = Settings & { notificationPreferences?: NotificationPreferences };
export type NotificationRecord = Pick<RecordRow, "id" | "type" | "domain" | "data" | "deleted_at" | "updated_at"> & Partial<Pick<RecordRow, "workspace_id">>;

const defaults: Required<Pick<NotificationPreferences, "enabled" | "showDetails" | "daysBefore" | "nativeEnabled">> = { enabled: true, showDetails: false, daysBefore: 7, nativeEnabled: true };
const pref = (settings: any): NotificationPreferences => ({ ...defaults, ...(settings?.notificationPreferences || {}) });
const date = (value: unknown) => { const n = Date.parse(String(value || "")); return Number.isFinite(n) ? n : NaN; };
const iso = (n: number) => new Date(n).toISOString();
const stable = (value: string) => { let h = 2166136261; for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };
const active = (r: any, settings: any) => !r.deleted_at && (!settings?.activeDomain || chatDomainMatches(r.domain, settings.activeDomain));
const label = (r: any) => String(r.data?.asset_code || r.data?.name || r.data?.record_code || "").trim();
const enabled = (p: NotificationPreferences, category: NotificationCategory) => p.enabled !== false && p[category] !== false;

function safeAlert(base: Omit<SmartAlert, "title" | "body" | "genericTitle" | "genericBody"> & { detailsTitle: string; detailsBody: string; genericTitle: string; genericBody: string }, showDetails: boolean): SmartAlert {
  return { ...base, title: showDetails ? base.detailsTitle : base.genericTitle, body: showDetails ? base.detailsBody : base.genericBody, nativeEligible: base.category === "maintenance" || base.category === "calibration" };
}

/** Pure, deterministic alert projection. It never mutates records or settings. */
export function buildAlerts(records: NotificationRecord[], settings: any, now: Date | string | number, unreadMessages?: number | ChatMessage[]): SmartAlert[] {
  const p = pref(settings); if (p.enabled === false) return [];
  const at = typeof now === "number" ? now : date(now); if (!Number.isFinite(at)) return [];
  const rows = records.filter((r) => active(r, settings));
  const out: SmartAlert[] = [];
  const addSchedule = (r: any, category: "maintenance" | "calibration", dueValue: unknown) => {
    const due = date(dueValue); if (!Number.isFinite(due) || !enabled(p, category)) return;
    const diff = due - at; const level: AlertLevel = diff < 0 ? "overdue" : diff <= Number(p.daysBefore) * 86400000 ? "imminent" : "info";
    if (level === "info") return;
    const deviceId = String(r.data?.device_id || ""); const name = label(r);
    const genericTitle = category === "maintenance" ? (level === "overdue" ? "صيانة متأخرة" : "صيانة قريبة") : (level === "overdue" ? "معايرة متأخرة" : "معايرة قريبة");
    const detailsTitle = genericTitle; const detailsBody = `${category === "maintenance" ? "موعد الصيانة" : "موعد المعايرة"}: ${new Date(due).toLocaleDateString("ar")}${name ? ` — ${name}` : ""}`;
    out.push(safeAlert({ id: `schedule:${category}:${r.id}:${iso(due)}`, category, level, genericTitle, genericBody: level === "overdue" ? "يوجد موعد يحتاج متابعة." : "يوجد موعد قريب يحتاج متابعة.", detailsTitle, detailsBody, createdAt: iso(at), dueAt: iso(due), domain: String(r.domain || ""), deviceId: deviceId || undefined, recordId: r.id }, Boolean(p.showDetails)));
  };
  const latestCalibration = new Map<string, any>();
  rows.filter((r) => r.type === "calibration").forEach((r) => { const key = String(r.data?.device_id || r.id); const old = latestCalibration.get(key); if (!old || (date(r.data?.performed_at) || date(r.updated_at)) > (date(old.data?.performed_at) || date(old.updated_at)) || (date(r.data?.performed_at) === date(old.data?.performed_at) && String(r.updated_at) > String(old.updated_at))) latestCalibration.set(key, r); });
  rows.filter((r) => r.type === "plan" && !["cancelled", "inactive"].includes(String(r.data?.status))).forEach((r) => addSchedule(r, "maintenance", r.data?.next_due));
  [...latestCalibration.values()].forEach((r) => addSchedule(r, "calibration", r.data?.next_due));
  if (enabled(p, "stock")) rows.filter((r) => r.type === "part" && Number.isFinite(Number(r.data?.quantity)) && Number.isFinite(Number(r.data?.min_quantity)) && Number(r.data.quantity) <= Number(r.data.min_quantity)).forEach((r) => out.push(safeAlert({ id: `stock:${r.id}:${r.data.quantity}`, category: "stock", level: "info", genericTitle: "مخزون منخفض", genericBody: "يوجد صنف يحتاج إعادة تزويد.", detailsTitle: "مخزون منخفض", detailsBody: `يوجد صنف تحت الحد الأدنى${label(r) ? `: ${label(r)}` : ""}`, createdAt: iso(at), domain: String(r.domain || ""), recordId: r.id }, Boolean(p.showDetails))));
  if (enabled(p, "approvals")) rows.filter((r) => r.type === "order" && String(r.data?.status) === "pending_approval").forEach((r) => out.push(safeAlert({ id: `approval:${r.id}`, category: "approvals", level: "info", genericTitle: "اعتماد مطلوب", genericBody: "يوجد أمر عمل ينتظر الاعتماد.", detailsTitle: "اعتماد مطلوب", detailsBody: `أمر عمل يحتاج الاعتماد${label(r) ? `: ${label(r)}` : ""}`, createdAt: iso(at), domain: String(r.domain || ""), orderId: r.id, recordId: r.id }, Boolean(p.showDetails))));
  if (enabled(p, "assignments")) rows.filter((r) => r.type === "order" && r.data?.assigned_to && r.data.assigned_to === settings?.user?.id && String(r.data?.status) !== "closed").forEach((r) => out.push(safeAlert({ id: `assignment:${r.id}`, category: "assignments", level: "info", genericTitle: "تكليف جديد", genericBody: "لديك أمر عمل مكلّف به.", detailsTitle: "تكليف جديد", detailsBody: `لديك أمر عمل مكلّف به${label(r) ? `: ${label(r)}` : ""}`, createdAt: iso(at), domain: String(r.domain || ""), orderId: r.id, recordId: r.id }, Boolean(p.showDetails))));
  let unread = typeof unreadMessages === "number" ? Math.max(0, unreadMessages) : Array.isArray(unreadMessages) ? unreadMessages.filter((m) => !(m as any).read && !(m as any).isRead && m.sender_id !== settings?.user?.id && chatDomainMatches(m.domain, settings?.activeDomain)).length : 0;
  if (enabled(p, "messages") && unread > 0) out.push(safeAlert({ id: `messages:${settings?.workspace?.id || "local"}:${settings?.activeDomain || "medical"}:${unread}`, category: "messages", level: "info", genericTitle: "رسائل غير مقروءة", genericBody: "لديك رسائل فريق غير مقروءة.", detailsTitle: "رسائل غير مقروءة", detailsBody: `لديك ${unread} رسالة غير مقروءة.`, createdAt: iso(at) }, Boolean(p.showDetails)));
  return out.sort((a, b) => `${a.category}:${a.id}`.localeCompare(`${b.category}:${b.id}`));
}

const ownedKey = (workspace: string) => `engx-smart-notifications:${workspace || "local"}`;
const readKey = (workspace: string, domain: string) => `engx-chat-read:${workspace || "local"}:${domain || "medical"}`;
const nativeId = (id: string) => Math.max(1, parseInt(stable(id).slice(0, 7), 36) % 2147483000);
const routeScreen = (category: NotificationCategory) => category === "messages" ? "chat" : category === "stock" ? "inventory" : ["approvals", "assignments"].includes(category) ? "orders" : "devices";
let nativeListenerPromise: Promise<{ remove: () => Promise<void> }> | undefined;
let nativeListenerHandle: { remove: () => Promise<void> } | undefined;
let nativeListenerUsers = 0;
let reconcileQueue: Promise<void> = Promise.resolve();

/** Marks the current cached team-chat messages read for one workspace/domain. */
export async function markTeamMessagesRead(workspaceId: string, domain = "medical", messages?: ChatMessage[]): Promise<void> {
  const rows = messages || await chatDb.messages.where("workspace_id").equals(workspaceId).toArray();
  const maxSeq = rows.filter((m) => chatDomainMatches(m.domain, domain)).reduce((max, m) => Math.max(max, Number(m.seq) || 0), 0);
  if (maxSeq) localStorage.setItem(readKey(workspaceId, domain), String(maxSeq));
  window.dispatchEvent(new CustomEvent("engx:chat-read", { detail: { workspaceId, domain, seq: maxSeq } }));
}

async function reconcileNative(alerts: SmartAlert[], settings: any) {
  if (!Capacitor.isNativePlatform()) return;
  const key = ownedKey(settings?.workspace?.id); let previous: Record<string, number> = {}; try { previous = JSON.parse(localStorage.getItem(key) || "{}"); } catch { /* ignore */ }
  if (pref(settings).nativeEnabled === false) { const stale = Object.values(previous).map((id) => ({ id })); if (stale.length) await LocalNotifications.cancel({ notifications: stale }); localStorage.removeItem(key); return; }
  const permission = await LocalNotifications.checkPermissions(); if (permission.display !== "granted") return;
  const future = alerts.filter((a) => a.nativeEligible && a.level === "imminent" && a.dueAt && date(a.dueAt) > Date.now());
  const next: Record<string, number> = {};
  for (const a of future) { const id = nativeId(`scheduled:${a.id}`); next[`scheduled:${a.id}`] = id; if (previous[`scheduled:${a.id}`] === id) continue; await LocalNotifications.schedule({ notifications: [{ id, title: a.genericTitle, body: a.genericBody, schedule: { at: new Date(a.dueAt!), allowWhileIdle: true }, extra: { engxOwned: true, alertId: a.id, domain: a.domain, screen: routeScreen(a.category), orderId: a.orderId, deviceId: a.deviceId } }] }); }
  const oneShot = alerts;
  for (const a of oneShot) { const ownership = `once:${a.id}:${a.level}`; const id = nativeId(ownership); next[ownership] = id; if (previous[ownership] === id) continue; await LocalNotifications.schedule({ notifications: [{ id, title: a.genericTitle, body: a.genericBody, schedule: { at: new Date(Date.now() + 1000) }, extra: { engxOwned: true, alertId: a.id, domain: a.domain, screen: routeScreen(a.category), orderId: a.orderId, deviceId: a.deviceId } }] }); }
  const stale = Object.entries(previous).filter(([id]) => !next[id]).map(([, id]) => ({ id })); if (stale.length) await LocalNotifications.cancel({ notifications: stale });
  localStorage.setItem(key, JSON.stringify(next));
}

export type SmartNotificationsApi = { alerts: SmartAlert[]; permission: string; requestPermission: () => Promise<string>; refresh: () => Promise<void>; savePreferences: (patch: NotificationPreferences) => Promise<void> };
export function useSmartNotifications(options: { background?: boolean } = {}): SmartNotificationsApi {
  const settings = useSettings() as NotificationSettings | undefined;
  const records = useRecords() as unknown as NotificationRecord[];
  const workspace = settings?.workspace?.id || "";
  const [clock, setClock] = useState(Date.now());
  const [readVersion, setReadVersion] = useState(0);
  useEffect(() => { const tick = () => setClock(Date.now()); const read = () => setReadVersion(v=>v+1); const timer = window.setInterval(tick, 60000); window.addEventListener("engx:chat-read", read); window.addEventListener("visibilitychange", tick); return () => { clearInterval(timer); window.removeEventListener("engx:chat-read", read); window.removeEventListener("visibilitychange", tick); }; }, []);
  const messages = useLiveQuery(async () => workspace ? chatDb.messages.where("workspace_id").equals(workspace).toArray() : [], [workspace], []);
  const watermark = Number(localStorage.getItem(readKey(workspace, String(settings?.activeDomain || "medical"))) || 0);
  const unread = messages.filter((m) => Number(m.seq) > watermark && m.sender_id !== settings?.user?.id && chatDomainMatches(m.domain, settings?.activeDomain));
  const refreshNative = () => { reconcileQueue = reconcileQueue.catch(() => undefined).then(() => settings ? reconcileNative(alerts, settings) : undefined); return reconcileQueue; };
  const alerts = useMemo(() => buildAlerts(records || [], settings, clock, unread), [records, settings, unread.length, readVersion, clock]);
  useEffect(() => { if (!options.background) return; void refreshNative().catch((e) => console.warn("EngX notifications:", e)); }, [alerts, settings?.workspace?.id, settings?.notificationPreferences, options.background]);
  useEffect(() => { if (!options.background) return; const rerun = () => { void refreshNative().catch(() => undefined); }; window.addEventListener("engx:chat-read", rerun); nativeListenerUsers += 1; if (Capacitor.isNativePlatform() && !nativeListenerPromise) nativeListenerPromise = LocalNotifications.addListener("localNotificationActionPerformed", (event: any) => { const extra = event?.notification?.extra || {}; window.dispatchEvent(new CustomEvent("engx:notification-open", { detail: { domain: extra.domain, screen: extra.screen || routeScreen(extra.category), orderId: extra.orderId, deviceId: extra.deviceId } })); }).then((x) => { nativeListenerHandle = x; return x; }); return () => { window.removeEventListener("engx:chat-read", rerun); nativeListenerUsers -= 1; if (nativeListenerUsers <= 0 && nativeListenerHandle) { void nativeListenerHandle.remove(); nativeListenerHandle = undefined; nativeListenerPromise = undefined; } }; }, [options.background]);
  const requestPermission = async () => { if (!Capacitor.isNativePlatform()) { const result = typeof Notification === "undefined" ? "unsupported" : await Notification.requestPermission(); return result; } const result = (await LocalNotifications.requestPermissions()).display; if (result === "granted") await refreshNative(); return result; };
  const refresh = async () => { await refreshNative(); };
  const savePreferences = async (patch: NotificationPreferences) => { await saveSettings({ notificationPreferences: { ...pref(settings), ...patch } } as any); };
  return { alerts, permission: "unknown", requestPermission, refresh, savePreferences };
}

export const notificationId = (alert: SmartAlert) => stable(alert.id);
