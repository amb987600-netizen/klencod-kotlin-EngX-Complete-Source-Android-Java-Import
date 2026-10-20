export const DOMAINS = [
  { id: "medical", label: "الأجهزة الطبية", labelEn: "Medical devices", description: "الأجهزة الطبية والصيانة الوقائية والمعايرة" },
  { id: "mobiles", label: "الموبايلات", labelEn: "Mobiles", description: "الهواتف وأوامر الأعطال والإصلاح وقطع الغيار" },
  { id: "appliances", label: "الأجهزة المنزلية", labelEn: "Home appliances", description: "الأجهزة المنزلية وصيانتها وتركيبها" },
  { id: "screens", label: "الشاشات", labelEn: "Screens", description: "الشاشات ومعدات العرض وأعمال إصلاحها" },
  { id: "electronics", label: "الإلكترونيات", labelEn: "Electronics", description: "الدوائر والمكونات والأجهزة الإلكترونية" },
  { id: "workshops", label: "الورش الأخرى", labelEn: "Other workshops", description: "أعمال الورش والخدمات الفنية بمختلف أنواعها" },
  { id: "sales", label: "بيع المنتجات", labelEn: "Product sales", description: "منتجات من أي نوع والمخزون والبيع والشراء" },
] as const;
export type PresetDomainId = typeof DOMAINS[number]["id"];
export type DomainId = PresetDomainId | `custom_${string}`;
export type SectionDefinition = {id: DomainId; label: string; labelEn: string; description: string; archived: boolean};
export const isDomainId = (value: unknown): value is DomainId => typeof value === "string" && (DOMAINS.some(d => d.id === value) || /^custom_[a-f0-9]{32}$/.test(value));
export function getDomains(definitions: SectionDefinition[] = [], includeArchived = false): SectionDefinition[] {
  const map = new Map<string, SectionDefinition>(DOMAINS.map(d => [d.id, {...d, archived: false}]));
  for (const d of definitions) if (isDomainId(d?.id) && typeof d.label === "string" && d.label.trim()) {
    map.set(d.id, {...d, label: d.label.trim(), labelEn: d.labelEn || d.label, description: d.description || "نفس شاشات ومصطلحات الأقسام المستقلة", archived: d.id === "medical" ? false : !!d.archived});
  }
  return [...map.values()].filter(d => includeArchived || !d.archived);
}
export function normalizeDomain(value: unknown): DomainId {
  return isDomainId(value) ? value : "medical";
}
export function domainInfo(value: unknown, definitions: SectionDefinition[] = []): SectionDefinition {
  const id = normalizeDomain(value);
  return getDomains(definitions, true).find(d => d.id === id) || {id, label: "قسم مستقل", labelEn: "Independent section", description: "نفس الشاشات والمصطلحات المشتركة", archived: false};
}
export function sectionScreens(value: unknown): string[] {
  const shared = ["dashboard", "devices", "inventory", "calendar", "notifications", "reports", "documents", "chat", "activity", "assist", "settings"];
  return normalizeDomain(value) === "sales" ? shared : [...shared, "orders", "plans"];
}
export function sectionAssetName(value: unknown): string {
  const domain = normalizeDomain(value);
  return domain === "sales" ? "المنتج" : domain === "workshops" ? "الجهاز / قطعة العمل" : domain === "mobiles" ? "الموبايل" : "الجهاز";
}
export function sectionAssetFields(value: unknown): [string, string][] {
  const domain = normalizeDomain(value);
  const extra: Partial<Record<DomainId, [string, string][]>> = {
    medical: [["hospital_department", "القسم / الوحدة الطبية"]],
    mobiles: [["imei", "IMEI"], ["customer_name", "اسم العميل"], ["customer_phone", "هاتف العميل"], ["accessories", "الملحقات المستلمة"]],
    appliances: [["appliance_type", "نوع الجهاز المنزلي"], ["customer_name", "اسم العميل"], ["service_address", "عنوان الخدمة"]],
    screens: [["screen_size", "مقاس الشاشة"], ["panel_type", "نوع اللوحة"], ["customer_name", "اسم العميل"]],
    electronics: [["board_number", "رقم البوردة"], ["component_type", "نوع الدائرة / المكوّن"]],
    workshops: [["job_category", "نوع شغل الورشة"], ["customer_name", "اسم العميل"], ["customer_phone", "هاتف العميل"]],
    sales: [["product_category", "تصنيف المنتج — أي نوع"], ["barcode", "باركود المنتج"], ["unit", "وحدة البيع"]],
  };
  return [["name", `اسم ${sectionAssetName(domain)}`], ["asset_code", domain === "sales" ? "كود المنتج" : "رمز الأصل / كود الاستلام"], ["manufacturer", "الشركة المصنعة"], ["model", "الطراز"], ["serial", "الرقم التسلسلي"], ["location", "الموقع"], ...(extra[domain] || []), ["installation_date", "تاريخ التركيب / الاستلام"], ["notes", "ملاحظات"]];
}
