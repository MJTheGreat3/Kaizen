// What the widgets show, as Kaizen writes it (src-tauri/src/mac_widgets.rs),
// and the taps they send back.

import AppIntents
import Foundation
import SwiftUI
import WidgetKit

enum Store {
  /// The real home folder (the sandbox's own is a container).
  static let home: String = {
    if let dir = getpwuid(getuid())?.pointee.pw_dir { return String(cString: dir) }
    return NSHomeDirectory()
  }()

  static let dir = URL(fileURLWithPath: home + "/Library/Application Support/com.matt.kaizen/widgets", isDirectory: true)

  static func read<T: Decodable>(_ name: String, as type: T.Type) -> T? {
    guard let data = try? Data(contentsOf: dir.appendingPathComponent(name)) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }

  static var today: TodayData? { read("today.json", as: TodayData.self) }
  static var feed: FeedData? { read("feed.json", as: FeedData.self) }
  static var music: MusicData? { read("music.json", as: MusicData.self) }

  /// Leaves an action for Kaizen (`task:<id>`, `habit:<id>`, `music:next`, ...).
  static func act(_ action: String) {
    let folder = dir.appendingPathComponent("actions", isDirectory: true)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let name = String(format: "%013.0f", Date().timeIntervalSince1970 * 1000) + "-" + UUID().uuidString.prefix(8) + ".txt"
    try? action.write(to: folder.appendingPathComponent(name), atomically: true, encoding: .utf8)
  }

  /// Actions Kaizen hasn't applied yet, so the widget can show them already.
  static func pending() -> Set<String> {
    let folder = dir.appendingPathComponent("actions", isDirectory: true)
    let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
    return Set(files.filter { $0.pathExtension == "txt" }.compactMap { try? String(contentsOf: $0, encoding: .utf8) })
  }

  /// Which page each Today list shows (they page instead of scrolling).
  static var pages: [String: Int] {
    get { read("pages.json", as: [String: Int].self) ?? [:] }
    set {
      if let data = try? JSONEncoder().encode(newValue) {
        try? data.write(to: dir.appendingPathComponent("pages.json"), options: .atomic)
      }
    }
  }
}

// MARK: - Data

struct TodayData: Decodable {
  var date: String?
  var label: String?
  var tasks: [WidgetTask]?
  var moreTasks: Int?
  var someday: [WidgetTask]?
  var habits: [WidgetHabit]?
  var money: MoneyData?
}

struct WidgetTask: Decodable, Identifiable {
  var id: String
  var title: String
  var when: String?
  var overdue: Bool?
}

struct WidgetHabit: Decodable, Identifiable {
  var id: String
  var name: String
  var color: String?
  var done: Bool?
  var progress: String?
}

struct MoneyData: Decodable {
  var hasAccounts: Bool?
  var spentToday: Int64?
  var spentMonth: Int64?
  var balance: Int64?
}

struct FeedData: Decodable {
  var streaks: [StreakData]?
  var upNext: [UpNextData]?
  var debts: DebtData?
  var goals: [GoalData]?
}

struct StreakData: Decodable, Identifiable {
  var id: String
  var name: String
  var color: String?
  var current: Int
  var best: Int
  var unit: String?
  var doneNow: Bool?
}

struct UpNextData: Decodable {
  var title: String
  var at: Double
  var live: Bool?
  var allDay: Bool?
  var color: String?
}

struct DebtData: Decodable {
  var owedToMe: String
  var iOwe: String
  var net: Int64
  var netText: String
  var people: [DebtPerson]?
}

struct DebtPerson: Decodable {
  var name: String
  var amount: String
  var toMe: Bool
}

struct GoalData: Decodable, Identifiable {
  var id: String
  var title: String
  var color: String?
  var percent: Int
  var note: String?
}

struct MusicData: Decodable {
  var connected: Bool?
  var title: String?
  var artist: String?
  var art: String?
  var uri: String?
  var playing: Bool?
  var progressMs: Double?
  var durationMs: Double?
  var at: Double?
}

// MARK: - Look

enum Hue {
  static let ink = Color(hex: "#13161E")
  static let today = Color(hex: "#F0A03C")
  static let upNext = Color(hex: "#3FA66B")
  static let debts = Color(hex: "#C2843D")
  static let finance = Color(hex: "#8E9C2C")
  static let spend = Color(hex: "#C9603A")
  static let good = Color(hex: "#2F8F57")
  static let danger = Color(hex: "#D14343")
  static let accent = Color(hex: "#5B6EE1")
}

extension Color {
  init(hex: String?, fallback: Color = Hue.accent) {
    var s = (hex ?? "").trimmingCharacters(in: .whitespaces)
    if s.hasPrefix("#") { s.removeFirst() }
    if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
    guard s.count == 6 || s.count == 8, let v = UInt64(s, radix: 16) else {
      self = fallback
      return
    }
    let rgb = s.count == 8 ? v & 0xFFFFFF : v
    self = Color(
      red: Double((rgb >> 16) & 0xFF) / 255,
      green: Double((rgb >> 8) & 0xFF) / 255,
      blue: Double(rgb & 0xFF) / 255
    )
  }

  init(hex: String) { self.init(hex: hex, fallback: .gray) }
}

/// The background every Kaizen widget has: its colour washing in from a corner.
struct Wash: View {
  var hue: Color
  var body: some View {
    ZStack {
      Color(nsColor: .windowBackgroundColor)
      LinearGradient(colors: [hue.opacity(0.22), hue.opacity(0)], startPoint: .topLeading, endPoint: .center)
    }
  }
}

/// A rounded square with a symbol, as at the top of each widget.
struct Tile: View {
  var symbol: String
  var hue: Color
  var size: CGFloat = 26
  var body: some View {
    Image(systemName: symbol)
      .font(.system(size: size * 0.5, weight: .semibold))
      .foregroundStyle(.white)
      .frame(width: size, height: size)
      .background(RoundedRectangle(cornerRadius: size * 0.3, style: .continuous).fill(hue.gradient))
  }
}

/// A small round button that opens a link.
struct LinkButton: View {
  var url: String
  var symbol: String
  var body: some View {
    Link(destination: URL(string: url)!) {
      Image(systemName: symbol)
        .font(.system(size: 11, weight: .bold))
        .frame(width: 24, height: 24)
        .background(Circle().fill(.primary.opacity(0.08)))
    }
  }
}

func open(_ kind: String) -> URL { URL(string: "kaizen://open/\(kind)")! }

/// Paise as rupees: ₹1,23,456 (with paise only when there are any).
func rupees(_ paise: Int64) -> String {
  let f = NumberFormatter()
  f.numberStyle = .decimal
  f.locale = Locale(identifier: "en_IN")
  f.minimumFractionDigits = paise % 100 == 0 ? 0 : 2
  f.maximumFractionDigits = f.minimumFractionDigits
  let sign = paise < 0 ? "-" : ""
  return sign + "₹" + (f.string(from: NSNumber(value: Double(abs(paise)) / 100)) ?? "0")
}

func dayKey(_ date: Date = .now) -> String {
  let f = DateFormatter()
  f.dateFormat = "yyyy-MM-dd"
  return f.string(from: date)
}

/// A timeline that asks again in `minutes` (Kaizen also redraws on changes).
func every<E: TimelineEntry>(_ entry: E, minutes: Double = 30) -> Timeline<E> {
  Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(minutes * 60)))
}
