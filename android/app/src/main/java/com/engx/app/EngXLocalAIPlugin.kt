package com.engx.app

import android.os.Build
import android.os.StatFs
import android.util.Base64
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicBoolean

@CapacitorPlugin(name = "EngXLocalAI")
class EngXLocalAIPlugin : Plugin() {
    companion object {
        private const val MODEL = "Gemma 4 E2B"
        private const val VERSION = "0.18.0"
        private const val SIZE = 2_588_147_712L
        private const val SHA256 = "181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c"
        private const val MODEL_URL = "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/41c5569623a7c189d6eec3e5225260c58cedbce7/gemma-4-E2B-it.litertlm"
        private const val MAX_PROMPT = 12_000
        private const val MIN_FREE_EXTRA = 512L * 1024L * 1024L
    }

    private val serial: ExecutorService = Executors.newSingleThreadExecutor()
    private val cancelled = AtomicBoolean(false)
    private val downloading = AtomicBoolean(false)
    @Volatile private var downloadedBytes = 0L
    @Volatile private var downloadFuture: Future<*>? = null
    @Volatile private var activeConnection: HttpURLConnection? = null
    private val modelFile: File get() = File(context.filesDir, "gemma-4-E2B-it.litertlm")
    private val partialFile: File get() = File(context.filesDir, "model.part")

    private fun status(error: String? = null): JSObject = JSObject().apply {
        put("supported", Build.SUPPORTED_ABIS.any { it == "arm64-v8a" })
        put("downloaded", modelFile.isFile && modelFile.length() == SIZE)
        put("downloading", downloading.get())
        put("progress", if (modelFile.isFile && modelFile.length() == SIZE) 1.0 else (downloadedBytes.toDouble() / SIZE).coerceIn(0.0, 1.0))
        put("downloadedBytes", if (modelFile.isFile && modelFile.length() == SIZE) SIZE else downloadedBytes)
        put("model", MODEL); put("sizeBytes", SIZE); put("version", VERSION)
        if (error != null) put("error", error)
    }

    @PluginMethod
    fun status(call: PluginCall) { call.resolve(status()) }

    @PluginMethod
    fun download(call: PluginCall) {
        if (!status().getBoolean("supported")) { call.reject("هذا الجهاز لا يدعم تشغيل الذكاء الاصطناعي المحلي (ARM64 مطلوب)"); return }
        if (modelFile.isFile && modelFile.length() == SIZE) { call.resolve(status()); return }
        if (!downloading.compareAndSet(false, true)) { call.resolve(status()); return }
        val available = StatFs(context.filesDir.path).availableBytes
        if (available < SIZE + MIN_FREE_EXTRA) { downloading.set(false); call.reject("المساحة الحرة غير كافية لتنزيل النموذج بأمان"); return }
        cancelled.set(false); downloadedBytes = 0L
        downloadFuture = serial.submit {
            try {
                partialFile.delete()
                var downloaded = 0L
                val connection = openModelConnection()
                activeConnection = connection
                try {
                    connection.connect()
                    val response = connection.responseCode
                    if (connection.url.protocol.lowercase(Locale.US) != "https" || !trustedHost(connection.url.host)) throw IOException("untrusted model redirect")
                    if (response !in 200..299) throw IOException("model download failed")
                    connection.inputStream.use { input -> partialFile.outputStream().use { output ->
                        val buffer = ByteArray(1024 * 1024)
                        while (true) {
                            if (cancelled.get()) throw InterruptedException()
                            val n = input.read(buffer); if (n < 0) break
                            downloaded += n; if (downloaded > SIZE) throw IOException("unexpected model size")
                            output.write(buffer, 0, n); downloadedBytes = downloaded
                            notifyProgress(downloaded, false, null)
                        }
                    }}
                } finally { activeConnection = null; connection.disconnect() }
                if (cancelled.get()) throw InterruptedException()
                if (downloaded != SIZE) throw IOException("model size validation failed")
                if (sha256(partialFile) != SHA256) throw IOException("model checksum validation failed")
                if (!partialFile.renameTo(modelFile)) throw IOException("atomic model install failed")
                downloadedBytes = SIZE; notifyProgress(SIZE, true, null); call.resolve(status())
            } catch (_: InterruptedException) {
                partialFile.delete(); downloadedBytes = 0L; notifyProgress(0, true, "تم إلغاء تنزيل النموذج"); call.reject("تم إلغاء تنزيل النموذج")
            } catch (_: Exception) {
                partialFile.delete(); downloadedBytes = 0L; notifyProgress(0, true, "فشل تنزيل النموذج"); call.reject("تعذر تنزيل نموذج الذكاء الاصطناعي المحلي")
            } finally {
                activeConnection = null; downloading.set(false); downloadFuture = null
            }
        }
    }

    @PluginMethod
    fun cancelDownload(call: PluginCall) {
        if (downloading.get()) { cancelled.set(true); activeConnection?.disconnect() }
        call.resolve(status("تم طلب إلغاء التنزيل"))
    }

    @PluginMethod
    fun deleteModel(call: PluginCall) { serial.submit { modelFile.delete(); partialFile.delete(); call.resolve(status()) } }

    @PluginMethod
    fun generate(call: PluginCall) {
        val prompt = call.getString("prompt")
        if (prompt.isNullOrEmpty() || prompt.length > MAX_PROMPT) { call.reject("النص مطلوب وبحد أقصى 12000 حرف"); return }
        if (!modelFile.isFile || modelFile.length() != SIZE) { call.reject("نموذج الذكاء الاصطناعي المحلي غير محمل"); return }
        serial.submit {
            try {
                val instruction = "أنت مساعد صيانة محلي. لخّص السجلات المعطاة بالعربية فقط، مع الحفاظ على الملصقات كما هي. لا تخترع قيماً أو فترات أو تشخيصاً، ولا تذكر معلومات تعريفية عن المرضى، ولا تمنح تصريحاً طبياً. إذا لم تجد المعلومة فقل: مش لاقيها. أجب بالنص المطلوب فقط."
                val engine = Engine(EngineConfig(modelPath = modelFile.path, backend = Backend.CPU(), cacheDir = context.cacheDir.path))
                try { engine.initialize(); engine.createConversation(ConversationConfig(systemInstruction = Contents.of(instruction))).use { conversation -> call.resolve(JSObject().put("text", conversation.sendMessage(prompt).toString())) } }
                finally { engine.close() }
            } catch (_: Throwable) { call.reject("تعذر تشغيل الذكاء الاصطناعي المحلي على هذا الجهاز؛ لا يوجد بديل مدفوع أو سحابي") }
        }
    }

    private fun notifyProgress(bytes: Long, done: Boolean, error: String?) { notifyListeners("downloadProgress", JSObject().apply { put("downloadedBytes", bytes); put("totalBytes", SIZE); put("progress", (bytes.toDouble() / SIZE).coerceIn(0.0, 1.0)); put("done", done); if (error != null) put("error", error) }) }
    private fun openModelConnection(): HttpURLConnection {
        var target = URL(MODEL_URL)
        repeat(8) {
            if (cancelled.get()) throw InterruptedException()
            if (target.protocol.lowercase(Locale.US) != "https" || !trustedHost(target.host)) throw IOException("untrusted model host")
            val connection = (target.openConnection() as HttpURLConnection).apply { connectTimeout=20000;readTimeout=60000;instanceFollowRedirects=false;requestMethod="GET" }
            activeConnection=connection
            val code=connection.responseCode
            if (code in listOf(301,302,303,307,308)) {
                val location=connection.getHeaderField("Location") ?: throw IOException("invalid redirect")
                val next=URL(target,location);connection.disconnect();target=next
            } else { if(code !in 200..299){connection.disconnect();throw IOException("model download failed")};return connection }
        }
        throw IOException("too many redirects")
    }

    private fun trustedHost(host: String): Boolean = host.lowercase(Locale.US).let { it == "huggingface.co" || it.endsWith(".huggingface.co") || it == "hf.co" || it.endsWith(".hf.co") || it.endsWith(".xethub.hf.co") || it.endsWith(".cas-server.xethub.hf.co") }
    private fun sha256(file: File): String { val md = MessageDigest.getInstance("SHA-256"); file.inputStream().use { input -> val b = ByteArray(1024 * 1024); while (true) { val n = input.read(b); if (n < 0) break; md.update(b, 0, n) } }; return md.digest().joinToString("") { "%02x".format(it) } }

    @PluginMethod
    fun apiStatus(call: PluginCall) { val p = context.getSharedPreferences("engx_api", 0); call.resolve(JSObject().apply { put("configured", p.getString("baseUrl", null)?.isNotEmpty() == true && p.getString("model", null)?.isNotEmpty() == true && p.getString("key", null)?.isNotEmpty() == true); put("baseUrl", p.getString("baseUrl", "") ?: ""); put("model", p.getString("model", "") ?: "") }) }

    @PluginMethod
    fun saveApiConfig(call: PluginCall) {
        val raw = call.getString("baseUrl")?.trim()?.trimEnd('/') ?: ""; val model = call.getString("model")?.trim() ?: ""; val key = call.getString("key")?.trim()
        val u = try { URI(raw) } catch (_: Exception) { null }
        val localhost = u?.host == "localhost" || u?.host == "127.0.0.1"
        if (u == null || u.host == null || u.userInfo != null || u.query != null || u.fragment != null || (u.scheme != "https" && !(u.scheme == "http" && localhost))) { call.reject("عنوان API يجب أن يكون HTTPS أو localhost"); return }
        if (model.isEmpty() || model.length > 256) { call.reject("اسم النموذج غير صالح"); return }
        val p = context.getSharedPreferences("engx_api", 0)
        if (key != null && key.isNotEmpty()) p.edit().putString("baseUrl", raw).putString("model", model).putString("key", encrypt(key)).apply()
        else if (p.getString("key", null)?.isNotEmpty() == true) p.edit().putString("baseUrl", raw).putString("model", model).apply()
        else { call.reject("مفتاح API مطلوب للإعداد الأول"); return }
        call.resolve()
    }
    @PluginMethod fun deleteApiConfig(call: PluginCall) { context.getSharedPreferences("engx_api", 0).edit().clear().apply(); call.resolve() }

    @PluginMethod
    fun testApiConnection(call: PluginCall) { serial.submit { try { val p = context.getSharedPreferences("engx_api", 0); val result = apiRequest(p, "Reply OK"); extractContent(result); call.resolve(JSObject().put("ok", true).put("model", result.optString("model", p.getString("model", "")))) } catch (_: Exception) { call.reject("تعذر الاتصال بمزود API") } } }

    @PluginMethod
    fun generateApi(call: PluginCall) {
        val prompt = call.getString("prompt")
        if (prompt.isNullOrEmpty() || prompt.length > MAX_PROMPT) { call.reject("النص مطلوب وبحد أقصى 12000 حرف"); return }
        serial.submit { try { val p = context.getSharedPreferences("engx_api", 0); val out = apiRequest(p, prompt); call.resolve(JSObject().put("text", extractContent(out))) } catch (_: Exception) { call.reject("تعذر الاتصال بمزود API") } }
    }

    private fun apiRequest(p: android.content.SharedPreferences, userText: String): JSONObject {
        val c = openConnection(p); c.requestMethod = "POST"; c.doOutput = true; c.setRequestProperty("Authorization", "Bearer ${decrypt(p.getString("key", "") ?: "")}"); c.setRequestProperty("Content-Type", "application/json")
        val body = JSONObject().put("model", p.getString("model", "") ?: "").put("messages", org.json.JSONArray().put(JSONObject().put("role", "system").put("content", "لخّص السجلات بالعربية فقط دون اختراع قيم أو تصريح طبي.")).put(JSONObject().put("role", "user").put("content", userText))).put("stream", false).put("max_tokens", 512)
        c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        if (c.responseCode !in 200..299) throw IOException("API request failed")
        return JSONObject(c.inputStream.bufferedReader().use { it.readText() })
    }
    private fun extractContent(out: JSONObject): String { val content = out.getJSONArray("choices").getJSONObject(0).getJSONObject("message").getString("content"); if (content.isEmpty()) throw IOException("invalid API response"); return content }
    private fun openConnection(p: android.content.SharedPreferences): HttpURLConnection { val base = p.getString("baseUrl", "")?.trimEnd('/') ?: throw IOException("API is not configured"); val endpoint = if (base.endsWith("/chat/completions")) base else "$base/chat/completions"; return (URL(endpoint).openConnection() as HttpURLConnection).apply { connectTimeout = 60_000; readTimeout = 60_000; instanceFollowRedirects = false } }
    private fun key(): SecretKey { val ks = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }; if (!ks.containsAlias("engx_api")) { val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore"); g.init(KeyGenParameterSpec.Builder("engx_api", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build()); g.generateKey() }; return (ks.getEntry("engx_api", null) as java.security.KeyStore.SecretKeyEntry).secretKey }
    private fun encrypt(v: String): String { val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key()); return Base64.encodeToString(c.iv + c.doFinal(v.toByteArray()), Base64.NO_WRAP) }
    private fun decrypt(v: String): String { val b = Base64.decode(v, Base64.NO_WRAP); val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, b.copyOfRange(0, 12))); return String(c.doFinal(b.copyOfRange(12, b.size))) }

    override fun handleOnDestroy() { cancelled.set(true); activeConnection?.disconnect(); serial.shutdownNow(); super.handleOnDestroy() }
}
