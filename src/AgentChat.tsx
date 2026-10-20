import ClearableInput from './ClearableInput';
import { useMemo, useRef, useState } from "react";
import * as lib from "./lib";
import type { RecordRow } from "./lib";
import { parseAction, parseModelAction, type Action } from "./agentActions";
import LocalAI from "./LocalAI";
import "./agent-chat.css";

const AI = LocalAI as any;
type Message = { id: string; from: "user" | "assistant"; text: string };
type Props = { notify?: (message: string) => void; onNavigate?: (screen: string) => void };
const blocked = "هذا الإجراء غير مدعوم هنا. افتح الشاشة المخصصة للتنفيذ واتبع قائمة التحقق واطلب اعتماد المسؤول.";
const safeRow = (r: RecordRow) => ({ id: r.id, type: r.type, code: lib.recordCode(r), name: typeof r.data?.name === "string" ? r.data.name : undefined, title: typeof r.data?.title === "string" ? r.data.title : undefined, description: typeof r.data?.description === "string" ? r.data.description : undefined, status: typeof r.data?.status === "string" ? r.data.status : undefined });
const label = (a: Action) => a.action === "create_device" ? `إضافة جهاز: ${a.args.name} — ${a.args.asset_code}` : a.action === "create_order" ? `فتح أمر صيانة للجهاز ${a.args.device_code}: ${a.args.description}` : a.action === "prepare_report" ? `تجهيز تقرير: ${a.args.title}` : a.action === "search" ? `بحث عن: ${a.args.query}` : `فتح: ${a.args.screen}`;

export default function AgentChat({ notify, onNavigate }: Props) {
  const settings = lib.useSettings();
  const records = lib.useRecords();
  const [messages, setMessages] = useState<Message[]>([]), [input, setInput] = useState(""), [proposal, setProposal] = useState<Action | null>(null), [notice, setNotice] = useState(""), [deviceChoice, setDeviceChoice] = useState("");
  const lock = useRef(false);
  const say = (text: string) => setMessages(m => [...m, { id: crypto.randomUUID(), from: "assistant", text }]);
  const inform = (text: string) => { setNotice(text); notify?.(text); say(text); };
  const runSearch = (query: string) => {
    const q = query.toLocaleLowerCase();
    const rows = records.filter(r => JSON.stringify(safeRow(r)).toLocaleLowerCase().includes(q)).sort((a,b) => lib.recordCode(a).localeCompare(lib.recordCode(b)));
    if (!rows.length) { say("لم أجد نتائج في السجلات الحالية."); return; }
    say(`نتائج البحث (${rows.length}):\n${rows.map(r => `${lib.recordCode(r)} — ${r.data?.name || r.data?.title || r.data?.description || r.type} [${r.type}]`).join("\n")}`);
  };
  const propose = (a: Action) => { if (a.action === "search") { runSearch(a.args.query); return; } if (a.action === "navigate") { onNavigate?.(a.args.screen); say(`تم فتح ${a.args.screen}.`); return; } setDeviceChoice(""); setProposal(a); say(`معاينة فقط — ${label(a)}\nراجع الحقول ثم اضغط «تأكيد التنفيذ».`); };
  const submitInput = () => {
    const text = input.trim(); if (!text) return;
    setMessages(m => [...m, { id: crypto.randomUUID(), from: "user", text }]); setInput("");
    const a = parseAction(text); if (a) { propose(a); return; }
    if (/احذف|امسح|اغلق|أغلق|صلاحيات|وصول|اعتماد نهائي|اغلاق نهائي/i.test(text)) { say(blocked); return; }
    say("لم أفهم أمرًا محليًا محددًا. جرّب: أضف جهاز، افتح أمر صيانة، ابحث عن، أو جهز تقرير.");
  };
  const deviceCandidates = records.filter(r => r.type === "device");
  const deviceMatches = useMemo(() => {
    if (!proposal || proposal.action !== "create_order") return [];
    const q = proposal.args.device_code.toLocaleLowerCase();
    return records.filter(r => r.type === "device" && [r.id, lib.recordCode(r), r.data?.asset_code, r.data?.name].some(v => String(v || "").toLocaleLowerCase() === q));
  }, [proposal, records]);
  const confirm = async () => {
    if (!proposal || lock.current) return; lock.current = true;
    try {
      const current = await lib.getSettings();
      if (!settings || (current.workspace.id !== settings.workspace.id || current.activeDomain !== settings.activeDomain)) { setProposal(null); throw Error("تغيرت مساحة العمل؛ أعد الطلب واحصل على تأكيد جديد"); }
      if (current.role === "viewer") throw Error("حسابك للقراءة فقط");
      let row: RecordRow;
      if (proposal.action === "create_device") row = await lib.createRecord("device", { name: proposal.args.name, asset_code: proposal.args.asset_code });
      else if (proposal.action === "create_order") {
        const q = proposal.args.device_code.toLocaleLowerCase();
        const matches = records.filter(r => r.type === "device" && [r.id, lib.recordCode(r), r.data?.asset_code, r.data?.name].some(v => String(v || "").toLocaleLowerCase() === q));
        if (matches.length !== 1) throw Error(matches.length ? "يطابق الطلب أكثر من جهاز؛ اختر الجهاز يدويًا" : "الجهاز غير معروف في مساحة العمل");
        row = await lib.createRecord("order", { device_id: matches[0].id, description: proposal.args.description });
      } else if (proposal.action === "prepare_report") {
        const currentRows = records;
        const devices = currentRows.filter(r => r.type === "device"), orders = currentRows.filter(r => r.type === "order");
        row = await lib.createRecord("report", { title: proposal.args.title, metrics: { devices: devices.length, orders: orders.length, open_orders: orders.filter(r => r.data?.status !== "closed").length }, source_ids: currentRows.map(r => r.id) });
      } else throw Error("هذا الإجراء غير مدعوم");
      await lib.logActivity("assistant_action_completed", row.type, row.id, null, { action: proposal.action, workspace_id: current.workspace.id });
      setProposal(null); say(`تم التنفيذ وحفظ السجل ${lib.recordCode(row)}. هذه لقطة من السجلات الحالية وليست تقريرًا خارجيًا.`);
    } catch (e: any) { inform(e?.message || "تعذر التنفيذ؛ لم يتم إنشاء سجل"); } finally { lock.current = false; }
  };
  const onAgentReply = (reply: string, request?: string) => { setMessages(m => [...m, ...(request ? [{ id: crypto.randomUUID(), from: "user" as const, text: request }] : []), { id: crypto.randomUUID(), from: "assistant", text: reply }]); const a = parseModelAction(reply); if (a) propose(a); };
  return <section className="agent-chat" dir="rtl" aria-label="محادثة خاصة للجلسة">
    <header><h2>مساعد الأوامر</h2><span className="agent-label">أوامر محلية بدون نموذج — صياغات محددة</span><p>جلسة خاصة — لا تُنشر للفريق. السجلات المنفذة دائمة وتخضع للتدقيق.</p></header>
    <div className="agent-messages">{messages.map(m => <div key={m.id} className={`agent-message ${m.from}`}>{m.text}</div>)}</div>
    <div className="agent-compose"><ClearableInput value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && submitInput()} placeholder="مثال: ابحث عن EQ-010" aria-label="الأمر"/><button className="primary" onClick={submitInput}>إرسال</button></div>
    {proposal && <div className="agent-proposal"><strong>معاينة قبل التنفيذ</strong><ClearableInput value={proposal.action === "create_device" ? proposal.args.name : proposal.action === "create_order" ? proposal.args.description : proposal.action === "prepare_report" ? proposal.args.title : ""} onChange={e => setProposal(p => !p ? p : p.action === "create_device" ? {...p,args:{...p.args,name:e.target.value}} : p.action === "create_order" ? {...p,args:{...p.args,description:e.target.value}} : p.action === "prepare_report" ? {...p,args:{...p.args,title:e.target.value}} : p)} />{proposal.action === "create_order" && deviceMatches.length !== 1 && <><p>اختر الجهاز يدويًا قبل التنفيذ:</p><select value={deviceChoice} onChange={e => { const r = deviceCandidates.find(x => x.id === e.target.value); setDeviceChoice(e.target.value); if (r) setProposal(p => p?.action === "create_order" ? {...p,args:{...p.args,device_code:lib.recordCode(r)}} : p); }}><option value="">اختر جهازًا</option>{deviceCandidates.map(r => <option key={r.id} value={r.id}>{lib.recordCode(r)} — {r.data?.name || r.data?.asset_code || r.id}</option>)}</select></> }<button className="primary" disabled={proposal.action === "create_order" && deviceMatches.length !== 1} onClick={() => void confirm()}>تأكيد التنفيذ</button><button className="secondary" onClick={() => setProposal(null)}>إلغاء</button></div>}
    {notice && <p role="status">{notice}</p>}
    <AI agentMode onAgentReply={onAgentReply} messages={messages.map(m => ({ id: m.id, text: m.text, sender_name: m.from, created_at: new Date().toISOString() }))} notify={notify} />
  </section>;
}
