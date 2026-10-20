import { useState } from "react";
import type { Settings } from "./lib";
import { useSmartNotifications, type NotificationSettings, type NotificationCategory } from "./notifications";
import "./notification-panel.css";

type Props = { settings?: NotificationSettings | Settings; notify?: (message: string) => void };
const labels: Record<NotificationCategory, string> = { maintenance: "الصيانة", calibration: "المعايرة", stock: "المخزون", approvals: "الاعتمادات", assignments: "التكليفات", messages: "الرسائل" };

export default function NotificationPanel({ settings, notify }: Props) {
  const api = useSmartNotifications({ background: false });
  const [open, setOpen] = useState(true);
  const prefs = { enabled: true, showDetails: false, daysBefore: 7, nativeEnabled: true, ...(settings?.notificationPreferences || {}) };
  const set = (patch: Record<string, unknown>) => void api.savePreferences(patch as any).catch((e) => notify?.(e instanceof Error ? e.message : "تعذر حفظ الإعدادات"));
  const request = async () => { const result = await api.requestPermission(); notify?.(result === "granted" ? "تم السماح بالإشعارات" : "لم يتم السماح بالإشعارات"); };
  return <section className="notification-panel" aria-label="الإشعارات الذكية">
    <header className="notification-panel-head"><div><h2>الإشعارات الذكية</h2><p>تنبيهات داخل التطبيق مع حماية التفاصيل افتراضياً. نص إشعارات النظام يظل عامًا.</p></div><button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? "طي" : "عرض"}</button></header>
    {open && <>
      <div className="notification-preferences">
        <label><input type="checkbox" checked={prefs.enabled !== false} onChange={(e) => set({ enabled: e.target.checked })} /> تفعيل الإشعارات</label>
        <label><input type="checkbox" checked={Boolean(prefs.showDetails)} onChange={(e) => set({ showDetails: e.target.checked })} /> إظهار التفاصيل داخل مركز الإشعارات فقط</label>
        <label><input type="checkbox" checked={prefs.nativeEnabled !== false} onChange={(e) => set({ nativeEnabled: e.target.checked })} /> جدولة الإشعارات الأصلية</label>
        <label>التنبيه قبل الموعد (أيام)<input type="number" min={0} max={90} value={Number(prefs.daysBefore)} onChange={(e) => set({ daysBefore: Math.max(0, Math.min(90, Number(e.target.value) || 0)) })} /></label>
        <div className="notification-categories">{(Object.keys(labels) as NotificationCategory[]).map((category) => <label key={category}><input type="checkbox" checked={prefs[category] !== false} onChange={(e) => set({ [category]: e.target.checked })} /> {labels[category]}</label>)}</div>
        <button type="button" className="notification-permission" onClick={() => void request()}>السماح بالإشعارات على هذا الجهاز</button>
      </div>
      <div className="notification-list" aria-live="polite">{api.alerts.length === 0 ? <p className="notification-empty">لا توجد تنبيهات حالياً.</p> : api.alerts.map((alert) => <button type="button" className={`notification-item ${alert.level}`} key={alert.id} onClick={() => window.dispatchEvent(new CustomEvent("engx:notification-open", { detail: { domain: alert.domain, screen: alert.category === "messages" ? "chat" : alert.category === "stock" ? "inventory" : ["approvals","assignments"].includes(alert.category) ? "orders" : "devices", orderId: alert.orderId, deviceId: alert.deviceId } }))}><strong>{alert.title}</strong><span>{alert.body}</span></button>)}</div>
    </>}
  </section>;
}
