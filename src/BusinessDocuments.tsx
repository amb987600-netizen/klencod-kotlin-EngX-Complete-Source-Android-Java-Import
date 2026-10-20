import ClearableInput from './ClearableInput';
import { useMemo, useState } from "react";
import * as lib from "./lib";
import "./business.css";

type DocType = "sale" | "purchase" | "report";
const api = lib as any;
const money = (n: any, currency = "") => `${Number(n || 0).toFixed(2)}${currency ? ` ${currency}` : ""}`;
const safe = (v: any) => String(v ?? "").replace(/[<>]/g, "");

export default function BusinessDocuments({ notify, q = "" }: { notify?: (message: string) => void; q?: string }) {
  const records = (lib.useRecords() || []) as any[];
  const settings = lib.useSettings();
  const role = settings?.role;
  const canWrite = role === "owner" || role === "admin";
  const [tab, setTab] = useState<DocType>("sale");
  const [sortAsc, setSortAsc] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const [title, setTitle] = useState("");
  const [party, setParty] = useState("");
  const [currency, setCurrency] = useState("");
  const [items, setItems] = useState([{ description: "", qty: "1", unit_price: "0" }]);
  const [message, setMessage] = useState("");
  const docs = useMemo(() => records.filter(r => ["sale", "purchase", "report"].includes(r.type)), [records]);
  const visible = useMemo(() => docs.filter(r => {
    if (r.type !== tab) return false;
    if (!q.trim()) return true;
    return JSON.stringify(r).toLocaleLowerCase().includes(q.toLocaleLowerCase());
  }).sort((a,b) => {
    const d = String(a.created_at).localeCompare(String(b.created_at));
    return sortAsc ? d : -d;
  }), [docs, tab, q, sortAsc]);
  const code = (row: any) => (api.recordCode ? api.recordCode(row) : row?.data?.record_code || row?.id || "—");
  const reset = () => { setEditing(null); setTitle(""); setParty(""); setCurrency(""); setItems([{ description: "", qty: "1", unit_price: "0" }]); };
  const openEdit = (row: any) => { setEditing(row); setTitle(row.data.title || ""); setParty(row.data.party || ""); setCurrency(row.data.currency || ""); setItems((row.data.items || []).map((x: any) => ({ description: x.description || "", qty: String(x.qty ?? "1"), unit_price: String(x.unit_price ?? "0") })) || [{ description: "", qty: "1", unit_price: "0" }]); };
  const total = items.reduce((n, x) => n + (Number(x.qty) > 0 && Number(x.unit_price) >= 0 ? Number(x.qty) * Number(x.unit_price) : 0), 0);
  const save = async (status: "draft" | "completed") => {
    if (!title.trim()) return setMessage("العنوان مطلوب");
    if (!currency.trim()) return setMessage("العملة مطلوبة (مثال: EGP)");
    if (items.some(x => !Number.isFinite(Number(x.qty)) || Number(x.qty) <= 0 || !Number.isFinite(Number(x.unit_price)) || Number(x.unit_price) < 0)) return setMessage("تحقق من الكمية والسعر في البنود");
    const data = { title: title.trim(), party: party.trim(), currency: currency.trim(), items: items.filter(x => x.description.trim()).map(x => ({ description: x.description.trim(), qty: Number(x.qty), unit_price: Number(x.unit_price) })), total, status };
    try { if (editing) { if (editing.data.status !== "draft") return setMessage("لا يمكن تعديل مستند مكتمل"); await api.updateRecord(editing.id, data); } else await api.createRecord(tab, data); notify?.("تم حفظ المستند"); setMessage("تم الحفظ"); reset(); } catch (e: any) { setMessage(e.message || "تعذر الحفظ"); }
  };
  const print = async (row: any) => { setSelected(row); setTimeout(() => void api.printReport?.().catch((e: any) => setMessage(e.message)), 0); };
  return <section className="business-documents" dir="rtl">
    <header className="business-head"><div><h2>المستندات التجارية</h2><p>سجلات داخلية فقط — لا تنشئ دفعة أو قيداً مالياً خارجياً.</p></div>{selected && <button className="secondary" onClick={() => setSelected(null)}>إغلاق المعاينة</button>}</header>
    {selected ? <article className="business-print-area"><div className="print-code">الكود: {safe(code(selected))}</div><h1>{safe(selected.data.title)}</h1><p>{safe(selected.data.party)} {selected.data.currency && `• ${safe(selected.data.currency)}`}</p><p>التاريخ: {new Date(selected.created_at).toLocaleString("ar-EG")}</p><h3>الإجمالي: {money(selected.data.total, selected.data.currency)}</h3><button className="primary no-print" onClick={() => void api.printReport?.()}>طباعة / PDF</button></article> : <>
      <nav className="business-tabs">{(["sale", "purchase", "report"] as DocType[]).map(t => <button key={t} className={tab === t ? "active" : ""} onClick={() => { setTab(t); reset(); }}>{t === "sale" ? "أوامر البيع" : t === "purchase" ? "أوامر الشراء" : "التقارير"}</button>)}</nav>
      {tab !== "report" && canWrite && <form className="business-card" onSubmit={e => { e.preventDefault(); void save("draft"); }}><div className="form-grid"><label>النوع<select value={tab} onChange={e => setTab(e.target.value as DocType)}><option value="sale">أمر بيع</option><option value="purchase">أمر شراء</option></select></label><label>العنوان *<ClearableInput value={title} onChange={e => setTitle(e.target.value)} required /></label><label>الطرف<ClearableInput value={party} onChange={e => setParty(e.target.value)} /></label><label>العملة *<ClearableInput value={currency} onChange={e => setCurrency(e.target.value)} placeholder="EGP" required /></label></div><div className="items-head"><b>البنود الاختيارية</b><button type="button" className="link-button" onClick={() => setItems([...items, { description: "", qty: "1", unit_price: "0" }])}>+ بند</button></div>{items.map((x,i) => <div className="item-row" key={i}><ClearableInput placeholder="الوصف" value={x.description} onChange={e => setItems(items.map((a,j) => j===i ? {...a,description:e.target.value}:a))}/><input type="number" step="any" min="0.000001" placeholder="الكمية" value={x.qty} onChange={e => setItems(items.map((a,j) => j===i ? {...a,qty:e.target.value}:a))}/><input type="number" step="any" min="0" placeholder="سعر الوحدة" value={x.unit_price} onChange={e => setItems(items.map((a,j) => j===i ? {...a,unit_price:e.target.value}:a))}/>{items.length > 1 && <button type="button" className="icon-button" onClick={() => setItems(items.filter((_,j)=>j!==i))}>×</button>}</div>)}<div className="form-actions"><strong>الإجمالي: {money(total, currency)}</strong><button type="submit" className="secondary">حفظ كمسودة</button><button type="button" className="primary" onClick={() => void save("completed")}>حفظ وإكمال</button></div>{editing && <button type="button" className="link-button" onClick={reset}>إلغاء التعديل</button>}</form>}
      {!canWrite && <div className="business-note">وضع القراءة فقط: لا يمكن إضافة مستندات.</div>}
      {message && <div className="business-note">{message}</div>}
      <div className="business-table-wrap"><table className="business-table"><thead><tr><th onClick={() => setSortAsc(!sortAsc)}>م {sortAsc ? "↑" : "↓"}</th><th>الكود</th><th>التاريخ</th><th>العنوان</th><th>الطرف</th><th>الإجمالي / الحالة</th><th>إجراء</th></tr></thead><tbody>{visible.map((r,i) => <tr key={r.id}><td>{i+1}</td><td><code>{code(r)}</code></td><td>{new Date(r.created_at).toLocaleString("ar-EG")}</td><td>{safe(r.data.title)}</td><td>{safe(r.data.party) || "—"}</td><td>{r.type === "report" ? "تقرير" : `${money(r.data.total, r.data.currency)} • ${r.data.status === "completed" ? "مكتمل" : "مسودة"}`}</td><td><button className="link-button" onClick={() => setSelected(r)}>عرض / طباعة</button>{canWrite && r.type !== "report" && r.data.status === "draft" && <button className="link-button" onClick={() => openEdit(r)}>تعديل</button>}</td></tr>)}</tbody></table>{!visible.length && <div className="business-empty">لا توجد سجلات.</div>}</div>
    </>}
  </section>;
}
