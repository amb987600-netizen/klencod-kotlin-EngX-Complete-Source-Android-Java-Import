import { describe, expect, it } from "vitest";
import { parseAction, parseModelAction } from "../src/agentActions";

describe("agent action parsing", () => {
  it("parses Arabic synonyms and hamza normalization", () => {
    expect(parseAction("ضيف جهاز: جهاز ضغط | كود: EQ-010")).toEqual({ action: "create_device", args: { name: "جهاز ضغط", asset_code: "EQ-010" } });
    expect(parseAction("أنشئ جهاز: جهاز شفط | كود: EQ-011")).toEqual({ action: "create_device", args: { name: "جهاز شفط", asset_code: "EQ-011" } });
  });
  it("parses order, search, and report requests", () => {
    expect(parseAction("افتح أمر صيانة للجهاز EQ-010 | العطل: لا يعمل")).toEqual({ action: "create_order", args: { device_code: "EQ-010", description: "لا يعمل" } });
    expect(parseAction("ابحث عن EQ-010")?.action).toBe("search");
    expect(parseAction("جهز تقرير شهر يناير")).toEqual({ action: "prepare_report", args: { title: "شهر يناير" } });
  });
  it("accepts only the exact safe model schema", () => {
    expect(parseModelAction('```json\n{"action":"search","args":{"query":"EQ-010"}}\n```')).toEqual({ action: "search", args: { query: "EQ-010" } });
    expect(parseModelAction('{"action":"create_device","args":{"name":"X","asset_code":"EQ-1"}}')).not.toBeNull();
    expect(parseModelAction('{"action":"create_device","args":{"name":"X","asset_code":"EQ-1","role":"admin"}}')).toBeNull();
    expect(parseModelAction('{"action":"delete","args":{"id":"x"}}')).toBeNull();
    expect(parseModelAction('not json')).toBeNull();
  });
  it("does not treat unsupported business requests as tools", () => {
    expect(parseAction("احذف الجهاز EQ-010")).toBeNull();
    expect(parseAction("اعتماد نهائي لأمر الصيانة")).toBeNull();
  });
});
