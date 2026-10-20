import "fake-indexeddb/auto";
import { beforeEach, describe, it, expect } from "vitest";
import {
  db,
  init,
  getSettings,
  createRecord,
  updateRecord,
  deleteRecord,
  usePart,
  submitOrder,
  approveOrder,
  validateImport,
  importRows,
  createBackup,
  restoreBackup,
  validateData,
  logActivity,
  undoImport,
  testBackupRoundtrip,
  widgetSnapshot,
  localDateTime,
  codeFor,
  recordCode,
  ensureRecordCodes,
} from "../src/lib";
import { encryptBackup, decryptBackup } from "../src/security";
const device = () =>
  createRecord("device", {
    name: "جهاز اختبار",
    asset_code: "TEST-001",
    status: "working",
  });
beforeEach(async () => {
  await db.delete();
  await db.open();
  Object.defineProperty(globalThis, "navigator", {
    value: { storage: { persist: async () => true }, onLine: false },
    configurable: true,
  });
  await init();
});
describe("offline storage and medical safety", () => {
  it("creates UUID records with pending sync and matching audit", async () => {
    const d = await device();
    expect(d.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(d.sync_status).toBe("pending");
    expect(await db.queue.count()).toBe(1);
    expect(
      (await db.audit.toArray()).some(
        (a) => a.entity_id === d.id && a.action === "create",
      ),
    ).toBe(true);
  });
  it("rejects duplicate asset codes case insensitive", async () => {
    await device();
    await expect(
      createRecord("device", { name: "آخر", asset_code: "test-001" }),
    ).rejects.toThrow("مستخدم");
    expect(await db.records.count()).toBe(1);
  });
  it("requires complete safety checklist and tests then freezes closed orders", async () => {
    const d = await device();
    const o = await createRecord("order", {
      device_id: d.id,
      description: "فحص",
    });
    await expect(submitOrder(o.id)).rejects.toThrow("السلامة");
    const s = await getSettings();
    await updateRecord(o.id, {
      tests: "نتائج حسب دليل الشركة",
      checklist: o.data.checklist.map((c: any) => ({
        ...c,
        checked: true,
        confirmed_by: s.user.id,
        confirmed_at: new Date().toISOString(),
      })),
    });
    await submitOrder(o.id);
    await approveOrder(o.id);
    expect((await db.records.get(o.id))?.data.status).toBe("closed");
    await expect(
      updateRecord(o.id, { description: "changed" }),
    ).rejects.toThrow("المغلق");
    await expect(deleteRecord(o.id)).rejects.toThrow("مغلق");
  });
  it("uses stock atomically and rejects negative or excess quantity", async () => {
    const d = await device();
    const o = await createRecord("order", { device_id: d.id });
    const p = await createRecord("part", {
      name: "فيوز",
      quantity: 5,
      min_quantity: 1,
    });
    await usePart(o.id, p.id, 2);
    expect((await db.records.get(p.id))?.data.quantity).toBe(3);
    expect(await db.records.where("type").equals("usage").count()).toBe(1);
    await expect(usePart(o.id, p.id, 4)).rejects.toThrow("كافية");
    await expect(usePart(o.id, p.id, -1)).rejects.toThrow("أكبر");
    expect((await db.records.get(p.id))?.data.quantity).toBe(3);
  });
  it("viewer cannot change local data", async () => {
    await db.settings.update("settings", { role: "viewer" });
    await expect(device()).rejects.toThrow("للقراءة");
  });
  it("prevents deletion of referenced devices", async () => {
    const d = await device();
    await createRecord("order", { device_id: d.id });
    await expect(deleteRecord(d.id)).rejects.toThrow("مرتبط");
  });
  it("records read/navigation activities without a mutable audit UI", async () => {
    await logActivity("screen_view", "screen", "devices");
    expect(
      (await db.audit.toArray()).some((a) => a.action === "screen_view"),
    ).toBe(true);
  });
  it("queues create then updates in chronological rather than random UUID order", async () => {
    const d = await device();
    await updateRecord(d.id, { name: "بعد التعديل الأول" });
    await updateRecord(d.id, { name: "بعد التعديل الثاني" });
    const queue = await db.queue.orderBy("queued_at").toArray();
    expect(queue.map((q) => q.base_version)).toEqual([0, 1, 2]);
    expect(queue[0].queued_at).toBeLessThan(queue[1].queued_at);
  });
  it("keeps stock consumption and its deduction adjacent in the queue", async () => {
    const d = await device();
    const o = await createRecord("order", { device_id: d.id });
    const p = await createRecord("part", { name: "قطعة", quantity: 4 });
    await usePart(o.id, p.id, 1);
    const q = await db.queue.orderBy("queued_at").toArray();
    expect(q.slice(-2).map((x) => x.entity_type)).toEqual(["usage", "part"]);
    expect(q.at(-1)?.record.data.quantity).toBe(3);
  });
});
describe("Excel validation", () => {
  it("maps arbitrary Arabic headers and flags duplicate or missing codes", async () => {
    const result = await validateImport(
      "device",
      [
        { اسم: "أ", كود: "1" },
        { اسم: "ب", كود: "1" },
        { اسم: "ج", كود: "" },
      ],
      { name: "اسم", asset_code: "كود" },
    );
    expect(result.valid).toHaveLength(1);
    expect(result.errors).toHaveLength(2);
  });
  it("rolls whole import back on an invalid record", async () => {
    await expect(
      importRows("device", [
        { name: "أ", asset_code: "1" },
        { name: "ب", asset_code: "1" },
      ]),
    ).rejects.toThrow();
    expect(await db.records.count()).toBe(0);
  });
  it("requires user-defined PM interval and resolves device code", async () => {
    await device();
    const r = await validateImport(
      "plan",
      [{ code: "TEST-001", interval: "30", date: "2026-12-01" }],
      { device_code: "code", interval_days: "interval", next_due: "date" },
    );
    expect(r.errors).toHaveLength(0);
    expect(r.valid[0].device_id).toBeTruthy();
    expect(() =>
      validateData("plan", { device_id: "x", interval_days: 0, next_due: "x" }),
    ).toThrow();
  });
});
describe("portable encrypted backup", () => {
  it("encrypts, rejects wrong password and detects altered ciphertext", async () => {
    const b = await encryptBackup(
      { secret: "not plaintext" },
      "strong-test-password",
    );
    const text = await b.text();
    expect(text).not.toContain("not plaintext");
    expect(await decryptBackup(text, "strong-test-password")).toEqual({
      secret: "not plaintext",
    });
    await expect(decryptBackup(text, "incorrect")).rejects.toThrow();
    const p = JSON.parse(text);
    p.data = (p.data[0] === "A" ? "B" : "A") + p.data.slice(1);
    await expect(
      decryptBackup(JSON.stringify(p), "strong-test-password"),
    ).rejects.toThrow();
  });
  it("requires a long backup password", async () => {
    await expect(encryptBackup({}, "123")).rejects.toThrow("10");
  });
  it("restores all records and attachments without session secrets", async () => {
    const d = await device();
    await createRecord("attachment", {
      entity_id: d.id,
      content: "data:text/plain;base64,SGVsbG8=",
      name: "test.txt",
    });
    const b = await createBackup("backup-password");
    const p = await decryptBackup(await b.text(), "backup-password");
    expect(p.token).toBeUndefined();
    await db.records.clear();
    await restoreBackup(p);
    expect(await db.records.count()).toBe(2);
    expect((await getSettings()).cloudEnabled).toBe(false);
    expect((await getSettings()).token).toBeUndefined();
  });
});

describe('smooth entry and portability',()=>{
 it('automatically timestamps faults locally and audits earlier discovery edits',async()=>{const d=await device();const order=await createRecord('order',{device_id:d.id,description:'بلاغ تجريبي'});expect(order.data.detected_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);expect(order.data.detected_at).toBe(localDateTime());const edited=await updateRecord(order.id,{detected_at:'2026-01-01T08:30'});expect(edited.created_at).toBe(order.created_at);const changes=await db.audit.toArray();expect(changes.some(a=>a.entity_id===order.id&&a.before?.detected_at===order.data.detected_at&&a.after?.detected_at==='2026-01-01T08:30')).toBe(true);});
 it('keeps nonessential device fields optional without claiming working status',async()=>{const r=await importRows('device',[{name:'اسم فقط مع كود',asset_code:'OPT-1'}]);expect(r.count).toBe(1);const rows=await db.records.toArray();expect(rows[0].data.manufacturer).toBeUndefined();expect(rows[0].data.status).not.toBe('working');});
 it('undoes untouched imported records but preserves later changes',async()=>{const batch=await importRows('device',[{name:'أ',asset_code:'A'},{name:'ب',asset_code:'B'}]);const rows=await db.records.toArray();const changed=rows.find(r=>r.data.asset_code==='B')!;await updateRecord(changed.id,{location:'تم تعديله'});const result=await undoImport(batch.batch_id);expect(result.undone).toBe(1);expect(result.skipped).toHaveLength(1);expect((await db.records.get(changed.id))?.deleted_at).toBeNull();});
 it('requires actual calibration reference and result with no default measurements',async()=>{const d=await device();await expect(createRecord('calibration',{device_id:d.id,performed_at:'2026-01-01'})).rejects.toThrow();const r=await createRecord('calibration',{device_id:d.id,performed_at:'2026-01-01',reference:'مرجع المستخدم',result:'نتيجة المستخدم'});expect(r.data.next_due).toBeUndefined();});
 it('roundtrip-tests backup in a separate database without changing source records',async()=>{await device();const before=JSON.stringify(await db.records.toArray());const result=await testBackupRoundtrip('roundtrip-test-pass');expect(result.verified).toBe(true);expect(result.records).toBe(1);expect(JSON.stringify(await db.records.toArray())).toBe(before);});
 it('publishes only opt-in cached widget summaries and clears disabled titles',async()=>{const d=await device();await createRecord('order',{device_id:d.id});await createRecord('plan',{device_id:d.id,interval_days:7,next_due:'2020-01-01',reference:'TEST ONLY'});const rows=await db.records.toArray();const hidden=widgetSnapshot(rows,false);expect(hidden.upcoming).toHaveLength(0);expect(hidden.openOrders).toBe(0);const visible=widgetSnapshot(rows,true);expect(visible.openOrders).toBe(1);expect(visible.pmDue).toBe(1);expect(visible.upcoming[0].title).toContain('TEST-001');expect(JSON.stringify(visible)).not.toContain('token');});
});


describe("immutable deterministic record codes", () => {
  it("encodes UUIDs stably with every entity prefix", async () => {
    const ids = new Set<string>();
    const cases: Array<[any, any]> = [
      ["device", { name: "d", asset_code: "C" }], ["order", { device_id: "missing" }],
      ["part", { name: "p" }], ["plan", { device_id: "missing", interval_days: 1, next_due: "2027-01-01" }],
      ["event", { title: "e", at: "2027-01-01" }], ["usage", {}], ["correction", {}],
      ["attachment", { name: "a" }], ["calibration", { device_id: "missing", performed_at: "2027-01-01", reference: "r", result: "x" }],
      ["sale", { document_title: "s", items: [] }], ["purchase", { document_title: "p", items: [] }], ["report", { title: "r" }],
    ];
    for (const [type] of cases) {
      const id = crypto.randomUUID(); const code = codeFor(type, id);
      expect(code).toMatch(/^[A-Z]+-[0-9A-HJKMNP-TV-Z]{26}$/); expect(ids.has(code)).toBe(false); ids.add(code);
    }
    expect(codeFor("device", "server-d1")).toBe("DEV-SERVER_D1");
  });
  it("creates immutable codes and backfills legacy rows without defaults", async () => {
    const d = await device();
    expect(recordCode(d)).toBe(d.data.record_code);
    await expect(updateRecord(d.id, { record_code: "DEV-CHANGED" })).rejects.toThrow("ثابت");
    const legacy = { ...d, id: "legacy-d1", data: { name: "legacy", asset_code: "LEGACY" }, created_at: "2000-01-01", updated_at: "2000-01-01" };
    await db.records.put(legacy);
    await ensureRecordCodes();
    const restored = await db.records.get("legacy-d1");
    expect(restored?.data.record_code).toBe("DEV-LEGACY_D1");
    expect(restored?.data.status).toBeUndefined();
  });
});
