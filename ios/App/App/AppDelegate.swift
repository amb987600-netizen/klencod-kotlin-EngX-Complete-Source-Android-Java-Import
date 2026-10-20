import UIKit
import CryptoKit
import Security
import Capacitor
import WidgetKit
import LiteRTLM
#if canImport(GoogleSignIn)
import GoogleSignIn
#endif

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
#if canImport(GoogleSignIn)
        if GIDSignIn.sharedInstance.handle(url) { return true }
#endif
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

// EngX uses the same WebView content for native iOS print/PDF export.
class EngXViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(EngXPrinterPlugin())
        bridge?.registerPluginInstance(EngXWidgetsPlugin())
        bridge?.registerPluginInstance(EngXLocalAIPlugin())
        bridge?.registerPluginInstance(EngXSessionPlugin())
    }
}

@objc(EngXWidgetsPlugin)
public class EngXWidgetsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EngXWidgetsPlugin"
    public let jsName = "EngXWidgets"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise)
    ]

    private let appGroup = "group.com.engx.app"
    private let snapshotKey = "engx-widget-snapshot"

    @objc func update(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        let openOrders = max(0, call.getInt("openOrders") ?? 0)
        let pmDue = max(0, call.getInt("pmDue") ?? 0)
        let updatedAt = call.getString("updatedAt") ?? ""
        let upcoming = (call.getArray("upcoming") as? [[String: Any]] ?? []).prefix(3).compactMap { item -> [String: String]? in
            guard let title = item["title"] as? String, let date = item["date"] as? String else { return nil }
            return ["title": String(title.prefix(200)), "date": String(date.prefix(100))]
        }
        let snapshot: [String: Any] = [
            "enabled": enabled,
            "openOrders": openOrders,
            "pmDue": pmDue,
            "upcoming": Array(upcoming),
            "updatedAt": String(updatedAt.prefix(100))
        ]

        do {
            let data = try JSONSerialization.data(withJSONObject: snapshot, options: [])
            guard let json = String(data: data, encoding: .utf8) else {
                call.reject("تعذر ترميز بيانات الودجت")
                return
            }
            UserDefaults(suiteName: appGroup)?.set(json, forKey: snapshotKey)
            WidgetCenter.shared.reloadTimelines(ofKind: "EngXWidget")
            call.resolve()
        } catch {
            call.reject("تعذر حفظ بيانات الودجت", "WIDGET_SNAPSHOT_ERROR", error)
        }
    }
}

@objc(EngXPrinterPlugin)
public class EngXPrinterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EngXPrinterPlugin"
    public let jsName = "EngXPrinter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise)
    ]

    @objc func print(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let view = self.bridge?.webView else {
                call.reject("تعذر الوصول إلى التقرير")
                return
            }
            let controller = UIPrintInteractionController.shared
            let info = UIPrintInfo(dictionary: nil)
            info.jobName = "EngX Maintenance Report"
            info.outputType = .general
            controller.printInfo = info
            controller.printFormatter = view.viewPrintFormatter()
            let completion: (UIPrintInteractionController, Bool, Error?) -> Void = { _, completed, error in
                if let error = error { call.reject(error.localizedDescription) }
                else { call.resolve(["completed": completed]) }
            }
            if UIDevice.current.userInterfaceIdiom == .pad {
                controller.present(from: CGRect(x: 0, y: 0, width: 1, height: 1), in: view, animated: true, completionHandler: completion)
            } else {
                controller.present(animated: true, completionHandler: completion)
            }
        }
    }
}

// MARK: - Private, on-device LiteRT-LM integration

@objc(EngXLocalAIPlugin)
public final class EngXLocalAIPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EngXLocalAIPlugin"
    public let jsName = "EngXLocalAI"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteModel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "apiStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveApiConfig", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteApiConfig", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "testApiConnection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generateApi", returnType: CAPPluginReturnPromise)
    ]

    private let modelName = "Gemma 4 E2B"
    private let modelBytes: Int64 = 2_588_147_712
    private let modelSHA256 = "181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c"
    private let modelURL = URL(string: "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/41c5569623a7c189d6eec3e5225260c58cedbce7/gemma-4-E2B-it.litertlm")!
    private let fileManager = FileManager.default
    private var downloadTask: URLSessionDownloadTask?
    private var downloadSession: URLSession?
    private var downloadDelegate: EngXLocalAIDownloadDelegate?
    private var engine: Engine?
    private var conversation: Conversation?
    private var isDownloading = false
    private var progress: Double = 0
    private var lastError: String?

    private var modelDirectory: URL {
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("EngXLocalAI", isDirectory: true)
    }
    private var modelPath: URL { modelDirectory.appendingPathComponent("gemma-4-E2B-it.litertlm") }
    private var partialPath: URL { modelDirectory.appendingPathComponent("gemma-4-E2B-it.litertlm.part") }

    public override func load() {
        super.load()
        try? fileManager.createDirectory(at: modelDirectory, withIntermediateDirectories: true)
        var excluded = URLResourceValues()
        excluded.isExcludedFromBackup = true
        try? modelPath.setResourceValues(excluded)
        try? partialPath.setResourceValues(excluded)
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(statusDictionary())
    }

    @objc func download(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard !self.isDownloading else { call.resolve(self.statusDictionary()); return }
            guard self.availableCapacityIsSafe() else {
                self.lastError = "لا توجد مساحة تخزين كافية؛ يلزم حجم النموذج مع 512 ميغابايت إضافية"
                call.reject(self.lastError!, "STORAGE_INSUFFICIENT")
                return
            }
            if self.isValidModel(at: self.modelPath) {
                call.resolve(self.statusDictionary())
                return
            }
            try? self.fileManager.removeItem(at: self.partialPath)
            self.lastError = nil
            self.progress = 0
            self.isDownloading = true
            let delegate = EngXLocalAIDownloadDelegate(owner: self)
            self.downloadDelegate = delegate
            let configuration = URLSessionConfiguration.default
            configuration.allowsCellularAccess = true
            let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
            self.downloadSession = session
            self.downloadTask = session.downloadTask(with: self.modelURL)
            self.downloadTask?.resume()
            call.resolve(self.statusDictionary())
        }
    }

    @objc func cancelDownload(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.downloadTask?.cancel()
            self.downloadTask = nil
            self.downloadSession?.invalidateAndCancel()
            self.downloadSession = nil
            self.downloadDelegate = nil
            self.isDownloading = false
            self.progress = 0
            try? self.fileManager.removeItem(at: self.partialPath)
            call.resolve(self.statusDictionary())
        }
    }

    @objc func deleteModel(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.downloadTask?.cancel()
            self.downloadSession?.invalidateAndCancel()
            self.downloadTask = nil
            self.downloadSession = nil
            self.downloadDelegate = nil
            self.isDownloading = false
            self.progress = 0
            self.engine = nil
            self.conversation = nil
            do {
                try self.fileManager.removeItem(at: self.modelPath)
                try? self.fileManager.removeItem(at: self.partialPath)
                self.lastError = nil
                call.resolve(self.statusDictionary())
            } catch {
                self.lastError = "تعذر حذف النموذج المحلي"
                call.reject(self.lastError!, "DELETE_FAILED", error)
            }
        }
    }

    @objc func generate(_ call: CAPPluginCall) {
        guard let prompt = call.getString("prompt"), !prompt.isEmpty else {
            call.reject("يلزم إدخال نص الطلب", "INVALID_PROMPT")
            return
        }
        guard prompt.count <= 12_000 else {
            call.reject("الطلب طويل جداً؛ الحد الأقصى 12000 حرفاً", "PROMPT_TOO_LONG")
            return
        }
        guard isValidModel(at: modelPath) else {
            call.reject("النموذج المحلي غير محمّل؛ استخدم التنزيل بموافقة المستخدم أولاً", "MODEL_NOT_DOWNLOADED")
            return
        }
        let path = modelPath.path
        Task {
            do {
                let config = try EngineConfig(modelPath: path, backend: .cpu(), maxNumTokens: 2048, cacheDir: NSTemporaryDirectory())
                let newEngine = Engine(engineConfig: config)
                try await newEngine.initialize()
                let instruction = "أنت مساعد محلي لتلخيص سجل صيانة مقدم فقط. لخّص المعلومات الموجودة دون اختراع قيم طبية أو فواصل زمنية. لا تقدّم تشخيصاً أو علاجاً، ولا تذكر بيانات مريض شخصية، وصرّح بوضوح عند غياب معلومة."
                let newConversation = try await newEngine.createConversation(with: ConversationConfig(systemMessage: Message(instruction)))
                let response = try await newConversation.sendMessage(Message(prompt))
                let text = response.toString
                await MainActor.run {
                    self.engine = newEngine
                    self.conversation = newConversation
                    call.resolve(["text": text])
                    self.conversation = nil
                    self.engine = nil
                }
            } catch {
                await MainActor.run { call.reject("فشل الاستدلال المحلي على الجهاز", "INFERENCE_FAILED", error) }
            }
        }
    }

    fileprivate func reportProgress(downloaded: Int64, total: Int64) {
        DispatchQueue.main.async {
            guard self.isDownloading else { return }
            let effectiveTotal = total > 0 ? total : self.modelBytes
            self.progress = min(1, Double(downloaded) / Double(effectiveTotal))
            self.notifyListeners("downloadProgress", data: [
                "downloadedBytes": downloaded, "totalBytes": effectiveTotal,
                "progress": self.progress, "done": false
            ])
        }
    }

    fileprivate func finishDownload(from location: URL, expectedBytes: Int64) {
        DispatchQueue.global(qos: .utility).async {
            do {
                try self.fileManager.createDirectory(at: self.modelDirectory, withIntermediateDirectories: true)
                if self.fileManager.fileExists(atPath: self.partialPath.path) { try self.fileManager.removeItem(at: self.partialPath) }
                try self.fileManager.moveItem(at: location, to: self.partialPath)
                guard self.isValidModel(at: self.partialPath), expectedBytes == self.modelBytes else {
                    throw NSError(domain: "EngXLocalAI", code: 1, userInfo: [NSLocalizedDescriptionKey: "حجم أو بصمة النموذج غير صحيحة"])
                }
                if self.fileManager.fileExists(atPath: self.modelPath.path) { try self.fileManager.removeItem(at: self.modelPath) }
                try self.fileManager.moveItem(at: self.partialPath, to: self.modelPath)
                var values = URLResourceValues(); values.isExcludedFromBackup = true
                try? self.modelPath.setResourceValues(values)
                DispatchQueue.main.async {
                    self.isDownloading = false; self.progress = 1; self.downloadTask = nil
                    self.downloadSession?.invalidateAndCancel(); self.downloadSession = nil; self.downloadDelegate = nil
                    self.lastError = nil
                    self.notifyListeners("downloadProgress", data: ["downloadedBytes": self.modelBytes, "totalBytes": self.modelBytes, "progress": 1, "done": true])
                }
            } catch {
                try? self.fileManager.removeItem(at: self.partialPath)
                DispatchQueue.main.async {
                    self.isDownloading = false; self.lastError = "فشل تنزيل النموذج أو التحقق من سلامته"; self.downloadTask = nil
                    self.downloadSession?.invalidateAndCancel(); self.downloadSession = nil; self.downloadDelegate = nil
                    self.notifyListeners("downloadProgress", data: ["downloadedBytes": 0, "totalBytes": self.modelBytes, "progress": 0, "done": true, "error": self.lastError!])
                }
            }
        }
    }

    fileprivate func downloadFailed(_ error: Error) {
        DispatchQueue.main.async {
            guard self.isDownloading else { return }
            self.isDownloading = false; self.lastError = "فشل تنزيل النموذج المحلي"; self.downloadTask = nil
            try? self.fileManager.removeItem(at: self.partialPath)
            self.downloadSession?.invalidateAndCancel(); self.downloadSession = nil; self.downloadDelegate = nil
            self.notifyListeners("downloadProgress", data: ["downloadedBytes": 0, "totalBytes": self.modelBytes, "progress": 0, "done": true, "error": self.lastError!])
        }
    }

    @objc func apiStatus(_ call: CAPPluginCall) {
        let defaults = UserDefaults.standard
        call.resolve(["configured": apiBaseURL() != nil && apiModel() != nil && readAPIKey() != nil, "baseUrl": defaults.string(forKey: "EngXLocalAI.apiBaseURL") ?? "", "model": apiModel() ?? ""])
    }

    @objc func saveApiConfig(_ call: CAPPluginCall) {
        guard let raw = call.getString("baseUrl"), let url = normalizedAPIURL(raw) else { call.reject("عنوان HTTPS غير صالح", "INVALID_API_URL"); return }
        let model = (call.getString("model") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !model.isEmpty else { call.reject("يلزم اسم النموذج", "INVALID_API_MODEL"); return }
        let key = call.getString("key")?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let key, !key.isEmpty, !saveAPIKey(key) { call.reject("تعذر حفظ مفتاح API بأمان", "KEYCHAIN_ERROR"); return }
        guard readAPIKey() != nil else { call.reject("مفتاح API مطلوب للإعداد الأول", "API_KEY_REQUIRED"); return }
        UserDefaults.standard.set(url.absoluteString, forKey: "EngXLocalAI.apiBaseURL")
        UserDefaults.standard.set(model, forKey: "EngXLocalAI.apiModel")
        call.resolve(["configured": true, "baseUrl": url.absoluteString, "model": model])
    }

    @objc func deleteApiConfig(_ call: CAPPluginCall) {
        UserDefaults.standard.removeObject(forKey: "EngXLocalAI.apiBaseURL")
        UserDefaults.standard.removeObject(forKey: "EngXLocalAI.apiModel")
        deleteAPIKey()
        call.resolve(["configured": false, "baseUrl": "", "model": ""])
    }

    @objc func testApiConnection(_ call: CAPPluginCall) {
        guard let base = apiBaseURL(), let model = apiModel(), let url = apiEndpoint(base), let key = readAPIKey() else { call.reject("إعداد موفر API غير مكتمل", "API_NOT_CONFIGURED"); return }
        var request = URLRequest(url: url); request.httpMethod = "POST"; request.timeoutInterval = 60
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization"); request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["model": model, "messages": [["role": "user", "content": "Reply OK"]], "stream": false, "max_tokens": 8])
        apiSession.dataTask(with: request) { data, response, error in
            DispatchQueue.main.async {
                guard error == nil, let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), let data, let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let choices = object["choices"] as? [[String: Any]], !choices.isEmpty else { call.reject("تعذر اختبار اتصال موفر API", "API_CONNECTION_FAILED"); return }
                call.resolve(["ok": true, "model": model])
            }
        }.resume()
    }

    @objc func generateApi(_ call: CAPPluginCall) {
        guard let prompt = call.getString("prompt"), !prompt.isEmpty, prompt.count <= 12_000 else { call.reject("طلب API غير صالح أو طويل جداً", "INVALID_PROMPT"); return }
        guard let base = apiBaseURL(), let model = apiModel(), let url = apiEndpoint(base), let key = readAPIKey() else { call.reject("إعداد موفر API غير مكتمل", "API_NOT_CONFIGURED"); return }
        let instruction = "أنت مساعد لتلخيص سجل صيانة مقدم فقط. لخّص المعلومات الموجودة دون اختراع قيم طبية أو فواصل زمنية. لا تقدّم تشخيصاً أو علاجاً، ولا تذكر بيانات مريض شخصية، وصرّح عند غياب معلومة."
        var request = URLRequest(url: url); request.httpMethod = "POST"; request.timeoutInterval = 60
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization"); request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["model": model, "messages": [["role": "system", "content": instruction], ["role": "user", "content": prompt]], "stream": false, "max_tokens": 512])
        apiSession.dataTask(with: request) { data, response, error in
            DispatchQueue.main.async {
                guard error == nil, let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), let data, let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let choices = object["choices"] as? [[String: Any]], let message = choices.first?["message"] as? [String: Any], let text = message["content"] as? String else { call.reject("فشل طلب موفر API", "API_REQUEST_FAILED"); return }
                call.resolve(["text": text])
            }
        }.resume()
    }

    private let apiSession = URLSession(configuration: .ephemeral, delegate: EngXAPIRedirectBlocker(), delegateQueue: nil)
    private func apiEndpoint(_ base: URL) -> URL? { return base.path.hasSuffix("/chat/completions") ? base : URL(string: base.absoluteString + "/chat/completions") }
    private func apiModel() -> String? { UserDefaults.standard.string(forKey: "EngXLocalAI.apiModel") }
    private func apiBaseURL() -> URL? { guard let raw = UserDefaults.standard.string(forKey: "EngXLocalAI.apiBaseURL") else { return nil }; return normalizedAPIURL(raw) }
    private func normalizedAPIURL(_ raw: String) -> URL? {
        guard var components = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)), components.scheme?.lowercased() == "https", components.user == nil, components.password == nil, components.query == nil, components.fragment == nil, let host = components.host, !host.isEmpty else { return nil }
        while components.path.hasSuffix("/") { components.path.removeLast() }
        return components.url
    }
    private let apiService = "com.engx.app.localai.api-key"
    private func saveAPIKey(_ key: String) -> Bool { let data = Data(key.utf8); deleteAPIKey(); let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: apiService, kSecAttrAccount as String: "default", kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]; return SecItemAdd(query as CFDictionary, nil) == errSecSuccess }
    private func readAPIKey() -> String? { var result: CFTypeRef?; let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: apiService, kSecAttrAccount as String: "default", kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]; guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }; return String(data: data, encoding: .utf8) }
    private func deleteAPIKey() { let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: apiService, kSecAttrAccount as String: "default"]; SecItemDelete(query as CFDictionary) }

    private func statusDictionary() -> [String: Any] {
        var value: [String: Any] = ["supported": true, "downloaded": isValidModel(at: modelPath), "downloading": isDownloading, "progress": progress, "model": modelName, "sizeBytes": modelBytes]
        if let lastError { value["error"] = lastError }
        return value
    }

    private func availableCapacityIsSafe() -> Bool {
        guard let values = try? modelDirectory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]), let available = values.volumeAvailableCapacityForImportantUsage else { return false }
        return available > modelBytes + 512 * 1024 * 1024
    }

    private func isValidModel(at url: URL) -> Bool {
        guard let attrs = try? fileManager.attributesOfItem(atPath: url.path), let size = attrs[.size] as? NSNumber, size.int64Value == modelBytes else { return false }
        guard let handle = try? FileHandle(forReadingFrom: url) else { return false }
        var hash = SHA256(); defer { try? handle.close() }
        do {
            while autoreleasepool(invoking: { () -> Bool in
                let chunk = try? handle.read(upToCount: 1024 * 1024)
                if let chunk, !chunk.isEmpty { hash.update(data: chunk); return true }
                return false
            }) {}
        }
        return hash.finalize().map { String(format: "%02x", $0) }.joined() == modelSHA256
    }
}

private final class EngXLocalAIDownloadDelegate: NSObject, URLSessionDownloadDelegate {
    weak var owner: EngXLocalAIPlugin?
    init(owner: EngXLocalAIPlugin) { self.owner = owner }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        owner?.reportProgress(downloaded: totalBytesWritten, total: totalBytesExpectedToWrite)
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        owner?.finishDownload(from: location, expectedBytes: downloadTask.response?.expectedContentLength ?? 0)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error { owner?.downloadFailed(error) }
    }
}

private final class EngXAPIRedirectBlocker: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}


@objc(EngXSessionPlugin)
public final class EngXSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EngXSessionPlugin"
    public let jsName = "EngXSession"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise), CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise), CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise), CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise)]
    private let service = "com.engx.app.session"
    private func read() throws -> [String: Any] {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "accounts", kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?; let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return [:] }; guard status == errSecSuccess, let data = result as? Data else { throw NSError(domain: "EngXSession", code: Int(status)) }
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }
    private func write(_ value: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: value)
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "accounts"]
        let attrs: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(q as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound { var add = q; attrs.forEach { add[$0.key] = $0.value }; guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else { throw NSError(domain: "EngXSession", code: 1) } } else if status != errSecSuccess { throw NSError(domain: "EngXSession", code: Int(status)) }
    }
    private func fail(_ call: CAPPluginCall) { call.reject("تعذر الوصول إلى التخزين الآمن", "SECURE_STORE_ERROR") }
    @objc func save(_ call: CAPPluginCall) { do { var all = try read(); all[call.getString("id") ?? ""] = ["token": call.getString("token") ?? "", "account": call.getObject("account") ?? [:]]; try write(all); call.resolve() } catch { fail(call) } }
    @objc func get(_ call: CAPPluginCall) { do { call.resolve((try read())[call.getString("id") ?? ""] as? [String: Any] ?? [:]) } catch { fail(call) } }
    @objc func remove(_ call: CAPPluginCall) { do { var all = try read(); let id = call.getString("id") ?? ""; if call.getBool("keepIdentifier") == true, var item = all[id] as? [String: Any] { item.removeValue(forKey: "token"); all[id] = item } else { all.removeValue(forKey: id) }; try write(all); call.resolve() } catch { fail(call) } }
    @objc func list(_ call: CAPPluginCall) { do { let all = try read(); call.resolve(["accounts": all.values.compactMap { ($0 as? [String: Any])?["account"] as? [String: Any] }]) } catch { fail(call) } }
}
