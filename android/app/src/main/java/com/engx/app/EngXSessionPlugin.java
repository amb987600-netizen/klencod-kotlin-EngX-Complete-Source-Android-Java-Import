package com.engx.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "EngXSession")
public class EngXSessionPlugin extends Plugin {
    private static final String PREFS = "engx_secure_sessions";
    private static final String KEY_ALIAS = "engx_session_aes_gcm";
    private static final String DATA = "accounts";

    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        if (!ks.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setUserAuthenticationRequired(false).build());
            generator.generateKey();
        }
        return ((KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null)).getSecretKey();
    }
    private JSONObject read() throws Exception {
        String packed = prefs().getString(DATA, ""); if (packed.isEmpty()) return new JSONObject();
        byte[] all = Base64.decode(packed, Base64.NO_WRAP); byte[] iv = new byte[12]; byte[] cipher = new byte[all.length - 12];
        System.arraycopy(all, 0, iv, 0, 12); System.arraycopy(all, 12, cipher, 0, cipher.length);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        return new JSONObject(new String(c.doFinal(cipher), StandardCharsets.UTF_8));
    }
    private void write(JSONObject value) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key()); byte[] iv = c.getIV(); byte[] cipher = c.doFinal(value.toString().getBytes(StandardCharsets.UTF_8));
        byte[] all = new byte[iv.length + cipher.length]; System.arraycopy(iv, 0, all, 0, iv.length); System.arraycopy(cipher, 0, all, iv.length, cipher.length);
        if (!prefs().edit().putString(DATA, Base64.encodeToString(all, Base64.NO_WRAP)).commit()) throw new java.io.IOException("Secure store commit failed");
    }
    private SharedPreferences prefs() { return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    private void fail(PluginCall call, Exception e) { call.reject("تعذر الوصول إلى التخزين الآمن", "SECURE_STORE_ERROR"); }

    @PluginMethod public void save(PluginCall call) { try { JSONObject all = read(); all.put(call.getString("id"), new JSONObject().put("token", call.getString("token")).put("account", call.getObject("account"))); write(all); call.resolve(); } catch (Exception e) { fail(call, e); } }
    @PluginMethod public void get(PluginCall call) { try { JSONObject item = read().optJSONObject(call.getString("id")); JSObject out = new JSObject(); if (item != null) { out.put("token", item.optString("token", "")); out.put("account", item.optJSONObject("account")); } call.resolve(out); } catch (Exception e) { fail(call, e); } }
    @PluginMethod public void remove(PluginCall call) { try { JSONObject all = read(); String id = call.getString("id"); JSONObject item = all.optJSONObject(id); if (Boolean.TRUE.equals(call.getBoolean("keepIdentifier")) && item != null) item.remove("token"); else all.remove(id); write(all); call.resolve(); } catch (Exception e) { fail(call, e); } }
    @PluginMethod public void list(PluginCall call) { try { JSONArray out = new JSONArray(); JSONObject all = read(); java.util.Iterator<String> it = all.keys(); while (it.hasNext()) { JSONObject account = all.getJSONObject(it.next()).optJSONObject("account"); if (account != null) out.put(account); } call.resolve(new JSObject().put("accounts", new JSArray(out.toString()))); } catch (Exception e) { fail(call, e); } }
}
