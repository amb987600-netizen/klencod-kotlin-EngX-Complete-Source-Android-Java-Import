import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  db,
  init,
  getSettings,
  createRecord,
  updateRecord,
  switchDomain,
  createBackup,
  inspectBackup,
  searchRecords,
} from "../src/lib";

beforeEach(async () => {
  await db.delete();
  await db.open();
  Object.defineProperty(globalThis, "navigator", {
    value: { storage: { persist: async () => true }, onLine: false },
    configurable: true,
  });
  await init();
});

describe("domain isolation", () => {
  it("allows repeated asset codes only in different domains", async () => {
    await createRecord("device", { name: "Medical", asset_code: "SHARED-1" });
    await switchDomain("mobiles");
    await expect(createRecord("device", { name: "Mobile", asset_code: "SHARED-1" })).resolves.toBeTruthy();
    await expect(createRecord("device", { name: "Mobile 2", asset_code: "SHARED-1" })).rejects.toThrow();
  });

  it("rejects cross-domain references and scopes search", async () => {
    const device = await createRecord("device", { name: "Medical", asset_code: "REF-1" });
    await switchDomain("mobiles");
    await expect(createRecord("order", { device_id: device.id, description: "cross" })).rejects.toThrow("المرجع");
    expect(await searchRecords("Medical")).toHaveLength(0);
  });

  it("keeps mutation audit on the row domain after active section changes", async () => {
    const device = await createRecord("device", { name: "Medical", asset_code: "AUD-1" });
    await updateRecord(device.id, { name: "Updated" });
    await switchDomain("mobiles");
    const audit = (await db.audit.toArray()).filter((a) => a.entity_id === device.id);
    expect(audit.at(-1)?.domain).toBe("medical");
  });

  it("stores and restores activeDomain while keeping every section in backup", async () => {
    const medical = await createRecord("device", { name: "Medical", asset_code: "B-1" });
    await switchDomain("mobiles");
    const mobile = await createRecord("device", { name: "Mobile", asset_code: "B-1" });
    const blob = await createBackup("test-password");
    const inspected = await inspectBackup(new File([blob], "backup.engx"), "test-password");
    expect(inspected.payload.records.map((r: any) => r.id)).toEqual(expect.arrayContaining([medical.id, mobile.id]));
    expect(inspected.payload.settings.activeDomain).toBe("mobiles");
    expect((await getSettings()).activeDomain).toBe("mobiles");
  });
});
