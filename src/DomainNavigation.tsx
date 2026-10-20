import ClearableInput from './ClearableInput';
import { useMemo, useState, type FormEvent } from "react";
import { HeartPulse, Smartphone, House, Monitor, Cpu, Wrench, ShoppingBag, ArrowLeftRight, Plus, ArchiveRestore, Archive, Pencil } from "lucide-react";
import { getDomains, normalizeDomain, type DomainId, type SectionDefinition } from "./domains";
import * as lib from "./lib";
import "./domains.css";

const icons: Record<string, any> = { medical: HeartPulse, mobiles: Smartphone, appliances: House, screens: Monitor, electronics: Cpu, workshops: Wrench, sales: ShoppingBag };
const MAX_LABEL = 80;
const sectionList = (settings?: any, includeArchived = false) => getDomains(settings?.sectionDefinitions, includeArchived);

export function DomainSelect({ value, onChange, disabled = false, id = "section-navigation" }: { value?: string; onChange: (domain: DomainId) => void; disabled?: boolean; id?: string }) {
  const settings = lib.useSettings() as any;
  const definitions = useMemo(() => sectionList(settings), [settings?.sectionDefinitions]);
  const selected = normalizeDomain(value);
  return <label className="domain-select" htmlFor={id}><ArrowLeftRight size={17}/><span>القسم</span><select id={id} aria-label="التنقل بين الأقسام" value={selected} disabled={disabled} onChange={e => onChange(normalizeDomain(e.target.value))}>{definitions.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>;
}

function SectionRename({ section, busy, onSave }: { section: SectionDefinition; busy: boolean; onSave: (label: string) => Promise<void> }) {
  const [draft, setDraft] = useState(section.label);
  const [editing, setEditing] = useState(false);
  if (!editing) return <button type="button" className="section-edit-button" onClick={() => { setDraft(section.label); setEditing(true); }} disabled={busy}><Pencil size={14}/> تعديل الاسم</button>;
  return <form className="section-rename" onSubmit={async e => { e.preventDefault(); const label = draft.trim(); if (!label || label.length > MAX_LABEL) return; await onSave(label); setEditing(false); }}><ClearableInput aria-label={`اسم ${section.label}`} maxLength={MAX_LABEL} value={draft} onChange={e => setDraft(e.target.value)} autoFocus/><button type="submit" className="btn" disabled={busy || !draft.trim()}>حفظ</button><button type="button" className="btn secondary" onClick={() => setEditing(false)} disabled={busy}>إلغاء</button></form>;
}

function SectionManagement({ settings, notify }: { settings: any; notify?: (message: string) => void }) {
  const [label, setLabel] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const definitions = sectionList(settings, true);
  const message = (error: unknown, fallback: string) => notify?.(error instanceof Error ? error.message : fallback);
  const add = async (e: FormEvent) => { e.preventDefault(); const next = label.trim(); if (!next || next.length > MAX_LABEL) return; setAdding(true); try { await lib.addSection(next); setLabel(""); notify?.("تمت إضافة القسم. سجلاته معزولة عن الأقسام الأخرى ضمن نفس الحساب."); } catch (error) { message(error, "تعذر إضافة القسم."); } finally { setAdding(false); } };
  const rename = async (id: string, next: string) => { setBusyId(id); try { await lib.renameSection(id, next); notify?.("تم تغيير اسم القسم."); } catch (error) { message(error, "تعذر تغيير اسم القسم."); } finally { setBusyId(null); } };
  const toggleArchive = async (section: SectionDefinition) => { if (section.id === "medical") return; setBusyId(section.id); try { await lib.setSectionArchived(section.id, !section.archived); notify?.(section.archived ? "تمت إعادة تفعيل القسم." : "تمت أرشفة القسم."); } catch (error) { message(error, "تعذر تحديث حالة القسم."); } finally { setBusyId(null); } };
  return <section className="section-management" aria-labelledby="section-management-title"><div className="section-management-heading"><div><h4 id="section-management-title">إدارة الأقسام</h4><p>أضف أقسامًا جديدة بنفس بنية العمل والمصطلحات. لكل قسم سجلاته المعزولة، بينما الحساب ومساحة العمل والفريق والنسخ الاحتياطي مشتركة.</p></div><span className="owner-badge">للمالك فقط</span></div><form className="section-add-form" onSubmit={add}><label htmlFor="new-section-label">اسم القسم<ClearableInput id="new-section-label" value={label} maxLength={MAX_LABEL} onChange={e => setLabel(e.target.value)} placeholder="مثال: خدمات الشبكات" /></label><button type="submit" className="btn" disabled={adding || !label.trim()}><Plus size={16}/>{adding ? "جارٍ الإضافة…" : "إضافة قسم"}</button></form><small className="section-hint">حتى {MAX_LABEL} حرفًا. لا توجد عناصر تحكم خاصة بالمخطط؛ الأقسام الجديدة تتبع نفس البنية.</small>{settings.sectionChanges?.length > 0 && <p role="status" className="section-hint">تعديلات الأقسام محفوظة محليًا. اضغط مزامنة بعد الاتصال لظهورها عند الفريق؛ يلزم تحديث الخادم.</p>}<div className="managed-sections">{definitions.map(section => { const busy = busyId === section.id; return <div className={`managed-section ${section.archived ? "is-archived" : ""}`} key={section.id}><div><strong>{section.label}</strong>{section.archived && <span className="archived-label">مؤرشف</span>}<small>{section.description}</small></div><div className="managed-section-actions"><SectionRename section={section} busy={busy} onSave={next => rename(section.id, next)}/>{section.id !== "medical" && <button type="button" className="section-edit-button" disabled={busy} onClick={() => void toggleArchive(section)}>{section.archived ? <ArchiveRestore size={14}/> : <Archive size={14}/>} {section.archived ? "إعادة تفعيل" : "أرشفة"}</button>}</div></div>; })}</div></section>;
}

export function ProfileDomain({ settings, notify }: any) {
  const live = (lib.useSettings() as any) || settings;
  const [busy, setBusy] = useState(false);
  const change = async (id: DomainId) => { setBusy(true); try { await lib.switchDomain(id); localStorage.setItem(`engx-domain-entered:${live.workspace.id}`, "yes"); notify?.("تم الانتقال للقسم؛ بيانات كل قسم مستقلة"); } catch (e: any) { notify?.(e.message); } finally { setBusy(false); } };
  const isOwner = live.role === "owner";
  return <section className="card profile-domain"><h3>القسم في ملفك الشخصي</h3><p>اختار القسم اللي بتشتغل فيه. الأجهزة وأوامر الشغل والمخزون والمستندات المعروضة تخص القسم المختار فقط، وتقدر ترجع لأي قسم في أي وقت.</p><DomainSelect id="profile-section" value={live.activeDomain} onChange={change} disabled={busy}/><small>نفس الحساب ومساحة العمل، بدون حذف بيانات الأقسام الأخرى. إعدادات الحساب والفريق والنسخ الاحتياطي مشتركة.</small>{isOwner && <SectionManagement settings={live} notify={notify}/>}</section>;
}

export function DomainEntry({ onEnter, onOwner }: { onEnter: (domain: DomainId) => Promise<void>; onOwner?: () => void }) {
  const settings = lib.useSettings() as any;
  const definitions = sectionList(settings);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const choose = async (id: DomainId) => { setBusy(true); setError(""); try { await onEnter(id); } catch (e: any) { setError(e.message); setBusy(false); } };
  return <div className="modal-backdrop domain-entry-backdrop"><section className="modal domain-entry" role="dialog" aria-modal="true" aria-label="اختيار قسم العمل"><div className="domain-intro"><span className="domain-logo">EngX</span><h1>اختار قسمك وادخل على شغلك</h1><p>كل قسم له أجهزته وأوامر شغله ومخزونه وعمليات البيع والشراء الخاصة به.</p></div>{onOwner && <button type="button" className="btn" onClick={onOwner}>دخول لوحة المالك والمساعدين</button>}<div className="domain-grid">{definitions.map(d => { const Icon = icons[d.id] || Wrench; return <button key={d.id} className="domain-card" disabled={busy} onClick={() => void choose(d.id)}><Icon size={28}/><b>{d.label}</b><span>{d.description}</span><strong>الدخول للقسم ←</strong></button>; })}</div><p className="muted">تقدر تغير القسم من الشريط العلوي أو الملف الشخصي. بياناتك القديمة محفوظة في قسم الأجهزة الطبية.</p>{busy && <p role="status">جارٍ فتح القسم…</p>}{error && <p role="alert" className="notice error">{error}</p>}</section></div>;
}
