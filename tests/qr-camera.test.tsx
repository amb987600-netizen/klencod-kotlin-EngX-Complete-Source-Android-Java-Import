// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {useRecords, logActivity, jsQR} = vi.hoisted(() => ({
  useRecords: vi.fn(),
  logActivity: vi.fn(() => Promise.resolve()),
  jsQR: vi.fn(),
}));

vi.mock('../src/lib', () => ({useRecords, logActivity}));
vi.mock('jsqr', () => ({default: jsQR}));

import QRReader from '../src/QRReader';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type Track = {stop: ReturnType<typeof vi.fn>};
type FakeStream = {getTracks: () => Track[]};

const record = {
  id: 'device-1',
  type: 'device',
  data: {asset_code: 'ASSET-1'},
} as any;

function stream(): {stream: FakeStream; track: Track} {
  const track = {stop: vi.fn()};
  return {track, stream: {getTracks: () => [track]}};
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {resolve = r;});
  return {promise, resolve};
}

function renderReader(props: Partial<{close: () => void; onDevice: (value: any) => void; notify: (message: string) => void}> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const close = props.close || vi.fn();
  const onDevice = props.onDevice || vi.fn();
  const notify = props.notify || vi.fn();
  act(() => root.render(<QRReader close={close} onDevice={onDevice} notify={notify} />));
  return {container, root, close, onDevice, notify};
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

function makeVideoReady() {
  const video = document.querySelector('video') as HTMLVideoElement;
  Object.defineProperty(video, 'readyState', {configurable: true, value: 4});
  Object.defineProperty(video, 'videoWidth', {configurable: true, value: 640});
  Object.defineProperty(video, 'videoHeight', {configurable: true, value: 480});
  return video;
}

beforeEach(() => {
  useRecords.mockReturnValue([record]);
  logActivity.mockClear();
  jsQR.mockReset();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({data: new Uint8ClampedArray(4), width: 1, height: 1})),
  } as any);
  Object.defineProperty(navigator, 'mediaDevices', {configurable: true, value: {getUserMedia: vi.fn()}});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('QRReader camera behavior', () => {
  it('auto-starts the environment camera with audio disabled and captures a matching record without an image', async () => {
    const {stream: camera, track} = stream();
    const getUserMedia = navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>;
    getUserMedia.mockResolvedValue(camera);
    jsQR.mockReturnValue({data: 'engx://device/device-1'});
    const onDevice = vi.fn();
    const close = vi.fn();
    const view = renderReader({onDevice, close});
    await flush();
    const video = makeVideoReady();
    act(() => video.dispatchEvent(new Event('loadeddata')));
    await flush();

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: {facingMode: {ideal: 'environment'}, width: {ideal: 1920}, height: {ideal: 1080}},
    });
    expect(video.play).toHaveBeenCalledOnce();
    const capture = [...view.container.querySelectorAll('button')].find(button => button.textContent?.includes('تصوير')) as HTMLButtonElement;
    expect(capture.disabled).toBe(false);
    act(() => capture.click());
    await flush();
    await flush();

    expect(onDevice).toHaveBeenCalledWith(record);
    expect(close).toHaveBeenCalledOnce();
    expect(logActivity).toHaveBeenCalledWith('qr_scanned', 'device', 'device-1');
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('keeps the reader open for an unknown QR and for a frame with no QR', async () => {
    const {stream: camera} = stream();
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(camera);
    const notify = vi.fn();
    const close = vi.fn();
    const view = renderReader({close, notify});
    await flush();
    const video = makeVideoReady();
    act(() => video.dispatchEvent(new Event('playing')));
    await flush();
    const capture = () => [...view.container.querySelectorAll('button')].find(button => button.textContent?.includes('تصوير')) as HTMLButtonElement;

    jsQR.mockReturnValue({data: 'engx://device/not-loaded'});
    act(() => capture().click());
    await flush();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('لا يخص جهازًا'));
    expect(close).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();

    jsQR.mockReturnValue(null);
    act(() => capture().click());
    await flush();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('لم يظهر QR'));
    expect(close).not.toHaveBeenCalled();
  });

  it('falls back to manual entry when camera permission is denied', async () => {
    const getUserMedia = navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>;
    getUserMedia.mockRejectedValue({name: 'NotAllowedError'});
    const onDevice = vi.fn();
    const close = vi.fn();
    const view = renderReader({onDevice, close});
    await flush();
    expect(view.container.textContent).toContain('السماح بالكاميرا مطلوب');

    const input = view.container.querySelector('input:not([type="file"])') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'ASSET-1');
      input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    const open = [...view.container.querySelectorAll('button')].find(button => button.textContent?.includes('فتح الجهاز')) as HTMLButtonElement;
    expect(open.disabled).toBe(false);
    act(() => open.click());
    await flush();
    await flush();
    expect(onDevice).toHaveBeenCalledWith(record);
    expect(close).toHaveBeenCalledOnce();
  });

  it.each(['close button', 'unmount'])('stops the active camera on %s', async mode => {
    const {stream: camera, track} = stream();
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(camera);
    const view = renderReader();
    await flush();
    await act(async () => { await Promise.resolve(); });
    if (mode === 'close button') {
      const closeButton = view.container.querySelector('button[aria-label="إغلاق قارئ QR"]') as HTMLButtonElement;
      act(() => closeButton.click());
    } else {
      act(() => view.root.unmount());
    }
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('stops the camera when the page becomes hidden', async () => {
    const {stream: camera, track} = stream();
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(camera);
    const view = renderReader();
    await flush();
    Object.defineProperty(document, 'hidden', {configurable: true, value: true});
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(track.stop).toHaveBeenCalledOnce();
    expect(view.container.textContent).toContain('توقفت الكاميرا');
  });

  it('stops a late stream returned after the reader has unmounted', async () => {
    const pending = deferred<FakeStream>();
    const getUserMedia = navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>;
    getUserMedia.mockReturnValue(pending.promise);
    const view = renderReader();
    act(() => view.root.unmount());
    const late = stream();
    await act(async () => {
      pending.resolve(late.stream);
      await pending.promise;
    });
    expect(late.track.stop).toHaveBeenCalledOnce();
  });
});
