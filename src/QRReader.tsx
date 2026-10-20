import ClearableInput from './ClearableInput';
import {useCallback, useEffect, useRef, useState} from 'react';
import {App as NativeApp} from '@capacitor/app';
import {Capacitor} from '@capacitor/core';
import jsQR from 'jsqr';
import {Camera, X} from 'lucide-react';
import * as lib from './lib';
import './qr-reader.css';

const NO_CODE = 'لم يظهر QR واضح. صوّر الرمز عن قرب بإضاءة جيدة أو أدخل كود الجهاز.';

export function decodeQRImage(source: CanvasImageSource, width: number, height: number): string {
  if (!width || !height) throw Error('انتظر حتى تظهر صورة الكاميرا ثم صوّر الرمز.');
  const scale = Math.min(1, 1800 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (!context) throw Error('تعذر تجهيز قارئ الصورة');
  try {
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(pixels.data, pixels.width, pixels.height, {inversionAttempts: 'attemptBoth'});
    if (!result) throw Error(NO_CODE);
    return result.data;
  } finally {
    // Release the temporary photograph; it is never stored or uploaded.
    canvas.width = canvas.height = 0;
  }
}

export function cameraErrorMessage(error: unknown): string {
  const name = (error as {name?: string})?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError')
    return 'السماح بالكاميرا مطلوب لتصوير QR. فعّل إذن الكاميرا للتطبيق من إعدادات الهاتف، ثم اضغط «فتح الكاميرا». ويمكنك اختيار صورة أو إدخال الكود.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError')
    return 'لا توجد كاميرا متاحة. اختر صورة QR محفوظة أو أدخل كود الجهاز.';
  if (name === 'NotReadableError' || name === 'TrackStartError')
    return 'الكاميرا مستخدمة أو غير متاحة الآن. أغلق أي تطبيق يستخدمها ثم أعد المحاولة.';
  return 'تعذر فتح الكاميرا داخل التطبيق. أعد المحاولة أو اختر صورة QR أو أدخل الكود. في المتصفح يلزم HTTPS أو localhost.';
}

export default function QRReader({close, onDevice, notify}: any) {
  const records = lib.useRecords('device');
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState('');
  const [cameraState, setCameraState] = useState<'idle' | 'starting' | 'ready'>('idle');
  const [cameraMessage, setCameraMessage] = useState('');
  const [videoReady, setVideoReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const busyRef = useRef(false);

  const stopCamera = useCallback(() => {
    generationRef.current += 1;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (mountedRef.current) {
      setCameraState('idle');
      setVideoReady(false);
    }
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    const generation = generationRef.current;
    setCameraMessage('');
    setCameraState('starting');
    let stream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Error('Camera unavailable');
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {facingMode: {ideal: 'environment'}, width: {ideal: 1920}, height: {ideal: 1080}},
      });
      // A permission prompt can finish after the dialog is closed or app is hidden.
      if (!mountedRef.current || generation !== generationRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw Error('Camera preview unavailable');
      video.srcObject = stream;
      await video.play();
      if (!mountedRef.current || generation !== generationRef.current) return;
      setCameraState('ready');
      setVideoReady(video.readyState >= 2 && video.videoWidth > 0);
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (!mountedRef.current || generation !== generationRef.current) return;
      stopCamera();
      setCameraMessage(cameraErrorMessage(error));
    }
  }, [stopCamera]);

  useEffect(() => {
    mountedRef.current = true;
    void startCamera();
    const onVisibility = () => {
      if (document.hidden) {
        stopCamera();
        setCameraMessage('توقفت الكاميرا لحماية خصوصيتك. اضغط «فتح الكاميرا» للمتابعة.');
      }
    };
    const onPageHide = () => stopCamera();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    const nativeListener = Capacitor.isNativePlatform()
      ? NativeApp.addListener('appStateChange', ({isActive}) => {
        if (!isActive) {
          stopCamera();
          if (mountedRef.current) setCameraMessage('توقفت الكاميرا لحماية خصوصيتك. اضغط «فتح الكاميرا» للمتابعة.');
        }
      })
      : null;
    return () => {
      mountedRef.current = false;
      stopCamera();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      if (nativeListener) void nativeListener.then(listener => listener.remove()).catch(() => {});
    };
  }, [startCamera, stopCamera]);

  const dismiss = () => {stopCamera(); close();};
  const resolve = async (text: string) => {
    let id = '';
    try {
      const url = new URL(text.trim());
      if (url.protocol === 'engx:' && url.hostname === 'device') id = decodeURIComponent(url.pathname.replace(/^\//, ''));
      else if (url.protocol === 'https:' || url.protocol === 'http:') id = url.searchParams.get('device') || '';
    } catch { /* Plain asset codes are supported too. */ }
    const device = records.find(r => r.id === (id || text.trim()) || String(r.data.asset_code).toLowerCase() === text.trim().toLowerCase());
    if (!device) throw Error('الرمز لا يخص جهازًا محملًا في مساحة العمل الحالية. اتصل للمزامنة أو راجع كود الجهاز.');
    await lib.logActivity('qr_scanned', 'device', device.id);
    if (!mountedRef.current) return;
    stopCamera();
    onDevice(device);
    close();
  };

  const run = async (work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {await work();}
    catch (error) {if (mountedRef.current) notify(error instanceof Error ? error.message : 'تعذر قراءة الرمز');}
    finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  const capture = () => run(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) throw Error('انتظر حتى تظهر صورة الكاميرا ثم صوّر الرمز.');
    await resolve(decodeQRImage(video, video.videoWidth, video.videoHeight));
  });

  const read = (file?: File) => {
    if (!file) return;
    stopCamera();
    return run(async () => {
      if (file.size > 20 * 1024 * 1024) throw Error('اختر صورة أقل من 20 ميجابايت');
      const url = URL.createObjectURL(file);
      try {
        const image = await new Promise<HTMLImageElement>((resolveImage, reject) => {
          const img = new Image();
          img.onload = () => resolveImage(img);
          img.onerror = () => reject(Error('تعذر فتح الصورة. جرّب صورة JPEG أو PNG.'));
          img.src = url;
        });
        if (!mountedRef.current) return;
        await resolve(decodeQRImage(image, image.naturalWidth, image.naturalHeight));
      } finally {URL.revokeObjectURL(url);}
    });
  };

  return <div className="modal-backdrop"><section className="modal qr-reader" role="dialog" aria-modal="true" aria-label="قراءة QR">
    <div className="modal-head"><h2>قراءة QR للجهاز</h2><button className="icon-btn" aria-label="إغلاق قارئ QR" onClick={dismiss}><X/></button></div>
    <p>وجّه الكاميرا إلى QR واضغط «تصوير وقراءة الكود» لفتح الجهاز. القراءة محلية دون رفع الصورة.</p>
    <div className="qr-camera-preview" aria-label="معاينة كاميرا QR">
      <video ref={videoRef} autoPlay muted playsInline onLoadedData={() => setVideoReady(true)} onPlaying={() => setVideoReady(true)} />
      {cameraState !== 'ready' && <div className="qr-camera-placeholder" role="status">{cameraState === 'starting' ? 'جارٍ فتح الكاميرا…' : 'الكاميرا متوقفة'}</div>}
    </div>
    {cameraMessage && <p className="qr-camera-message" role="status">{cameraMessage}</p>}
    <div className="button-row">
      {cameraState === 'ready' ? <>
        <button className="primary" disabled={busy || !videoReady} onClick={() => void capture()}><Camera size={20}/>{busy ? 'جارٍ قراءة الرمز…' : 'تصوير وقراءة الكود'}</button>
        <button className="secondary" disabled={busy} onClick={stopCamera}>إيقاف الكاميرا</button>
      </> : <button className="primary" disabled={busy || cameraState === 'starting'} onClick={() => void startCamera()}><Camera size={20}/>فتح الكاميرا</button>}
      <label className="secondary qr-image-picker">اختيار صورة QR<input aria-label="صورة QR محفوظة" disabled={busy} type="file" accept="image/*" onChange={e => {const file = e.target.files?.[0]; e.target.value = ''; void read(file);}}/></label>
    </div>
    <p className="muted">لا تصوّر مرضى أو مستندات تحتوي بياناتهم. لا تُحفظ الصورة في التطبيق أو معرض الهاتف، وتتوقف الكاميرا عند الإغلاق أو مغادرة التطبيق.</p>
    <label>أو أدخل كود الجهاز أو رابط QR<ClearableInput value={manual} disabled={busy} onChange={e => setManual(e.target.value)}/></label>
    <button className="secondary" disabled={busy || !manual.trim()} onClick={() => void run(() => resolve(manual))}>فتح الجهاز</button>
  </section></div>;
}
