const enc = new TextEncoder();
function b64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s: string) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
async function key(password: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function encryptBackup(payload: any, password: string) {
  if (password.length < 10)
    throw Error("كلمة مرور النسخة لا تقل عن 10 أحرف؛ احفظها خارج الهاتف");
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12)),
    iterations = 310000;
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(password, salt, iterations),
    enc.encode(JSON.stringify(payload)),
  );
  return new Blob(
    [
      JSON.stringify({
        format: "engx-encrypted",
        version: 1,
        cipher: "AES-256-GCM",
        kdf: "PBKDF2-SHA256",
        iterations,
        salt: b64(salt),
        iv: b64(iv),
        data: b64(new Uint8Array(encrypted)),
      }),
    ],
    { type: "application/json" },
  );
}
export async function decryptBackup(text: string, password: string) {
  try {
    const p = JSON.parse(text);
    if (
      p.format !== "engx-encrypted" ||
      p.version !== 1 ||
      p.cipher !== "AES-256-GCM" ||
      p.kdf !== "PBKDF2-SHA256" ||
      p.iterations !== 310000
    )
      throw Error("format");
    const salt = unb64(p.salt),
      iv = unb64(p.iv);
    if (salt.length !== 16 || iv.length !== 12) throw Error("format");
    const clear = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      await key(password, salt, p.iterations),
      unb64(p.data) as BufferSource,
    );
    return JSON.parse(new TextDecoder().decode(clear));
  } catch {
    throw Error("كلمة المرور غير صحيحة أو ملف النسخة تالف/غير مدعوم");
  }
}
