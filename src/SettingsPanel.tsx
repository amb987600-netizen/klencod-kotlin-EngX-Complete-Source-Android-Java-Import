import ClearableInput from './ClearableInput';
import {nativeGoogleCredential} from "./googleSignIn";
import NotificationPanel from "./NotificationPanel";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Cloud,
  Download,
  FileSpreadsheet,
  KeyRound,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";
import * as lib from "./lib";
import { Capacitor } from "@capacitor/core";
import { ProfileDomain } from "./DomainNavigation";
import type { EntityType, Settings as AppSettings } from "./lib";

type Tab = "notifications" | "account" | "cloud" | "backup" | "import" | "team" | "privacy";
const tabs: { id: Tab; label: string; icon: any }[] = [
  { id: "notifications", label: "الإشعارات", icon: ShieldCheck },
  { id: "account", label: "الحساب", icon: UserRound },
  { id: "cloud", label: "السحابة", icon: Cloud },
  { id: "backup", label: "النسخ الاحتياطي", icon: ShieldCheck },
  { id: "import", label: "استيراد وتصدير", icon: FileSpreadsheet },
  { id: "team", label: "الفريق", icon: Users },
  { id: "privacy", label: "الخصوصية", icon: KeyRound },
];
const fields: Record<string, string[]> = {
  device: [
    "name",
    "asset_code",
    "manufacturer",
    "model",
    "serial",
    "location",
    "status",
    "installation_date",
    "notes",
  ],
  part: [
    "name",
    "part_number",
    "quantity",
    "min_quantity",
    "purchase_price",
    "supplier",
    "storage",
  ],
  plan: [
    "device_code",
    "interval_days",
    "last_completed",
    "next_due",
    "reference",
  ],
  event: ["title", "remind_at", "device_code"],
};
const labels: Record<string, string> = {
  name: "الاسم",
  asset_code: "رمز الجهاز",
  manufacturer: "الشركة المصنعة",
  model: "الطراز",
  serial: "الرقم التسلسلي",
  location: "الموقع",
  status: "الحالة",
  installation_date: "تاريخ التركيب",
  notes: "ملاحظات",
  part_number: "رقم القطعة",
  quantity: "الكمية",
  min_quantity: "الحد الأدنى",
  purchase_price: "سعر الشراء",
  supplier: "المورد",
  storage: "التخزين",
  device_code: "كود الجهاز",
  interval_days: "الفاصل بالأيام",
  last_completed: "آخر تنفيذ",
  next_due: "الاستحقاق القادم",
  reference: "المرجع",
  title: "العنوان",
  remind_at: "موعد التذكير",
};
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Settings({ s, notify }: any) {
  const live = lib.useSettings() as AppSettings | undefined;
  const settings = live || s;
  const [tab, setTab] = useState<Tab>("account");
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState({
    name: s?.user?.name || "",
    email: s?.user?.email || "",
    serverUrl: s?.serverUrl || "",
    loginEmail: "",
    password: "",
    register: false,
    registerName: "",
    rememberMe: false,
  });
  const [remembered, setRemembered] = useState<Array<{ id: string; email: string; name: string; serverUrl: string }>>([]);
  const [googleReady, setGoogleReady] = useState(false);
  const isNative = Capacitor.isNativePlatform();
  const [cloud, setCloud] = useState(!!s?.cloudEnabled);
  const [pw, setPw] = useState("");
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [backupPreview, setBackupPreview] = useState<any>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<EntityType>("device");
  const [parsed, setParsed] = useState<any>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [validated, setValidated] = useState<any>(null);
  const [batch, setBatch] = useState<string | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [invite, setInvite] = useState({
    email: "",
    role: "viewer",
    expires_days: 7,
  });
  const [inviteCode, setInviteCode] = useState("");
  const [outbox, setOutbox] = useState({ pending: 0, rejected: 0 });
  const googleRef = useRef<HTMLDivElement>(null);
  const run = async (fn: () => Promise<any>, success?: string) => {
    setBusy(true);
    try {
      const x = await fn();
      if (success) notify(success);
      return x;
    } catch (e) {
      notify(err(e));
    } finally {
      setBusy(false);
    }
  };
  const refreshRemembered = async () => {
    try {
      const list = await (lib as any).listRememberedAccounts?.();
      if (Array.isArray(list)) setRemembered(list);
    } catch (e) {
      notify(err(e));
    }
  };
  useEffect(() => {
    void refreshRemembered();
  }, [settings?.token]);
  useEffect(() => {
    setAccount((a) => ({
      ...a,
      name: settings?.user?.name || "",
      email: settings?.user?.email || "",
      serverUrl: settings?.serverUrl || "",
    }));
    setCloud(!!settings?.cloudEnabled);
  }, [
    settings?.user?.name,
    settings?.user?.email,
    settings?.serverUrl,
    settings?.cloudEnabled,
  ]);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const q = await lib.db.queue.toArray();
        if (alive)
          setOutbox({
            pending: q.length,
            rejected: q.filter((x) => !!x.error).length,
          });
      } catch (e) {
        if (alive) notify(err(e));
      }
    };
    void refresh();
    const id = window.setInterval(refresh, 1500);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [settings?.workspace?.id, settings?.lastSync]);
  useEffect(() => {
    if (tab !== "team" || !settings?.token) return;
    void run(async () => {
      const [m, i] = await Promise.all([
        lib.teamRequest(
          `/api/team?workspace_id=${encodeURIComponent(settings.workspace.id)}`,
        ),
        lib.teamRequest(
          `/api/invitations?workspace_id=${encodeURIComponent(settings.workspace.id)}`,
        ),
      ]);
      setMembers(m.members || []);
      setInvitations(i.invitations || []);
    });
  }, [tab, settings?.token, settings?.workspace?.id]);
  useEffect(() => {
    if (isNative || tab !== "account" || !googleRef.current || settings?.token || !account.serverUrl.trim()) return;
    setGoogleReady(false);
    let script = document.querySelector(
      'script[src="https://accounts.google.com/gsi/client"]',
    ) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      document.head.appendChild(script);
    }
    const draw = async () => {
      try {
        const c = await fetch(
          `${account.serverUrl.replace(/\/$/, "")}/api/config`,
        ).then((r) => r.json());
        if (!c.googleClientId || !(window as any).google?.accounts?.id) {
          setGoogleReady(false);
          return;
        }
        setGoogleReady(true);
        (window as any).google.accounts.id.initialize({
          client_id: c.googleClientId,
          callback: (r: any) =>
            void run(async () => {
              await saveAccount();
              await (lib.signIn as any)("google", { credential: r.credential, rememberMe: account.rememberMe });
                setAccount((a) => ({ ...a, password: "", register: false, registerName: "" }));
                await refreshRemembered();
            }, "تم تسجيل الدخول"),
        });
        googleRef.current?.replaceChildren();
        (window as any).google.accounts.id.renderButton(googleRef.current, {
          theme: "outline",
          size: "large",
          width: 260,
        });
      } catch (e) {
        notify(err(e));
      }
    };
    script.addEventListener("load", draw);
    void draw().catch((e) => notify(err(e)));
    return () => script?.removeEventListener("load", draw);
  }, [tab, account.serverUrl, account.rememberMe, settings?.token, isNative]);
  const saveAccount = async () => {
    await lib.saveSettings({
      user: {
        ...settings.user,
        name: account.name.trim(),
        email: account.email.trim(),
      },
      serverUrl: account.serverUrl.trim(),
    });
  };
  const signIn = () =>
    run(
      async () => {
        await saveAccount();
        await (lib.signIn as any)(
          account.register ? "register" : "login",
          account.register
            ? {
                email: account.loginEmail,
                password: account.password,
                name: account.registerName || account.name,
                rememberMe: account.rememberMe,
              }
            : { email: account.loginEmail, password: account.password, rememberMe: account.rememberMe },
        );
        // Never retain credentials in React state after authentication.
        setAccount((a) => ({ ...a, password: "", register: false, registerName: "" }));
        await refreshRemembered();
      },
      account.register ? "تم إنشاء الحساب" : "تم تسجيل الدخول",
    );
  const signOut = () =>
    run(async () => {
      await lib.signOut();
      setAccount((a) => ({ ...a, password: "", register: false, registerName: "", rememberMe: false }));
      await refreshRemembered();
    }, "تم تسجيل الخروج");
  const forgetRemembered = (id: string) =>
    run(async () => {
      await (lib as any).forgetRememberedAccount(id);
      await refreshRemembered();
    }, "تم حذف الحساب المحفوظ");
  const signInGoogleNative = () => run(async () => {
    await saveAccount();
    const configResponse = await fetch(`${account.serverUrl.trim().replace(/\/$/, "")}/api/config`);
    if (!configResponse.ok) throw Error("تعذر الاتصال بخادم تسجيل الدخول");
    const config = await configResponse.json();
    const credential = await nativeGoogleCredential(config.googleClientId || "");
    await lib.signIn("google", {credential, rememberMe: account.rememberMe});
    setAccount(a => ({...a, password: "", register: false, registerName: ""}));
    await refreshRemembered();
  }, "تم تسجيل الدخول بحساب Google");
  const backupCreate = () =>
    run(async () => {
      if (pw.length < 10) throw Error("استخدم كلمة مرور من 10 أحرف على الأقل");
      const b = await lib.createBackup(pw);
      await lib.downloadBlob(b, "EngX-backup.enc");
    }, "تم إنشاء نسخة مشفرة");
  const inspect = () =>
    run(async () => {
      if (!backupFile || pw.length < 10)
        throw Error("اختر ملفًا وكلمة مرور من 10 أحرف على الأقل");
      setBackupPreview(await lib.inspectBackup(backupFile, pw));
    });
  const restore = () =>
    run(async () => {
      if (!backupPreview) throw Error("افحص النسخة أولًا");
      if (
        !confirm(
          "سيتم استبدال بيانات مساحة العمل الموجودة في النسخة، مع إبقاء الحسابات الأخرى. هل تتابع؟",
        )
      )
        return;
      await lib.signOut();
      await lib.restoreBackup(backupPreview.payload);
      notify("تمت الاستعادة؛ أعد فتح التطبيق");
    });
  const chooseImport = async (f: File | null) => {
    setFile(f);
    setParsed(null);
    setValidated(null);
    setBatch(null);
    if (!f) return;
    await run(async () => {
      const p = await lib.parseExcel(f);
      setParsed(p);
      const next: Record<string, string> = {};
      for (const target of fields[kind])
        next[target] =
          p.headers.find(
            (h: string) =>
              h.toLowerCase().replace(/[ _-]/g, "") ===
                target.replace(/[ _-]/g, "") || h === labels[target],
          ) || "";
      setMapping(next);
    });
  };
  const validate = () =>
    run(async () => {
      if (!parsed) throw Error("اختر ملفًا أولًا");
      setValidated(await lib.validateImport(kind, parsed.rows, mapping));
    });
  const doImport = () =>
    run(async () => {
      if (!validated?.valid?.length || validated.errors?.length)
        throw Error("أصلح أخطاء التحقق قبل الاستيراد");
      if (!confirm(`سيتم إضافة ${validated.valid.length} سجل. هل تتابع؟`))
        return;
      const r: any = await (lib.importRows as any)(kind, validated.valid);
      setBatch(r?.batch_id || null);
      setParsed(null);
      setValidated(null);
      notify(`تم استيراد ${r?.count || validated.valid.length} سجل`);
    });
  const undo = () =>
    run(async () => {
      if (!batch || !confirm("تراجع عن السجلات التي لم تتغير فقط؟")) return;
      const r = await (lib as any).undoImport(batch);
      setBatch(null);
      notify(
        `تم التراجع عن ${r.undone}؛ تم تخطي ${r.skipped?.length || 0} سجل لتغييره أو ارتباطه`,
      );
    });
  const loadTeam = () =>
    run(async () => {
      const [m, i] = await Promise.all([
        lib.teamRequest(`/api/team?workspace_id=${settings.workspace.id}`),
        lib.teamRequest(
          `/api/invitations?workspace_id=${settings.workspace.id}`,
        ),
      ]);
      setMembers(m.members || []);
      setInvitations(i.invitations || []);
    });
  const canManage = ["owner", "admin"].includes(settings?.role);
  const canOwner = settings?.role === "owner";
  const inviteTeam = () =>
    run(async () => {
      const role =
        settings.role === "admin" && invite.role === "owner"
          ? "viewer"
          : invite.role;
      const r = await lib.teamRequest("/api/invitations", "POST", {
        workspace_id: settings.workspace.id,
        email: invite.email,
        role,
        expires_days: invite.expires_days,
      });
      setInviteCode(r.code);
      await loadTeam();
    });
  const teamAction = (path: string, method: string, body?: any) =>
    run(async () => {
      await lib.teamRequest(path, method, body);
      await loadTeam();
    }, "تم تحديث الفريق");
  const tabBody = () => {
    if (tab === "notifications") return <NotificationPanel settings={settings} notify={notify}/>;
    if (tab === "account")
      return (
        <>
          <ProfileDomain settings={settings} notify={notify}/><section className="card"><h3>لوحة المالك والمساعدين</h3><p>دخول منفصل لإدارة البيانات المتزامنة والصلاحيات.</p><button type="button" className="btn" onClick={() => window.dispatchEvent(new Event("engx:owner-control"))}>دخول لوحة المالك والمساعدين</button></section>
          <div className="card">
            <h3>بيانات الحساب</h3>
            <div className="form-grid">
              <label>
                الاسم
                <ClearableInput
                  value={account.name}
                  onChange={(e) =>
                    setAccount({ ...account, name: e.target.value })
                  }
                />
              </label>
              <label>
                البريد
                <ClearableInput
                  type="email"
                  value={account.email}
                  onChange={(e) =>
                    setAccount({ ...account, email: e.target.value })
                  }
                />
              </label>
              <label className="full">
                عنوان الخادم
                <ClearableInput
                  value={account.serverUrl}
                  onChange={(e) =>
                    setAccount({ ...account, serverUrl: e.target.value })
                  }
                  placeholder="https://example.com"
                />
              </label>
            </div>
            <button
              className="btn primary"
              onClick={() => run(saveAccount, "تم حفظ البيانات")}
            >
              حفظ
            </button>
          </div>
          <div className="card">
            <h3>{settings?.token ? "الجلسة" : "تسجيل الدخول أو إنشاء حساب"}</h3>
            {settings?.token ? (
              <button
                className="btn danger"
                onClick={signOut}
              >
                <LogOut size={16} /> تسجيل الخروج
              </button>
            ) : (
              <>
                <div className="form-grid">
                  <label>
                    البريد
                    <ClearableInput
                      type="email"
                      value={account.loginEmail}
                      onChange={(e) =>
                        setAccount({ ...account, loginEmail: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    كلمة المرور
                    <input
                      type="password"
                      value={account.password}
                      onChange={(e) =>
                        setAccount({ ...account, password: e.target.value })
                      }
                    />
                  </label>
                  <label className="check-label full">
                    <input
                      type="checkbox"
                      checked={account.rememberMe}
                      onChange={(e) => setAccount({ ...account, rememberMe: e.target.checked })}
                    />
                    تذكرني
                  </label>
                  {account.register && (
                    <label>
                      اسم الحساب
                      <ClearableInput
                        value={account.registerName}
                        onChange={(e) =>
                          setAccount({
                            ...account,
                            registerName: e.target.value,
                          })
                        }
                      />
                    </label>
                  )}
                </div>
                <button className="btn primary" onClick={signIn}>
                  {account.register ? "إنشاء حساب" : "تسجيل الدخول"}
                </button>
                <button
                  className="btn ghost"
                  onClick={() =>
                    setAccount({ ...account, register: !account.register })
                  }
                >
                  {account.register ? "لدي حساب" : "إنشاء حساب جديد"}
                </button>
                {remembered.length > 0 && (
                  <div className="remembered-accounts">
                    <h4>الحسابات المحفوظة</h4>
                    {remembered.map((saved) => (
                      <div className="remembered-account" key={saved.id}>
                        <button type="button" className="remembered-account__pick" onClick={() => setAccount((a) => ({ ...a, loginEmail: saved.email, serverUrl: saved.serverUrl }))}>
                          <strong>{saved.name || saved.email}</strong><small>{saved.email}{saved.serverUrl ? ` · ${saved.serverUrl}` : ""}</small>
                        </button>
                        <button type="button" className="btn ghost" aria-label={`حذف ${saved.email}`} onClick={() => void forgetRemembered(saved.id)}>حذف</button>
                      </div>
                    ))}
                  </div>
                )}
                {isNative ? <button type="button" className="btn google-signin" disabled={busy} onClick={() => void signInGoogleNative()}>المتابعة باستخدام حساب Google</button> : <div ref={googleRef} />}
                {!googleReady && !isNative && <p className="muted google-status">الدخول بجوجل غير متاح حتى يضبط مالك التطبيق GOOGLE_CLIENT_ID وعناوين الويب المسموحة.</p>}
                <p className="muted">الدخول بجوجل على Android وiPhone يحتاج معرّفات OAuth الخاصة بمالك التطبيق وإعداد شهادة Android وتحويل iPhone. التعليمات في docs/GOOGLE-SIGN-IN.ar.md. لا توجد مفاتيح OAuth سرية داخل التطبيق. «تذكرني» لا يحفظ كلمة المرور؛ على الويب تبقى الجلسة في التبويب وعلى الهاتف تُحفظ باختيارك في مخزن النظام الآمن.</p>
              </>
            )}
          </div>
        </>
      );
    if (tab === "cloud")
      return (
        <div className="card">
          <h3>الحفظ السحابي</h3>
          <label>
            <input
              type="checkbox"
              checked={cloud}
              disabled={!settings?.token}
              onChange={(e) =>
                run(async () => {
                  setCloud(e.target.checked);
                  await lib.saveSettings({ cloudEnabled: e.target.checked });
                }, "تم تحديث إعداد السحابة")
              }
            />{" "}
            تفعيل المزامنة (تظل متوقفة افتراضيًا)
          </label>
          <p>
            الحالة:{" "}
            {settings?.token
              ? cloud
                ? "مفعّلة"
                : "متوقفة"
              : "غير مسجل الدخول"}
          </p>
          <p>
            آخر مزامنة:{" "}
            {settings?.lastSync
              ? new Date(settings.lastSync).toLocaleString()
              : "لم تتم"}
          </p>
          <p>
            صندوق الإرسال: <strong>{outbox.pending} معلّق</strong>،{" "}
            <strong>{outbox.rejected} مرفوض يحتاج مراجعة</strong>
          </p>
          <button
            className="btn primary"
            disabled={!cloud || !settings?.token}
            onClick={() => run(lib.syncNow, "اكتملت المزامنة")}
          >
            <RefreshCw size={16} /> مزامنة الآن
          </button>
          <p className="muted">
            {!navigator.onLine
              ? lib.displaySyncReason("OFFLINE")
              : "تُعرض أسباب الرفض بوضوح ولا تُحذف التعديلات المرفوضة."}
          </p>
        </div>
      );
    if (tab === "backup")
      return (
        <>
          <div className="card">
            <h3>نسخة محلية مشفرة</h3>
            <p className="muted">
              تشفير AES-256. احفظ الملف وكلمة المرور خارج الهاتف وفي مكانين
              آمنين.
            </p>
            <input
              type="password"
              placeholder="كلمة مرور النسخة (10 أحرف على الأقل)"
              value={pw}
              onChange={(e) => {
                setPw(e.target.value);
                setBackupPreview(null);
              }}
            />
            <div className="row-actions">
              <button className="btn primary" onClick={backupCreate}>
                إنشاء وتنزيل
              </button>
              <button
                className="btn ghost"
                onClick={() =>
                  run(async () => {
                    const r = await (lib as any).testBackupRoundtrip(pw);
                    notify(
                      `اختبار تشفير ناجح: ${r.records} سجل، ${r.attachments} مرفق`,
                    );
                  })
                }
              >
                اختبار النسخة دون تغيير البيانات
              </button>
              <button
                className="btn ghost"
                disabled={!settings?.token}
                onClick={() =>
                  run(() => lib.uploadCloudBackup(pw), "تم رفع النسخة السحابية")
                }
              >
                رفع للسحابة
              </button>
              <button
                className="btn ghost"
                disabled={!settings?.token}
                onClick={() =>
                  run(
                    async () =>
                      lib.downloadBlob(
                        await lib.downloadCloudBackup(),
                        "EngX-cloud-backup.enc",
                      ),
                    "تم تنزيل النسخة",
                  )
                }
              >
                تنزيل من السحابة
              </button>
            </div>
          </div>
          <div className="card">
            <h3>استعادة</h3>
            <input
              type="file"
              accept=".enc,.json"
              onChange={(e) => {
                setBackupFile(e.target.files?.[0] || null);
                setBackupPreview(null);
              }}
            />
            <button className="btn ghost" onClick={inspect}>
              فحص النسخة وعرض الأعداد
            </button>
            {backupPreview && (
              <>
                <p>تاريخ النسخة: {backupPreview.created_at}</p>
                <pre>{JSON.stringify(backupPreview.counts, null, 2)}</pre>
                <button className="btn danger" onClick={restore}>
                  تأكيد استبدال كل البيانات
                </button>
              </>
            )}
          </div>
        </>
      );
    if (tab === "import")
      return (
        <>
          <div className="card">
            <h3>استيراد Excel / CSV</h3>
            <div className="form-grid">
              <label>
                النوع
                <select
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as EntityType);
                    setFile(null);
                    setParsed(null);
                    setValidated(null);
                    setBatch(null);
                  }}
                >
                  <option value="device">أجهزة</option>
                  <option value="part">قطع</option>
                  <option value="plan">خطط</option>
                  <option value="event">أحداث</option>
                </select>
              </label>
              <label>
                الملف
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) =>
                    void chooseImport(e.target.files?.[0] || null)
                  }
                />
              </label>
            </div>
            {parsed && (
              <>
                <p>
                  {parsed.rows.length} صف، الورقة الأولى، معاينة أول 10 صفوف
                </p>
                <div className="table-card">
                  <table>
                    <thead>
                      <tr>
                        {fields[kind].map((k) => (
                          <th key={k}>
                            {labels[k] || k}
                            <select
                              value={mapping[k] || ""}
                              onChange={(e) => {
                                setMapping({ ...mapping, [k]: e.target.value });
                                setValidated(null);
                              }}
                            >
                              <option value="">—</option>
                              {parsed.headers.map((h: string) => (
                                <option key={h}>{h}</option>
                              ))}
                            </select>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.rows.slice(0, 10).map((r: any, i: number) => (
                        <tr key={i}>
                          {fields[kind].map((k) => (
                            <td key={k}>
                              {String(mapping[k] ? (r[mapping[k]] ?? "") : "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button className="btn primary" onClick={validate}>
                  تحقق من البيانات
                </button>
              </>
            )}
          </div>
          {validated && (
            <div className="card">
              <h3>نتيجة التحقق</h3>
              <p>
                صالح: {validated.valid.length} — أخطاء:{" "}
                {validated.errors.length}
              </p>
              {validated.errors.map((x: string) => (
                <p className="muted" key={x}>
                  {x}
                </p>
              ))}
              {!validated.errors.length && (
                <button className="btn primary" onClick={doImport}>
                  تأكيد الاستيراد
                </button>
              )}
            </div>
          )}
          {batch && (
            <div className="card">
              <button className="btn danger" onClick={undo}>
                تراجع عن هذه الدفعة
              </button>
              <p className="muted">
                التراجع آمن فقط للسجلات التي لم تُعدّل أو ترتبط بسجلات أخرى.
              </p>
            </div>
          )}
          <div className="card">
            <button
              className="btn ghost"
              onClick={() =>
                run(() => lib.exportDataExcel(), "تم تصدير البيانات")
              }
            >
              تصدير البيانات
            </button>
            {(["device", "part", "plan", "event"] as EntityType[]).map((t) => (
              <button
                className="btn ghost"
                key={t}
                onClick={() =>
                  run(() => lib.downloadTemplate(t), "تم تنزيل القالب")
                }
              >
                قالب {t}
              </button>
            ))}
          </div>
        </>
      );
    if (tab === "team")
      return (
        <>
          {!settings?.token && (
            <div className="card">سجّل الدخول لإدارة الفريق.</div>
          )}
          {settings?.token && (
            <>
              <div className="card">
                <h3>دعوة عضو</h3>
                {canManage && (
                  <div className="form-grid">
                    <label>
                      البريد
                      <ClearableInput
                        value={invite.email}
                        onChange={(e) =>
                          setInvite({ ...invite, email: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      الدور
                      <select
                        value={invite.role}
                        onChange={(e) =>
                          setInvite({ ...invite, role: e.target.value })
                        }
                      >
                        {canOwner && <option value="admin">مدير</option>}
                        <option value="technician">فني</option>
                        <option value="viewer">مشاهد</option>
                      </select>
                    </label>
                  </div>
                )}
                {canManage && (
                  <button className="btn primary" onClick={inviteTeam}>
                    إنشاء رمز الدعوة
                  </button>
                )}
                {inviteCode && (
                  <p>
                    الرمز: <strong>{inviteCode}</strong>{" "}
                    <button
                      className="btn ghost"
                      onClick={() =>
                        void navigator.clipboard?.writeText(inviteCode)
                      }
                    >
                      نسخ
                    </button>
                    <br />
                    <small>لم يُرسل بريدًا؛ شارك الرمز بأمان.</small>
                  </p>
                )}
              </div>
              <div className="card">
                <h3>الأعضاء</h3>
                {members.map((m) => (
                  <div className="row-actions" key={m.id}>
                    <span>
                      {m.email || m.name} — {m.role} — {m.status || "active"}
                    </span>
                    {canManage && m.role !== "owner" && (
                      <>
                        <select
                          value={m.role}
                          onChange={(e) =>
                            teamAction(`/api/members/${m.id}`, "PATCH", {
                              workspace_id: settings.workspace.id,
                              role: e.target.value,
                            })
                          }
                        >
                          <option value="admin">مدير</option>
                          <option value="technician">فني</option>
                          <option value="viewer">مشاهد</option>
                        </select>
                        <button
                          className="btn ghost"
                          onClick={() =>
                            teamAction(`/api/members/${m.id}`, "PATCH", {
                              workspace_id: settings.workspace.id,
                              status:
                                m.status === "suspended"
                                  ? "active"
                                  : "suspended",
                            })
                          }
                        >
                          {m.status === "suspended" ? "تفعيل" : "إيقاف"}
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <div className="card">
                <h3>قبول دعوة أو إدارة الدعوات</h3>
                <ClearableInput
                  placeholder="رمز الدعوة"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                />
                <button
                  className="btn primary"
                  onClick={() =>
                    teamAction("/api/invitations/accept", "POST", {
                      code: inviteCode,
                    })
                  }
                >
                  قبول الدعوة
                </button>
                {invitations.map((i) => (
                  <p key={i.code}>
                    {i.email} — {i.role} — {i.status || "pending"}{" "}
                    {canManage && (
                      <button
                        className="btn ghost"
                        onClick={() =>
                          teamAction(
                            `/api/invitations/${i.code}?workspace_id=${settings.workspace.id}`,
                            "DELETE",
                          )
                        }
                      >
                        إلغاء
                      </button>
                    )}
                  </p>
                ))}
              </div>
              {canOwner && (
                <div className="card">
                  <h3>نقل الملكية</h3>
                  <p className="muted">
                    الهدف يجب أن يكون عضوًا نشطًا بدور مدير. هذا الإجراء نهائي
                    بعد التأكيد.
                  </p>
                  {members
                    .filter(
                      (m) =>
                        m.id !== settings.user.id &&
                        m.role === "admin" &&
                        m.status !== "suspended",
                    )
                    .map((m) => (
                      <button
                        className="btn danger"
                        key={m.id}
                        onClick={() =>
                          confirm("نقل الملكية؟") &&
                          teamAction("/api/workspace/transfer", "POST", {
                            workspace_id: settings.workspace.id,
                            member_id: m.id,
                          })
                        }
                      >
                        نقل إلى {m.email || m.name}
                      </button>
                    ))}
                </div>
              )}
            </>
          )}
        </>
      );
    return (
      <div className="card">
        <h3>الخصوصية وحماية البيانات</h3>
        <label className="check-label"><input type="checkbox" checked={!!settings?.widgetsEnabled} onChange={e=>run(()=>lib.saveSettings({widgetsEnabled:e.target.checked}))}/>تفعيل ملخص الودجت على الشاشة الرئيسية</label><label className="check-label"><input type="checkbox" checked={!!settings?.widgetShowDetails} onChange={e=>run(()=>lib.saveSettings({widgetShowDetails:e.target.checked}))}/>السماح بظهور أسماء الأجهزة وتفاصيل المهام على الودجت — اختياري</label><p className="muted">تظهر ملخصات القسم وأزرار فتح أمر وإنشاء أمر ومسح QR خارج التطبيق. التفاصيل مخفية افتراضياً. التفعيل اختياري؛ آخر تحديث عند فتح التطبيق أو تغيير بياناته، وليس مزامنة خلفية مضمونة. أضف EngX من قائمة Widgets بعد تثبيت النسخة الأصلية. في الآيفون يلزم إعداد App Groups في Xcode.</p>
        <p>
          البيانات المحلية محفوظة في تخزين التطبيق، غير مشفرة على مستوى نظام
          التشغيل. النسخ الاحتياطية فقط مشفرة AES-256 بكلمة مرورك.
        </p>
        <p>
          تُزامن البيانات مع الخادم فقط عند تسجيل الدخول وتفعيل السحابة. استخدم
          HTTPS، واحفظ النسخ خارج الهاتف.
        </p>
        <p>
          هذا التطبيق لسجلات العمل في الأقسام المختلفة؛ في القسم الطبي لا تُدخل ملاحظات مرضى أو
          بيانات صحية شخصية.
        </p>
        <p className="muted">
          اللغة يحددها التطبيق الرئيسي؛ هذه اللوحة لا تعد بتعريب كامل للواجهات
          الأخرى.
        </p>
      </div>
    );
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>الإعدادات</h1>
          <p>الحساب، التخزين، النسخ، الفريق والخصوصية</p>
        </div>
      </div>
      <div className="tabs">
        {tabs.map((t) => {
          const I = t.icon;
          return (
            <button
              className={tab === t.id ? "selected" : ""}
              key={t.id}
              onClick={() => setTab(t.id)}
            >
              <I size={16} />
              {t.label}
            </button>
          );
        })}
      </div>
      {busy && <p className="muted">جارٍ التنفيذ…</p>}
      {tabBody()}
    </div>
  );
}
