import { Capacitor, registerPlugin } from "@capacitor/core";
import { useEffect, useMemo } from "react";
import { normalizeDomain, type DomainId } from "./domains";
import { useRecords, useSettings, type RecordRow, type Settings } from "./lib";

export type WidgetPriorityItem = {
  id: string;
  kind: "order" | "plan" | "calibration" | "part";
  label: string;
  date?: string;
  uri: string;
};

export type InteractiveWidgetSnapshot = {
  enabled: boolean;
  domain: DomainId;
  counts: {
    openOrders: number;
    pmDue: number;
    calDue: number;
    lowStock: number;
    pendingApprovals: number;
  };
  items: WidgetPriorityItem[];
  updatedAt: string;
  openOrders: number; pmDue: number; upcoming: Array<{title: string; date: string}>;
};

type WidgetSettings = Settings & { widgetShowDetails?: boolean };
type WidgetBridge = { update(snapshot: InteractiveWidgetSnapshot): Promise<void> };
const WidgetBridge = registerPlugin<WidgetBridge>("EngXWidgets");

const dateOnly = (value: unknown) => String(value ?? "").slice(0, 10);
const validDate = (value: unknown) => dateOnly(value) && Number.isFinite(Date.parse(String(value)));
const due = (value: unknown, today: string) => validDate(value) && dateOnly(value) <= today;
const active = (row: RecordRow) => !row.deleted_at;
const genericLabel = (kind: WidgetPriorityItem["kind"]) => ({
  order: "أمر صيانة مفتوح",
  plan: "صيانة وقائية مستحقة",
  calibration: "معايرة مستحقة",
  part: "قطعة منخفضة المخزون",
}[kind]);

function itemUri(kind: WidgetPriorityItem["kind"], id: string, domain: DomainId) {
  if (kind === "order") return `engx://order/${encodeURIComponent(id)}?domain=${encodeURIComponent(domain)}`;
  return `engx://screen/${kind === "part" ? "inventory" : "plans"}?domain=${encodeURIComponent(domain)}`;
}

/** Pure, deterministic view-model; it never includes record details unless explicitly enabled. */
export function buildWidgetSnapshot(
  records: RecordRow[],
  options: { enabled?: boolean; domain?: DomainId; showDetails?: boolean; now?: Date } = {},
): InteractiveWidgetSnapshot {
  const enabled = options.enabled === true;
  const domain = normalizeDomain(options.domain);
  const showDetails = options.showDetails === true;
  const today = (options.now ?? new Date()).toISOString().slice(0, 10);
  const rows = records.filter(r => active(r) && normalizeDomain(r.domain) === domain);
  const orders = rows.filter((r) => r.type === "order");
  const plans = rows.filter((r) => r.type === "plan" && !["cancelled", "inactive"].includes(String(r.data.status)));
  const latestCalibration = new Map<string, RecordRow>();
  rows.filter(r => r.type === "calibration").forEach(r => { const key = r.data.device_id || r.id; const old = latestCalibration.get(key); if (!old || String(r.data.performed_at || r.updated_at) > String(old.data.performed_at || old.updated_at)) latestCalibration.set(key, r); });
  const calibrations = [...latestCalibration.values()];
  const parts = rows.filter((r) => r.type === "part");
  const openOrders = orders.filter((r) => !["closed", "cancelled"].includes(String(r.data.status))).length;
  const pendingApprovals = orders.filter((r) => String(r.data.status) === "pending_approval").length;
  const pmDue = plans.filter((r) => due(r.data.next_due, today)).length;
  const calDue = calibrations.filter((r) => due(r.data.next_due, today)).length;
  const lowStock = parts.filter((r) => Number.isFinite(Number(r.data.quantity)) && Number.isFinite(Number(r.data.min_quantity)) && Number(r.data.quantity) <= Number(r.data.min_quantity)).length;

  const candidates: Array<{ row: RecordRow; kind: WidgetPriorityItem["kind"]; date?: string }> = [
    ...orders.filter((r) => !["closed", "cancelled"].includes(String(r.data.status))).map((row) => ({ row, kind: "order" as const, date: dateOnly(row.data.due_at || row.data.detected_at) })),
    ...plans.filter((r) => due(r.data.next_due, today)).map((row) => ({ row, kind: "plan" as const, date: dateOnly(row.data.next_due) })),
    ...calibrations.filter((r) => due(r.data.next_due, today)).map((row) => ({ row, kind: "calibration" as const, date: dateOnly(row.data.next_due) })),
    ...parts.filter((r) => Number.isFinite(Number(r.data.quantity)) && Number.isFinite(Number(r.data.min_quantity)) && Number(r.data.quantity) <= Number(r.data.min_quantity)).map((row) => ({ row, kind: "part" as const })),
  ];
  candidates.sort((a, b) => (a.date || "9999-99-99").localeCompare(b.date || "9999-99-99") || a.row.updated_at.localeCompare(b.row.updated_at));
  const items = enabled ? candidates.slice(0, 3).map(({ row, kind, date }) => {
    const detail = kind === "order" ? String(row.data.description || row.data.record_code || "").trim() : kind === "part" ? String(row.data.name || row.data.record_code || "").trim() : String(row.data.reference || row.data.record_code || "").trim();
    return { id: row.id, kind, label: showDetails && detail ? detail.slice(0, 80) : genericLabel(kind), ...(date ? { date } : {}), uri: kind === "calibration" && row.data.device_id ? `engx://device/${encodeURIComponent(row.data.device_id)}?domain=${encodeURIComponent(domain)}` : itemUri(kind, row.id, domain) };
  }) : [];

  return { enabled, domain, counts: enabled ? { openOrders, pmDue, calDue, lowStock, pendingApprovals } : { openOrders: 0, pmDue: 0, calDue: 0, lowStock: 0, pendingApprovals: 0 }, items, openOrders: enabled ? openOrders : 0, pmDue: enabled ? pmDue : 0, upcoming: items.map(i=>({title:i.label,date:i.date || ""})), updatedAt: (options.now ?? new Date()).toISOString() };
}

/** Publishes only a local cached snapshot; it does not promise background synchronization. */
export function useInteractiveWidgets(): InteractiveWidgetSnapshot | undefined {
  const settings = useSettings() as WidgetSettings | undefined;
  const records = useRecords();
  const enabled = settings?.widgetsEnabled === true;
  const snapshot = useMemo(() => settings ? buildWidgetSnapshot(records, { enabled, domain: settings.activeDomain, showDetails: settings.widgetShowDetails === true }) : undefined, [records, enabled, settings?.activeDomain, settings?.widgetShowDetails]);
  useEffect(() => {
    if (!snapshot || !Capacitor.isNativePlatform()) return;
    void WidgetBridge.update(snapshot).catch(() => undefined);
  }, [snapshot]);
  return snapshot;
}

export const widgetUris = (domain: DomainId) => ({
  home: `engx://home?domain=${encodeURIComponent(domain)}`,
  newOrder: `engx://new-order?domain=${encodeURIComponent(domain)}`,
  scan: `engx://scan?domain=${encodeURIComponent(domain)}`,
  notifications: `engx://notifications?domain=${encodeURIComponent(domain)}`,
});
