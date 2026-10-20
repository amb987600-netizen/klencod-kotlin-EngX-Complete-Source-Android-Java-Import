import { describe, expect, it } from "vitest";
import { buildWidgetSnapshot } from "../src/widgets";
import type { RecordRow } from "../src/lib";

const row = (type: RecordRow["type"], id: string, data: Record<string, unknown>): RecordRow => ({
  id, type, workspace_id: "w", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null, created_by: "u", domain: "medical", data, version: 1, sync_status: "synced",
});

describe("interactive widget snapshots", () => {
  const records: RecordRow[] = [
    row("order", "order-1", { status: "pending_approval", description: "Sensitive customer detail" }),
    row("plan", "plan-1", { status: "active", next_due: "2026-01-01", reference: "PM detail" }),
    row("calibration", "cal-1", { next_due: "2026-01-01", reference: "Calibration detail" }),
    row("part", "part-1", { name: "Secret part name", quantity: 1, min_quantity: 2 }),
  ];

  it("exposes requested counts and generic priority names when details are off", () => {
    const snapshot = buildWidgetSnapshot(records, { enabled: true, domain: "medical", showDetails: false, now: new Date("2026-01-02T00:00:00Z") });
    expect(snapshot.domain).toBe("medical");
    expect(snapshot.counts).toEqual({ openOrders: 1, pmDue: 1, calDue: 1, lowStock: 1, pendingApprovals: 1 });
    expect(snapshot.items).toHaveLength(3);
    expect(snapshot.items.map((item) => item.label)).not.toContain("Sensitive customer detail");
    expect(snapshot.items[0].uri).toContain("domain=medical");
    expect(snapshot.items.some((item) => item.uri.includes("engx://order/order-1"))).toBe(true);
  });

  it("does not leak records from another section", () => {
    const snapshot = buildWidgetSnapshot(records, { enabled: true, domain: "sales" });
    expect(snapshot.items).toHaveLength(0); expect(snapshot.counts.openOrders).toBe(0);
  });
  it("keeps counts and details hidden when the widget is not opted in", () => {
    const snapshot = buildWidgetSnapshot(records, { enabled: false, domain: "medical", showDetails: true });
    expect(snapshot.counts).toEqual({ openOrders: 0, pmDue: 0, calDue: 0, lowStock: 0, pendingApprovals: 0 });
    expect(snapshot.items).toHaveLength(0);
    expect(JSON.stringify(snapshot)).not.toContain("Sensitive customer detail");
  });

  it("allows detail labels only with the explicit privacy toggle", () => {
    const snapshot = buildWidgetSnapshot(records, { enabled: true, showDetails: true, now: new Date("2026-01-02T00:00:00Z") });
    expect(snapshot.items.map((item) => item.label)).toContain("Sensitive customer detail");
  });
});
