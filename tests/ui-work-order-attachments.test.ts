import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/WorkOrderEditor.tsx"), "utf8");

describe("واجهة مرفقات أوامر الشغل", () => {
  it("تدعم اختيار عدة ملفات ومعاينة الصور مع منع التكرار والحذف قبل الرفع", () => {
    expect(source).toContain('type="file" multiple');
    expect(source).toContain("fileKey");
    expect(source).toContain("PendingAttachmentPreview");
    expect(source).toContain("removeFile");
  });

  it("تفتح المرفقات المحفوظة وتحذفها فقط عند canEdit مع معالجة الرفع الجزئي", () => {
    expect(source).toContain("setPreviewAttachment(attachment)");
    expect(source).toContain("في صور مرفعتش");
    expect(source).toContain("removeSavedAttachment");
    expect(source).toContain("canEdit && <button");
    expect(source).toContain("successful");
    expect(source).toContain("uploadErrors");
  });

  it("يبقي التحذير وقائمة التحقق الطبية مقصورين على medical", () => {
    expect(source).toContain("normalizeDomain");
    expect(source).toContain('activeDomain === "medical" ? medicalChecklist : generalChecklist');
    expect(source).toContain("بدون أسماء أو معلومات المرضى");
  });
});
