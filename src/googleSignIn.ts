import { Capacitor } from "@capacitor/core";
import { SocialLogin } from "@capgo/capacitor-social-login";

const GOOGLE_CLIENT_ID_RE = /^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;
const PLACEHOLDER_RE = /REPLACE_WITH|YOUR_|CHANGE_ME|example\.com/i;

function requireClientId(value: string | undefined, name: string): string {
  const id = value?.trim() ?? "";
  if (!id || PLACEHOLDER_RE.test(id) || !GOOGLE_CLIENT_ID_RE.test(id)) {
    throw new Error(`إعداد ${name} غير موجود أو غير صالح؛ اضبط معرّف Google OAuth الحقيقي أولًا`);
  }
  return id;
}

/**
 * Starts native Google online sign-in and returns only the verified-by-backend ID token.
 * The web client ID must come from the server's /api/config googleClientId response.
 */
export async function nativeGoogleCredential(webClientId?: string): Promise<string> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("استخدم زر جوجل الخاص بالويب في المتصفح");
  }

  const configuredWebId = webClientId ?? (import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID as string | undefined);
  const webId = requireClientId(configuredWebId, "Google web client ID");
  const iosId = import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID as string | undefined;
  const platform = Capacitor.getPlatform();
  if (platform === "ios") requireClientId(iosId, "Google iOS client ID");
  if (platform !== "android" && platform !== "ios") {
    throw new Error(`Native Google sign-in is unsupported on platform ${platform}`);
  }

  await SocialLogin.initialize({
    google: {
      webClientId: webId,
      iOSClientId: platform === "ios" ? requireClientId(iosId, "Google iOS client ID") : undefined,
      iOSServerClientId: webId,
      mode: "online",
    },
  });

  const response = await SocialLogin.login({
    provider: "google",
    options: { scopes: ["email", "profile"] },
  });
  const idToken = "idToken" in response.result ? response.result.idToken : null;
  if (!idToken) throw new Error("لم يُرجع Google إثبات الهوية؛ راجع إعدادات OAuth");
  return idToken;
}

/** Best-effort local Google SDK sign-out; this never revokes the Google account. */
export async function nativeGoogleLogout(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await SocialLogin.logout({ provider: "google" });
  } catch {
    // Logout is deliberately best-effort; the server session is cleared separately.
  }
}
