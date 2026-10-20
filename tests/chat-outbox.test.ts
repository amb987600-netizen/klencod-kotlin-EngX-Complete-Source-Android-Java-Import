import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, init } from "../src/lib";
import { chatDb, enqueueChatMessage, retryChatMessage } from "../src/chat";

beforeEach(async () => {
  vi.restoreAllMocks();
  await chatDb.delete(); await chatDb.open();
  await db.delete(); await db.open(); await init();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
});

describe("persistent chat outbox", () => {
  it("persists voice/file payloads and never uploads while offline", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const id = await enqueueChatMessage({ text: "offline", file: { name: "voice.m4a", mime: "audio/mp4", size: 4, content: "data:audio/mp4;base64,AAAA" } });
    expect(await chatDb.outbox.get(id)).toMatchObject({ client_id: id, status: "pending", file: { mime: "audio/mp4" } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("keeps queue rows isolated by active workspace/domain and owner", async () => {
    const first = await enqueueChatMessage({ text: "medical" });
    await db.settings.update("settings", { activeDomain: "mobiles" });
    const second = await enqueueChatMessage({ text: "mobiles" });
    expect(first).not.toBe(second);
    expect((await chatDb.outbox.where("workspace_id").equals((await db.settings.get("settings"))!.workspace.id).toArray()).map((r) => r.domain).sort()).toEqual(["medical", "mobiles"]);
  });
  it("retains a stable client ID when a failed item is retried", async () => {
    const id = await enqueueChatMessage({ text: "retry" });
    await chatDb.outbox.update(id, { status: "failed", last_error: "network" });
    await retryChatMessage(id);
    expect((await chatDb.outbox.get(id))?.client_id).toBe(id);
    expect((await chatDb.outbox.get(id))?.status).toBe("pending");
  });
});
