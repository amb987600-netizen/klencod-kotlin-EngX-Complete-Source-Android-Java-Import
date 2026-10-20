import ClearableInput, {ClearableTextarea} from './ClearableInput';
import { useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { normalizeDomain, sectionAssetName, sectionAssetFields } from "./domains";
import * as lib from "./lib";
import type { EntityType, RecordRow } from "./lib";
import "./profile.css";

type Props = {
  row: RecordRow;
  close: () => void;
  notify?: (message: string) => void;
  onNewOrder?: (row: RecordRow) => void;
};
const calibrationType = "calibration" as EntityType;
const say = (notify: Props["notify"], message: string) => notify?.(message);
const fmt = (v: any) => (v ? new Date(v).toLocaleString("ar-EG") : "—");

export default function DeviceProfile({
  row,
  close,
  notify,
  onNewOrder,
}: Props) {
  const all = lib.useRecords();
  const settings = lib.useSettings();
  const domain = normalizeDomain(row.domain);
  const assetName = sectionAssetName(domain);
  const [tab, setTab] = useState("overview");
  const [showCalibration, setShowCalibration] = useState(false);
  const [calibration, setCalibration] = useState<any>({
    performed_at: "",
    next_due: "",
    reference: "",
    result: "",
    notes: "",
  });
  const [qr, setQr] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);
  const device = all.find((r) => r.id === row.id && r.type === "device") || row;
  const orders = all.filter(
    (r) => r.type === "order" && r.data.device_id === device.id,
  );
  const plans = all.filter(
    (r) => r.type === "plan" && r.data.device_id === device.id,
  );
  const calibrations = all
    .filter((r) => r.type === calibrationType && r.data.device_id === device.id)
    .sort((a, b) =>
      String(b.data.performed_at || b.created_at).localeCompare(
        String(a.data.performed_at || a.created_at),
      ),
    );
  const usages = all.filter(
    (r) => r.type === "usage" && orders.some((o) => o.id === r.data.order_id),
  );
  const parts = all.filter((r) => r.type === "part");
  const documents = all.filter(
    (r) =>
      r.type === "attachment" &&
      (r.data.entity_id === device.id ||
        orders.some((o) => o.id === r.data.entity_id)),
  );
  const role = settings?.role;
  const canDelete = role === "owner" || role === "admin";
  const canEdit = (r: RecordRow) =>
    canDelete || (role === "technician" && r.created_by === settings?.user.id);
  const deepLink = `engx://device/${device.id}?domain=${domain}`;

  useMemo(() => {
    QRCode.toDataURL(deepLink, { width: 220, margin: 2 })
      .then(setQr)
      .catch(() => undefined);
  }, [deepLink]);
  const downloadDataUrl = async (dataUrl: string, name: string) => {
    try {
      const res = await fetch(dataUrl);
      await lib.downloadBlob(await res.blob(), name);
    } catch (e: any) {
      say(notify, e?.message || "تعذر التنزيل");
    }
  };
  const saveCalibration = async () => {
    if (
      !calibration.performed_at ||
      !calibration.reference ||
      !calibration.result
    ) {
      say(notify, "أدخل تاريخ المعايرة والمرجع والنتيجة");
      return;
    }
    try {
      await lib.createRecord(calibrationType, {
        device_id: device.id,
        ...calibration,
      });
      setCalibration({
        performed_at: "",
        next_due: "",
        reference: "",
        result: "",
        notes: "",
      });
      setShowCalibration(false);
      say(notify, "تم حفظ سجل المعايرة محلياً");
    } catch (e: any) {
      say(notify, e.message);
    }
  };
  const attach = async (file: File, kind: string) => {
    try {
      await lib.saveAttachment(file, "device", device.id, kind);
      say(notify, "تم حفظ المستند محلياً");
    } catch (e: any) {
      say(notify, e.message);
    }
  };
  const editCalibration = async (r: RecordRow) => {
    const result = prompt("النتيجة", r.data.result || "");
    if (result === null) return;
    try {
      await lib.updateRecord(r.id, { result });
      say(notify, "تم تحديث السجل");
    } catch (e: any) {
      say(notify, e.message);
    }
  };
  const deleteCalibration = async (r: RecordRow) => {
    if (!confirm("حذف سجل المعايرة؟")) return;
    try {
      await lib.deleteRecord(r.id);
      say(notify, "تم حذف السجل");
    } catch (e: any) {
      say(notify, e.message);
    }
  };
  const printLabel = async () => {
    document.body.classList.add("print-device-label");
    try {
      await lib.printReport();
    } catch (e: any) {
      say(notify, e.message);
    } finally {
      setTimeout(
        () => document.body.classList.remove("print-device-label"),
        1000,
      );
    }
  };
  const downloadAttachment = async (r: RecordRow) => {
    try {
      const res = await fetch(r.data.content);
      await lib.downloadBlob(await res.blob(), r.data.name || "document");
    } catch (e: any) {
      say(notify, e.message || "تعذر تنزيل الملف");
    }
  };
  const tabs = [
    ["overview", "نظرة عامة"],
    ["orders", `الأوامر (${orders.length})`],
    ["PM", `خطط PM (${plans.length})`],
    ["parts", "القطع"],
    ["docs", `المستندات (${documents.length})`],
    ["calibration", `المعايرة (${calibrations.length})`],
  ].filter(([id]) => domain === "sales" ? ["overview", "docs"].includes(id) : id !== "calibration" || ["medical", "electronics"].includes(domain));
  return (
    <div className="profile-backdrop">
      <section className="profile-modal" role="dialog" aria-modal="true">
        <header className="profile-head">
          <div>
            <small>ملف {assetName}</small>
            <h2>{device.data.name || "جهاز بلا اسم"}</h2>
            <p>
              {device.data.asset_code || "—"} · {device.data.manufacturer || ""}{" "}
              {device.data.model || ""}
            </p>
          </div>
          <button className="icon-btn" onClick={close} aria-label="إغلاق">
            ×
          </button>
        </header>
        <nav className="profile-tabs">
          {tabs.map(([id, label]) => (
            <button
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
              key={id}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="profile-body">
          {tab === "overview" && (
            <div className="profile-grid">
              <section className="profile-section">
                <h3>بيانات {assetName}</h3>
                <dl>
                  {[
                    ["الحالة", device.data.status || "—"],
                    ["الرقم التسلسلي", device.data.serial],
                    ["الموقع", device.data.location],
                    ["تاريخ التركيب", device.data.installation_date],
                    ["ملاحظات", device.data.notes],
                    ...sectionAssetFields(domain).filter(([key]) => !["name","asset_code","manufacturer","model","serial","location","installation_date","notes"].includes(key)).map(([key,label]) => [label, device.data[key]]),
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v || "—"}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section className="profile-section qr-box">
                <h3>رمز الجهاز</h3>
                {qr && <img src={qr} alt="QR للجهاز" />}
                <code>{device.id}</code>
                <small>
                  {deepLink}
                  <br />
                  لا يتضمن الرمز بيانات حساسة؛ يفتح التطبيق الرابط عند تثبيته.
                </small>
                <div className="button-row">
                  <button
                    className="secondary"
                    onClick={() =>
                      navigator.clipboard
                        ?.writeText(device.id)
                        .then(() => say(notify, "تم نسخ الرمز"))
                    }
                  >
                    نسخ الكود
                  </button>
                  {qr && (
                    <button
                      className="secondary"
                      onClick={() =>
                        downloadDataUrl(
                          qr,
                          `EngX-${device.data.asset_code || device.id}.png`,
                        )
                      }
                    >
                      تنزيل PNG
                    </button>
                  )}
                  <button className="secondary" onClick={printLabel}>
                    طباعة الملصق
                  </button>
                </div>
              </section>
            </div>
          )}
          {tab === "orders" && (
            <List>
              {orders.map((o) => (
                <div className="profile-row" key={o.id}>
                  <b>{o.data.title || o.data.description || "أمر عمل"}</b>
                  <span>{o.data.status || "—"}</span>
                  <small>{fmt(o.created_at)}</small>
                </div>
              ))}
              {!orders.length && (
                <Empty text="لا توجد أوامر مرتبطة بهذا الجهاز." />
              )}
            </List>
          )}
          {tab === "PM" && (
            <List>
              {plans.map((p) => (
                <div className="profile-row" key={p.id}>
                  <b>{p.data.reference || "خطة صيانة"}</b>
                  <span>الاستحقاق: {p.data.next_due || "—"}</span>
                  <small>الفترة: {p.data.interval_days || "—"} يوم</small>
                </div>
              ))}
              {!plans.length && (
                <Empty text="لا توجد خطط مسجلة؛ لا يتم استنتاج مواعيد صيانة." />
              )}
            </List>
          )}
          {tab === "parts" && (
            <List>
              {parts.map((p) => {
                const rows = usages.filter((u) => u.data.part_id === p.id);
                const qty = rows.reduce(
                  (n, u) =>
                    n +
                    (Number(u.data.quantity) > 0 ? Number(u.data.quantity) : 0),
                  0,
                );
                return qty ? (
                  <div className="profile-row" key={p.id}>
                    <b>{p.data.name}</b>
                    <span>{qty} مستخدم</span>
                    <small>{rows.length} حركة مسجلة</small>
                  </div>
                ) : null;
              })}
              {!usages.length && (
                <Empty text="لا توجد حركات قطع مرتبطة بأوامر هذا الجهاز." />
              )}
            </List>
          )}
          {tab === "docs" && (
            <section>
              <div className="upload-bar">
                <span>{domain === "medical" ? "لا ترفع بيانات مرضى أو معلومات صحية شخصية." : "مستندات وصور تخص القسم الحالي فقط."}</span>
                <select id="attachment-kind">
                  <option value="manual">دليل تشغيل</option>
                  <option value="calibration">شهادة معايرة</option>
                  <option value="photo">صورة</option>
                  <option value="other">أخرى</option>
                </select>
                <button
                  className="primary"
                  onClick={() => fileRef.current?.click()}
                >
                  إضافة مستند
                </button>
                <input
                  ref={fileRef}
                  hidden
                  type="file"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    const kind =
                      (
                        document.getElementById(
                          "attachment-kind",
                        ) as HTMLSelectElement
                      )?.value || "other";
                    if (f) void attach(f, kind);
                    e.currentTarget.value = "";
                  }}
                />
              </div>
              <div className="document-list">
                {documents.map((d) => (
                  <div className="profile-row" key={d.id}>
                    <b>{d.data.name}</b>
                    <span>{d.data.kind || "مستند"}</span>
                    <small>
                      {d.data.size ? `${Math.ceil(d.data.size / 1024)} KB` : ""}{" "}
                      ·{" "}
                      {d.data.entity_id === device.id
                        ? "الجهاز"
                        : "الأمر المرتبط"}
                    </small>
                    <button
                      className="text-btn"
                      onClick={() => void downloadAttachment(d)}
                    >
                      تنزيل
                    </button>
                  </div>
                ))}
                {!documents.length && <Empty text="لا توجد مستندات مرتبطة." />}
              </div>
            </section>
          )}
          {tab === "calibration" && (
            <section>
              <div className="section-actions">
                <p>
                  سجل يدوي فقط: أدخل التواريخ والمرجع والنتيجة من السجل الفعلي.
                  لا تُنشأ فترات أو مواعيد تلقائياً.
                </p>
                <button
                  className="primary"
                  onClick={() => setShowCalibration(!showCalibration)}
                >
                  إضافة معايرة
                </button>
              </div>
              {showCalibration && (
                <div className="calibration-form">
                  {[
                    ["performed_at", "تاريخ التنفيذ"],
                    ["next_due", "التاريخ القادم (اختياري)"],
                    ["reference", "المرجع"],
                    ["result", "النتيجة"],
                  ].map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <ClearableInput
                        type={
                          key.includes("at") || key === "next_due"
                            ? "date"
                            : "text"
                        }
                        value={calibration[key]}
                        onChange={(e) =>
                          setCalibration({
                            ...calibration,
                            [key]: e.target.value,
                          })
                        }
                      />
                    </label>
                  ))}
                  <label>
                    ملاحظات
                    <ClearableTextarea
                      value={calibration.notes}
                      onChange={(e) =>
                        setCalibration({
                          ...calibration,
                          notes: e.target.value,
                        })
                      }
                    />
                  </label>
                  <div className="button-row">
                    <button className="primary" onClick={saveCalibration}>
                      حفظ
                    </button>
                    <button
                      className="secondary"
                      onClick={() => setShowCalibration(false)}
                    >
                      إلغاء
                    </button>
                  </div>
                </div>
              )}
              <div className="calibration-list">
                {calibrations.map((c) => (
                  <div className="profile-row" key={c.id}>
                    <b>{c.data.reference}</b>
                    <span>{c.data.result}</span>
                    <small>
                      التنفيذ: {c.data.performed_at || "—"} · القادم:{" "}
                      {c.data.next_due || "غير مسجل"}
                      {c.data.notes ? ` · ${c.data.notes}` : ""}
                    </small>
                    {canEdit(c) && (
                      <button
                        className="text-btn"
                        onClick={() => void editCalibration(c)}
                      >
                        تعديل
                      </button>
                    )}
                    {canDelete && (
                      <button
                        className="text-btn danger-text"
                        onClick={() => void deleteCalibration(c)}
                      >
                        حذف
                      </button>
                    )}
                  </div>
                ))}
                {!calibrations.length && (
                  <Empty text="لا يوجد سجل معايرة. أضف السجل الفعلي عند توفره." />
                )}
              </div>
            </section>
          )}
        </div>
        <footer className="profile-footer">
          {domain !== "sales" && <button className="secondary" onClick={() => onNewOrder?.(device)}>إنشاء أمر مرتبط</button>}
          <button className="secondary" onClick={close}>
            إغلاق
          </button>
        </footer>
      </section>
    </div>
  );
}
function List({ children }: any) {
  return <div className="profile-list">{children}</div>;
}
function Empty({ text }: { text: string }) {
  return <div className="profile-empty">{text}</div>;
}
