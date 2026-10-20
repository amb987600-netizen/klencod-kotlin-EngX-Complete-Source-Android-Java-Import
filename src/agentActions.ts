export type Action =
  | { action: "create_device"; args: { name: string; asset_code: string } }
  | { action: "create_order"; args: { device_code: string; description: string } }
  | { action: "search"; args: { query: string } }
  | { action: "prepare_report"; args: { title: string } }
  | { action: "navigate"; args: { screen: "dashboard" | "devices" | "orders" | "reports" } };

type WriteAction = Exclude<Action, { action: "search" } | { action: "navigate" }>;
const clean = (v: unknown) => String(v ?? "").trim().replace(/[\u0640]/g, "");
const norm = (v: string) => clean(v).normalize("NFKC").replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي");
const valueAfter = (text: string, labels: string[]) => {
  const re = new RegExp(`(?:${labels.join("|")})\\s*[:：]\\s*(.+?)(?=\\s*[|،,]\\s*|$)`, "i");
  return text.match(re)?.[1]?.trim() || "";
};

/** Deterministic, deliberately narrow Arabic command grammar. */
export function parseAction(text: string): Action | null {
  const raw = clean(text), n = norm(raw);
  if (!raw || /(?:احذف|امسح|اغلق|أغلق|صلاحيات|وصول|اعتماد نهائي|اغلاق نهائي)/i.test(raw)) return null;
  if (/^(?:افتح|اذهب|انتقل)\s+(?:لوحة التحكم|الرئيسية|dashboard)$/i.test(n)) return { action: "navigate", args: { screen: "dashboard" } };
  if (/^(?:افتح|اذهب|انتقل)\s+(?:الاجهزة|الأجهزة|devices)$/i.test(n)) return { action: "navigate", args: { screen: "devices" } };
  if (/^(?:افتح|اذهب|انتقل)\s+(?:اوامر الصيانة|أوامر الصيانة|الطلبات|orders)$/i.test(n)) return { action: "navigate", args: { screen: "orders" } };
  if (/^(?:افتح|اذهب|انتقل)\s+(?:التقارير|reports)$/i.test(n)) return { action: "navigate", args: { screen: "reports" } };

  if (/^(?:اضف|أضف|إضف|ضيف|انشئ|أنشئ|إنشئ|انشاء|إنشاء)\s+(?:جهاز)\s*[:：]?/i.test(raw)) {
    const parts = raw.split(/\s*[|،]\s*/);
    const name = parts[0].replace(/^(?:اضف|أضف|إضف|ضيف|انشئ|أنشئ|إنشئ|انشاء|إنشاء)\s+جهاز\s*[:：]?\s*/i, "").trim() || valueAfter(raw, ["(?:اسم\\s*)?الجهاز"]);
    const asset_code = valueAfter(parts.join(" | "), ["كود", "كود الجهاز", "asset[_ -]?code"]);
    if (name && asset_code) return { action: "create_device", args: { name, asset_code } };
  }
  if (/^(?:افتح|انشئ|أنشئ|انشاء|إنشاء)\s+(?:امر|أمر)\s+(?:صيانة)?/i.test(raw)) {
    const device_code = raw.match(/(?:لل?جهاز|كود\s*الجهاز)\s*[:：]?\s*([^|،]+)/i)?.[1]?.trim() || valueAfter(raw, ["كود"]);
    const description = valueAfter(raw, ["العطل", "الوصف", "مشكلة", "سبب"]);
    if (device_code && description) return { action: "create_order", args: { device_code, description } };
  }
  if (/^(?:ابحث|إبحث|بحث)\s+عن\s+/i.test(raw)) {
    const query = raw.replace(/^(?:ابحث|إبحث|بحث)\s+عن\s+/i, "").trim();
    if (query) return { action: "search", args: { query } };
  }
  if (/^(?:جهز|جهز لي|انشئ|أنشئ|اعد|أعد)\s+(?:لي\s+)?تقرير(?:\s*[:：]\s*|\s+)?/i.test(raw)) {
    const title = raw.replace(/^(?:جهز|جهز لي|انشئ|أنشئ|اعد|أعد)\s+(?:لي\s+)?تقرير(?:\s*[:：]\s*|\s+)?/i, "").trim() || "تقرير الصيانة";
    return { action: "prepare_report", args: { title } };
  }
  return null;
}

const ACTIONS = new Set(["create_device", "create_order", "search", "prepare_report"]);
const keys = (o: object) => Object.keys(o).sort();
/** Accept only one exact JSON object with an exact action/argument schema. */
export function parseModelAction(text: string): WriteAction | { action: "search"; args: { query: string } } | null {
  let s = clean(text).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (s.startsWith('"') && s.endsWith('"')) { try { s = JSON.parse(s); } catch { return null; } }
  let value: unknown; try { value = JSON.parse(s); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (keys(obj).join(",") !== "action,args" || typeof obj.action !== "string" || !ACTIONS.has(obj.action) || !obj.args || typeof obj.args !== "object" || Array.isArray(obj.args)) return null;
  const args = obj.args as Record<string, unknown>;
  const expected = obj.action === "create_device" ? ["asset_code", "name"] : obj.action === "create_order" ? ["description", "device_code"] : obj.action === "search" ? ["query"] : ["title"];
  if (keys(args).join(",") !== expected.join(",") || expected.some(k => typeof args[k] !== "string" || !clean(args[k]))) return null;
  if (obj.action === "create_device") return { action: obj.action, args: { name: clean(args.name), asset_code: clean(args.asset_code) } };
  if (obj.action === "create_order") return { action: obj.action, args: { device_code: clean(args.device_code), description: clean(args.description) } };
  if (obj.action === "search") return { action: obj.action, args: { query: clean(args.query) } };
  return { action: "prepare_report", args: { title: clean(args.title) } };
}
