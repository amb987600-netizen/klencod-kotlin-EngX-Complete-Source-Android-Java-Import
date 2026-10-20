import SwiftUI
import WidgetKit

private let engXAppGroup = "group.com.engx.app"
private let engXSnapshotKey = "engx-widget-snapshot"

struct EngXWidgetSnapshot: Codable {
    var enabled: Bool = false
    var openOrders: Int = 0
    var pmDue: Int = 0
    var upcoming: [EngXUpcomingPM] = []
    var updatedAt: String = ""
}

struct EngXUpcomingPM: Codable, Identifiable {
    var id: String { "\(title)-\(date)" }
    var title: String
    var date: String
}

struct EngXWidgetEntry: TimelineEntry {
    let date: Date
    let snapshot: EngXWidgetSnapshot
}

struct EngXWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> EngXWidgetEntry {
        EngXWidgetEntry(date: Date(), snapshot: EngXWidgetSnapshot(enabled: true, openOrders: 12, pmDue: 3, upcoming: [EngXUpcomingPM(title: "فحص جهاز التخدير", date: "2025-01-20")], updatedAt: ""))
    }

    func getSnapshot(in context: Context, completion: @escaping (EngXWidgetEntry) -> Void) {
        completion(EngXWidgetEntry(date: Date(), snapshot: loadSnapshot()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<EngXWidgetEntry>) -> Void) {
        let now = Date()
        let entry = EngXWidgetEntry(date: now, snapshot: loadSnapshot())
        completion(Timeline(entries: [entry], policy: .after(now.addingTimeInterval(30 * 60))))
    }

    private func loadSnapshot() -> EngXWidgetSnapshot {
        guard let data = UserDefaults(suiteName: engXAppGroup)?.string(forKey: engXSnapshotKey)?.data(using: .utf8),
              let decoded = try? JSONDecoder().decode(EngXWidgetSnapshot.self, from: data) else {
            return EngXWidgetSnapshot()
        }
        return decoded
    }
}

struct EngXWidget: Widget {
    let kind = "EngXWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: EngXWidgetProvider()) { entry in
            EngXWidgetView(entry: entry)
                .widgetURL(URL(string: "engx://home"))
        }
        .configurationDisplayName("EngX Maintenance")
        .description("متابعة أوامر الصيانة وموعد الصيانة الوقائية")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct EngXWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: EngXWidgetEntry
    private let teal = Color(red: 0.0, green: 0.48, blue: 0.48)

    var body: some View {
        Group {
            if !entry.snapshot.enabled {
                disabledView
            } else if family == .systemSmall {
                smallView
            } else {
                mediumView
            }
        }
        .environment(\.layoutDirection, .rightToLeft)
        .background(LinearGradient(colors: [teal, Color(red: 0.0, green: 0.28, blue: 0.32)], startPoint: .topLeading, endPoint: .bottomTrailing))
    }

    private var disabledView: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: "wrench.and.screwdriver.fill").font(.title2)
            Text("افتح EngX لتفعيل الودجت").font(.headline).minimumScaleFactor(0.75)
        }
        .foregroundColor(.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .widgetURL(URL(string: "engx://home"))
    }

    private var smallView: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("EngX").font(.headline)
            HStack(spacing: 6) {
                Text("\(entry.snapshot.openOrders)").font(.system(size: 28, weight: .bold, design: .rounded))
                Text("أوامر مفتوحة").font(.caption)
            }
            HStack(spacing: 6) {
                Text("\(entry.snapshot.pmDue)").font(.title3.bold())
                Text("PM مستحقة").font(.caption)
            }
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                Link("أمر جديد", destination: URL(string: "engx://new-order")!)
                Link("قراءة QR", destination: URL(string: "engx://scan")!)
            }.font(.caption2.bold())
        }
        .foregroundColor(.white)
        .padding(12)
    }

    private var mediumView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("EngX Maintenance").font(.headline)
                Spacer()
                Text("\(entry.snapshot.openOrders) أوامر  •  \(entry.snapshot.pmDue) PM").font(.caption.bold())
            }
            if entry.snapshot.upcoming.isEmpty {
                Text("لا توجد صيانة وقائية قادمة").font(.subheadline)
            } else {
                ForEach(Array(entry.snapshot.upcoming.prefix(3))) { item in
                    HStack(spacing: 8) {
                        Image(systemName: "calendar").font(.caption)
                        Text(item.title).font(.caption).lineLimit(1)
                        Spacer()
                        Text(item.date).font(.caption2)
                    }
                }
            }
            Spacer(minLength: 0)
            HStack(spacing: 12) {
                Link("أمر جديد", destination: URL(string: "engx://new-order")!)
                Link("قراءة QR", destination: URL(string: "engx://scan")!)
                Spacer()
                Text(freshness).font(.caption2)
            }.font(.caption2.bold())
        }
        .foregroundColor(.white)
        .padding(12)
    }

    private var freshness: String {
        guard let date = ISO8601DateFormatter().date(from: entry.snapshot.updatedAt) else { return "" }
        let minutes = max(0, Int(Date().timeIntervalSince(date) / 60))
        return minutes < 1 ? "محدث الآن" : "محدث قبل \(minutes) د"
    }
}

@main
struct EngXWidgetBundle: WidgetBundle {
    var body: some Widget {
        EngXWidget()
    }
}
