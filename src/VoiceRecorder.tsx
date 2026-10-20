import { useEffect, useRef, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Mic } from "lucide-react";
import "./voice.css";

const MAX_SECONDS = 5 * 60;
const MAX_BYTES = 10 * 1024 * 1024;
const codecs = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

export type VoiceRecorderProps = {
  disabled?: boolean;
  scopeKey: string;
  onSend: (file: File) => Promise<void> | void;
  notify?: (message: string) => void;
};

const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
const say = (notify: VoiceRecorderProps["notify"], message: string) => notify?.(message);
const supportedMime = () => codecs.find((mime) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(mime)) || "";

export default function VoiceRecorder({ disabled, scopeKey, onSend, notify }: VoiceRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [preview, setPreview] = useState<File | null>(null);
  const [sending, setSending] = useState(false);

  const mounted = useRef(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const recordingRef = useRef(false);
  const cancelled = useRef(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const bytes = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const previewUrl = useRef<string | undefined>(undefined);
  const elapsedRef = useRef(0);

  const disposeStream = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };
  const clearTimer = () => {
    if (timer.current !== undefined) window.clearInterval(timer.current);
    timer.current = undefined;
  };
  const clearPreview = () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = undefined;
    if (mounted.current) setPreview(null);
  };
  const cancel = () => {
    generation.current += 1;
    cancelled.current = true;
    pending.current = false;
    clearTimer();
    const active = recorder.current;
    if (active) {
      // Detach first: a queued onstop must never turn a cancelled session into a preview.
      active.ondataavailable = null;
      active.onstop = null;
      active.onerror = null;
      if (active.state !== "inactive") {
        try { active.stop(); } catch { /* already stopping */ }
      }
    }
    recorder.current = null;
    disposeStream();
    recordingRef.current = false;
    if (mounted.current) {
      setRecording(false);
      setElapsed(0);
      setPreviewDuration(0);
    }
    elapsedRef.current = 0;
    chunks.current = [];
    bytes.current = 0;
    clearPreview();
  };

  useEffect(() => {
    mounted.current = true;
    const hide = () => {
      if (document.visibilityState !== "visible" && (recordingRef.current || pending.current)) cancel();
    };
    const pageHide = () => {
      if (recordingRef.current || pending.current) cancel();
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", pageHide);
    let disposed = false;
    let removeNative: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) {
      void App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive && (recordingRef.current || pending.current)) cancel();
      }).then((handle) => {
        if (disposed) void handle.remove();
        else removeNative = () => { void handle.remove(); };
      });
    }
    return () => {
      disposed = true;
      mounted.current = false;
      cancel();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", pageHide);
      removeNative?.();
    };
  }, []);

  useEffect(() => {
    if (!mounted.current) return;
    cancel();
  }, [scopeKey]);

  const stop = () => {
    const active = recorder.current;
    if (!active || active.state === "inactive") return;
    try { active.stop(); } catch { say(notify, "تعذر إيقاف التسجيل"); }
  };

  const start = async () => {
    if (disabled || recordingRef.current || pending.current || preview || !mounted.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      say(notify, "التسجيل الصوتي غير مدعوم على هذا الجهاز");
      return;
    }
    const session = ++generation.current;
    pending.current = true;
    cancelled.current = false;
    try {
      const got = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || generation.current !== session || cancelled.current || disabled || document.visibilityState !== "visible") {
        got.getTracks().forEach((track) => track.stop());
        return;
      }
      pending.current = false;
      stream.current = got;
      chunks.current = [];
      bytes.current = 0;
      const mime = supportedMime();
      const active = new MediaRecorder(got, mime ? { mimeType: mime } : undefined);
      recorder.current = active;
      const actualType = active.mimeType || mime || "audio/mp4";
      active.ondataavailable = (event) => {
        if (generation.current !== session || cancelled.current) return;
        bytes.current += event.data.size;
        if (bytes.current > MAX_BYTES) {
          say(notify, "حجم التسجيل يتجاوز 10 م.ب");
          cancel();
          return;
        }
        if (event.data.size) chunks.current.push(event.data);
      };
      active.onerror = () => {
        if (generation.current === session && !cancelled.current) {
          say(notify, "تعذر تسجيل الصوت");
          cancel();
        }
      };
      active.onstop = () => {
        if (generation.current !== session || cancelled.current || !mounted.current) return;
        clearTimer();
        const blob = new Blob(chunks.current, { type: actualType });
        disposeStream();
        recorder.current = null;
        recordingRef.current = false;
        setRecording(false);
        const duration = Math.min(elapsedRef.current, MAX_SECONDS);
        setElapsed(duration);
        chunks.current = [];
        bytes.current = 0;
        if (blob.size > MAX_BYTES) {
          say(notify, "حجم التسجيل يتجاوز 10 م.ب");
          setPreviewDuration(0);
          return;
        }
        const extension = blob.type.includes("webm") ? "webm" : blob.type.includes("ogg") ? "ogg" : "mp4";
        const file = new File([blob], `voice-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`, { type: blob.type || "audio/mp4" });
        previewUrl.current = URL.createObjectURL(file);
        setPreviewDuration(duration);
        setPreview(file);
      };
      active.start(250);
      recordingRef.current = true;
      setRecording(true);
      elapsedRef.current = 0;
      setElapsed(0);
      timer.current = window.setInterval(() => {
        if (generation.current !== session || cancelled.current) return;
        setElapsed((value) => {
          const next = Math.min(value + 1, MAX_SECONDS);
          elapsedRef.current = next;
          if (next >= MAX_SECONDS) stop();
          return next;
        });
      }, 1000);
    } catch (error) {
      pending.current = false;
      disposeStream();
      if (mounted.current && generation.current === session && !cancelled.current) {
        say(notify, error instanceof DOMException && error.name === "NotAllowedError" ? "اسمح بالميكروفون من إعدادات الجهاز ثم أعد المحاولة" : "تعذر الوصول إلى الميكروفون");
      }
    }
  };

  const send = async () => {
    if (!preview || sending) return;
    setSending(true);
    try { await onSend(preview); clearPreview(); setPreviewDuration(0); }
    catch (error) { say(notify, error instanceof Error ? error.message : "تعذر حفظ التسجيل"); }
    finally { setSending(false); }
  };

  return <div className="voice-recorder">
    {!recording && !preview && <button type="button" className="voice-mic" onClick={() => void start()} disabled={disabled} aria-label="تسجيل رسالة صوتية"><Mic size={16} aria-hidden="true" /> تسجيل صوتي</button>}
    {recording && <div className="voice-active"><span className="voice-pulse" /> <strong>{clock(elapsed)}</strong><button type="button" onClick={stop}>إيقاف</button><button type="button" onClick={cancel}>إلغاء</button><small>الحد الأقصى 05:00</small></div>}
    {preview && <div className="voice-preview"><audio controls preload="metadata" src={previewUrl.current} /><span>{clock(previewDuration)}</span><button type="button" onClick={cancel} disabled={sending}>إلغاء</button><button type="button" onClick={cancel} disabled={sending}>إعادة التسجيل</button><button type="button" onClick={() => void send()} disabled={sending}>{sending ? "جارٍ الحفظ…" : "إرسال"}</button></div>}
  </div>;
}
