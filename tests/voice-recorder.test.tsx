// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VoiceRecorder from "../src/VoiceRecorder";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Track = { stop: ReturnType<typeof vi.fn> };
type FakeStream = { getTracks: () => Track[] };

class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => true);
  static instances: FakeMediaRecorder[] = [];
  state = "inactive";
  mimeType = "audio/mp4";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public stream: FakeStream, public options?: MediaRecorderOptions) { FakeMediaRecorder.instances.push(this); }
  start = vi.fn(() => { this.state = "recording"; });
  stop = vi.fn(() => { this.state = "inactive"; this.onstop?.(); });
  emit = (blob: Blob) => this.ondataavailable?.({ data: blob });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function makeStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] }, track };
}
function render(props: Partial<React.ComponentProps<typeof VoiceRecorder>> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(<VoiceRecorder scopeKey="one" onSend={vi.fn()} {...props} />));
  return { container, root };
}
function button(container: HTMLElement, text: string) {
  return [...container.querySelectorAll("button")].find(b => b.textContent?.includes(text)) as HTMLButtonElement;
}
async function flush() { await act(async () => { await Promise.resolve(); }); }

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn() } });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("VoiceRecorder", () => {
  it("does not request permission until the mic button is clicked and prevents a double request while pending", async () => {
    const pending = deferred<FakeStream>();
    const getUserMedia = navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>;
    getUserMedia.mockReturnValue(pending.promise);
    const view = render();
    expect(getUserMedia).not.toHaveBeenCalled();
    act(() => button(view.container, "تسجيل صوتي").click());
    act(() => button(view.container, "تسجيل صوتي").click());
    expect(getUserMedia).toHaveBeenCalledOnce();
    act(() => pending.resolve(makeStream().stream));
    await flush();
    view.root.unmount();
  });

  it("stops a stream returned after unmount and never starts a stale recording", async () => {
    const pending = deferred<FakeStream>();
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockReturnValue(pending.promise);
    const view = render();
    act(() => button(view.container, "تسجيل صوتي").click());
    act(() => view.root.unmount());
    const late = makeStream();
    await act(async () => { pending.resolve(late.stream); await pending.promise; });
    expect(late.track.stop).toHaveBeenCalledOnce();
  });

  it("cancels recording without allowing the late onstop callback to create a preview", async () => {
    const media = makeStream();
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(media.stream);
    const view = render();
    act(() => button(view.container, "تسجيل صوتي").click());
    await flush();
    expect(button(view.container, "إلغاء")).toBeTruthy();
    act(() => button(view.container, "إلغاء").click());
    expect(view.container.querySelector("audio")).toBeNull();
    expect(media.track.stop).toHaveBeenCalledOnce();
    expect(FakeMediaRecorder.instances[0].onstop).toBeNull();
  });

  it("stops into a preview with a separate duration and exposes cancel, rerecord, and send controls", async () => {
    const media = makeStream();
    const send = vi.fn();
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(media.stream);
    const view = render({ onSend: send });
    act(() => button(view.container, "تسجيل صوتي").click());
    await flush();
    expect(button(view.container, "إيقاف")).toBeTruthy();
    const target = FakeMediaRecorder.instances[0];
    target.emit(new Blob(["voice"], { type: "audio/mp4" }));
    act(() => target.stop());
    expect(view.container.querySelector("audio")).toBeTruthy();
    expect(view.container.textContent).toContain("00:00");
    expect(button(view.container, "إعادة التسجيل")).toBeTruthy();
    expect(button(view.container, "إرسال")).toBeTruthy();
  });

  it("cleans up when the recording scope changes", async () => {
    const media = makeStream();
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(media.stream);
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<VoiceRecorder scopeKey="one" onSend={vi.fn()} />));
    act(() => button(container, "تسجيل صوتي").click()); await flush();
    act(() => root.render(<VoiceRecorder scopeKey="two" onSend={vi.fn()} />));
    expect(media.track.stop).toHaveBeenCalledOnce();
    expect(container.querySelector("audio")).toBeNull();
    root.unmount();
  });

  it("reports denied permission and disposes any returned stream", async () => {
    const notify = vi.fn();
    const error = new DOMException("denied", "NotAllowedError");
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValue(error);
    const view = render({ notify });
    act(() => button(view.container, "تسجيل صوتي").click());
    await flush();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("اسمح بالميكروفون"));
    expect(button(view.container, "تسجيل صوتي")).toBeTruthy();
  });

  it("cancels on pagehide", async () => {
    const media = makeStream();
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(media.stream);
    const view = render();
    act(() => button(view.container, "تسجيل صوتي").click()); await flush();
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(media.track.stop).toHaveBeenCalledOnce();
    expect(button(view.container, "تسجيل صوتي")).toBeTruthy();
  });
});
