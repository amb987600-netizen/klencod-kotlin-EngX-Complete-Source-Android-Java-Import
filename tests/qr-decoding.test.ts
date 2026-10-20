// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import QRCode from 'qrcode';
import {decodeQRImage, cameraErrorMessage} from '../src/QRReader';

afterEach(() => vi.restoreAllMocks());

function pixelsFor(text: string, inverted = false) {
  const qr = QRCode.create(text, {errorCorrectionLevel: 'M'});
  const cell = 7, margin = 4;
  const width = (qr.modules.size + 2 * margin) * cell;
  const data = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const mx = Math.floor(x / cell) - margin, my = Math.floor(y / cell) - margin;
    const dark = mx >= 0 && my >= 0 && mx < qr.modules.size && my < qr.modules.size && qr.modules.get(my, mx);
    const value = (inverted ? !dark : dark) ? 0 : 255;
    const offset = (y * width + x) * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return {data, width, height: width};
}

it.each([false, true])('decodes a real generated QR locally (inverted=%s)', inverted => {
  const text = 'engx://device/01DEVICE-TEST';
  const image = pixelsFor(text, inverted);
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({drawImage, getImageData: () => image} as any);
  expect(decodeQRImage({} as CanvasImageSource, image.width, image.height)).toBe(text);
  expect(drawImage).toHaveBeenCalledOnce();
});

it('rejects frames before the camera has image dimensions', () => {
  expect(() => decodeQRImage({} as CanvasImageSource, 0, 0)).toThrow('انتظر');
});

it('explains camera permission denial and preserves alternatives', () => {
  expect(cameraErrorMessage({name: 'NotAllowedError'})).toContain('إعدادات الهاتف');
  expect(cameraErrorMessage({name: 'NotFoundError'})).toContain('صورة');
  expect(cameraErrorMessage({name: 'NotReadableError'})).toContain('مستخدمة');
});
