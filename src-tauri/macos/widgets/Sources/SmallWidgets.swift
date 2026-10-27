// Streaks, Up next, Debts and Money, as on the phone.

import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Streaks

struct StreakEntity: AppEntity {
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Streak"
  static var defaultQuery = StreakQuery()
  var id: String
  var name: String
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

struct StreakQuery: EntityQuery {
  func all() -> [StreakEntity] {
    (Store.feed?.streaks ?? []).map { StreakEntity(id: $0.id, name: $0.name) }
  }
  func entities(for identifiers: [String]) async throws -> [StreakEntity] {
    all().filter { identifiers.contains($0.id) }
  }
  func suggestedEntities() async throws -> [StreakEntity] { all() }
}

struct StreakConfig: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "Streaks"
  static var description = IntentDescription("Which streaks to show.")
  @Parameter(title: "Streaks") var streaks: [StreakEntity]?
}

struct StreakEntry: TimelineEntry {
  let date: Date
  let streaks: [StreakData]
}

struct StreakProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> StreakEntry {
    StreakEntry(date: .now, streaks: [StreakData(id: "all", name: "Any activity", color: "#5B6EE1", current: 12, best: 30, unit: "days", doneNow: true)])
  }

  func entry(_ config: StreakConfig, family: WidgetFamily) -> StreakEntry {
    let all = Store.feed?.streaks ?? []
    let chosen = (config.streaks ?? []).compactMap { pick in all.first { $0.id == pick.id } }
    // Unchosen: the longest current streaks.
    let shown = chosen.isEmpty ? Array(all.sorted { $0.current > $1.current }.prefix(4)) : chosen
    return StreakEntry(date: .now, streaks: Array(shown.prefix(family == .systemSmall ? 1 : 4)))
  }

  func snapshot(for configuration: StreakConfig, in context: Context) async -> StreakEntry {
    entry(configuration, family: context.family)
  }

  func timeline(for configuration: StreakConfig, in context: Context) async -> Timeline<StreakEntry> {
    every(entry(configuration, family: context.family), minutes: 60)
  }
}

/// The page in Kaizen a streak belongs to.
func streakPage(_ id: String) -> String {
  switch id {
  case _ where id.hasPrefix("habit:"), "type:habits": return "habits"
  case "type:gym": return "fitness"
  case "type:cp", "type:github": return "practice"
  case "type:sports": return "sports"
  case "type:tasks", "type:reading": return "lists"
  case "type:classes": return "calendar"
  default: return "activity"
  }
}

struct StreakCard: View {
  var s: StreakData
  var big: Bool

  var body: some View {
    let hue = Color(hex: s.color, fallback: Hue.accent)
    let unit = s.unit ?? "days"
    let now = unit == "weeks" ? "this week" : "today"
    VStack(alignment: .leading, spacing: big ? 4 : 2) {
      HStack(spacing: 4) {
        Image(systemName: "flame.fill").foregroundStyle(s.doneNow == true ? hue : .secondary)
        Text(s.name).font(.system(size: big ? 13 : 11, weight: .semibold)).lineLimit(1)
      }
      Spacer(minLength: 0)
      HStack(alignment: .firstTextBaseline, spacing: 3) {
        Text("\(s.current)").font(.system(size: big ? 44 : 28, weight: .bold, design: .rounded)).foregroundStyle(hue)
        Text(s.current == 1 ? String(unit.dropLast()) : unit).font(.system(size: big ? 13 : 10)).foregroundStyle(.secondary)
      }
      Text("\(s.doneNow == true ? "Done" : "Not yet") \(now) · best \(s.best)")
        .font(.system(size: big ? 11 : 9)).foregroundStyle(.secondary).lineLimit(1)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

struct StreakView: View {
  var entry: StreakEntry
  @Environment(\.widgetFamily) var family

  var body: some View {
    let first = entry.streaks.first
    Group {
      if entry.streaks.isEmpty {
        Text("Open Kaizen to see your streaks").font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
      } else if family == .systemSmall, let s = first {
        StreakCard(s: s, big: true).widgetURL(open("page:\(streakPage(s.id))"))
      } else {
        HStack(spacing: 8) {
          ForEach(entry.streaks) { s in
            Link(destination: open("page:\(streakPage(s.id))")) {
              StreakCard(s: s, big: false)
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(.primary.opacity(0.05)))
            }
          }
        }
      }
    }
    .containerBackground(for: .widget) { Wash(hue: Color(hex: first?.color, fallback: Hue.accent)) }
  }
}

struct StreakWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "streak", intent: StreakConfig.self, provider: StreakProvider()) { StreakView(entry: $0) }
      .configurationDisplayName("Streak")
      .description("A streak, or a few side by side. Edit the widget to choose them.")
      .supportedFamilies([.systemSmall, .systemMedium])
  }
}

// MARK: - Up next

struct UpNextEntry: TimelineEntry {
  let date: Date
  let items: [UpNextData]
}

struct UpNextProvider: TimelineProvider {
  func placeholder(in context: Context) -> UpNextEntry { UpNextEntry(date: .now, items: []) }

  func items(at now: Date) -> [UpNextData] {
    let ms = now.timeIntervalSince1970 * 1000
    return (Store.feed?.upNext ?? []).filter {
      $0.live == true || $0.at + ($0.allDay == true ? 86_400_000 : 3 * 3_600_000) > ms
    }
  }

  func getSnapshot(in context: Context, completion: @escaping (UpNextEntry) -> Void) {
    completion(UpNextEntry(date: .now, items: items(at: .now)))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<UpNextEntry>) -> Void) {
    // One entry every 15 minutes for two hours, so past items drop off.
    let entries = (0..<8).map { i -> UpNextEntry in
      let at = Date.now.addingTimeInterval(Double(i) * 900)
      return UpNextEntry(date: at, items: items(at: at))
    }
    completion(Timeline(entries: entries, policy: .atEnd))
  }
}

struct WhenText: View {
  var item: UpNextData
  var now: Date

  var body: some View {
    let at = Date(timeIntervalSince1970: item.at / 1000)
    let cal = Calendar.current
    if item.live == true {
      Text("Live").foregroundStyle(Hue.danger).fontWeight(.bold)
    } else if item.allDay == true {
      Text(cal.isDate(at, inSameDayAs: now) ? "Today" : at.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)))
    } else if at > now && at.timeIntervalSince(now) <= 12 * 3600 {
      Text("in ") + Text(at, style: .relative)
    } else if at <= now {
      Text("now")
    } else {
      Text(at.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute()))
    }
  }
}

struct UpNextView: View {
  var entry: UpNextEntry
  @Environment(\.widgetFamily) var family

  var body: some View {
    let limit = family == .systemLarge ? 9 : 3
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        Tile(symbol: "hourglass", hue: Hue.upNext)
        Text("Up next").font(.system(size: 14, weight: .bold))
        Spacer()
      }
      if entry.items.isEmpty {
        Spacer()
        Text("Nothing coming up").font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity)
        Spacer()
      } else {
        ForEach(Array(entry.items.prefix(limit).enumerated()), id: \.offset) { _, item in
          HStack(spacing: 8) {
            Circle().fill(Color(hex: item.color, fallback: Hue.upNext)).frame(width: 7, height: 7)
            Text(item.title).font(.system(size: 12, weight: .medium)).lineLimit(1)
            Spacer(minLength: 4)
            WhenText(item: item, now: entry.date).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
          }
          .padding(.horizontal, 8)
          .frame(height: 26)
          .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(.primary.opacity(0.05)))
        }
        Spacer(minLength: 0)
      }
    }
    .widgetURL(open("page:today"))
    .containerBackground(for: .widget) { Wash(hue: Hue.upNext) }
  }
}

struct UpNextWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "upnext", provider: UpNextProvider()) { UpNextView(entry: $0) }
      .configurationDisplayName("Up next")
      .description("Matches, contests and dates coming up.")
      .supportedFamilies([.systemMedium, .systemLarge])
  }
}

// MARK: - Debts

struct DebtEntry: TimelineEntry {
  let date: Date
  let debts: DebtData?
}

struct DebtProvider: TimelineProvider {
  func placeholder(in context: Context) -> DebtEntry { DebtEntry(date: .now, debts: nil) }
  func getSnapshot(in context: Context, completion: @escaping (DebtEntry) -> Void) {
    completion(DebtEntry(date: .now, debts: Store.feed?.debts))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<DebtEntry>) -> Void) {
    completion(every(DebtEntry(date: .now, debts: Store.feed?.debts), minutes: 120))
  }
}

struct DebtView: View {
  var entry: DebtEntry
  @Environment(\.widgetFamily) var family

  var body: some View {
    let d = entry.debts
    let net = d?.net ?? 0
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        Tile(symbol: "indianrupeesign", hue: Hue.debts)
        Text("Debts").font(.system(size: 14, weight: .bold))
        Spacer()
        LinkButton(url: "kaizen://open/debt", symbol: "plus")
      }
      Spacer(minLength: 0)
      Text(net == 0 ? "All settled" : net > 0 ? "You're owed" : "You owe").font(.system(size: 10)).foregroundStyle(.secondary)
      Text(net == 0 ? "₹0" : (d?.netText ?? "")).font(.system(size: 24, weight: .bold, design: .rounded))
        .foregroundStyle(net > 0 ? Hue.good : net < 0 ? Hue.danger : .primary)
      if family == .systemMedium, let people = d?.people, !people.isEmpty {
        ForEach(Array(people.prefix(3).enumerated()), id: \.offset) { _, p in
          HStack {
            Text(p.toMe ? "\(p.name) owes you" : "You owe \(p.name)").font(.system(size: 11)).lineLimit(1)
            Spacer()
            Text(p.amount).font(.system(size: 11, weight: .semibold)).foregroundStyle(p.toMe ? Hue.good : Hue.danger)
          }
        }
      } else {
        Text("\(d?.owedToMe ?? "₹0") to you · \(d?.iOwe ?? "₹0") owed").font(.system(size: 9)).foregroundStyle(.secondary)
          .lineLimit(1)
      }
    }
    .widgetURL(open("debts"))
    .containerBackground(for: .widget) { Wash(hue: Hue.debts) }
  }
}

struct DebtWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "debts", provider: DebtProvider()) { DebtView(entry: $0) }
      .configurationDisplayName("Debts")
      .description("Who owes whom, at a glance.")
      .supportedFamilies([.systemSmall, .systemMedium])
  }
}

// MARK: - Money

struct MoneyEntry: TimelineEntry {
  let date: Date
  let money: MoneyData?
  let fresh: Bool
}

struct MoneyProvider: TimelineProvider {
  func entry() -> MoneyEntry {
    let t = Store.today
    return MoneyEntry(date: .now, money: t?.money, fresh: t?.date == dayKey())
  }
  func placeholder(in context: Context) -> MoneyEntry { MoneyEntry(date: .now, money: nil, fresh: true) }
  func getSnapshot(in context: Context, completion: @escaping (MoneyEntry) -> Void) { completion(entry()) }
  func getTimeline(in context: Context, completion: @escaping (Timeline<MoneyEntry>) -> Void) {
    completion(every(entry(), minutes: 60))
  }
}

struct MoneyView: View {
  var entry: MoneyEntry
  @Environment(\.widgetFamily) var family

  var buttons: some View {
    HStack(spacing: 6) {
      Link(destination: open("expense")) {
        Label("Expense", systemImage: "minus").font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
          .frame(maxWidth: .infinity).frame(height: 26)
          .background(Capsule().fill(Hue.spend))
      }
      Link(destination: open("income")) {
        Label("Income", systemImage: "plus").font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
          .frame(maxWidth: .infinity).frame(height: 26)
          .background(Capsule().fill(Hue.finance))
      }
    }
    .labelStyle(.titleAndIcon)
  }

  var body: some View {
    let m = entry.money
    let today = entry.fresh ? (m?.spentToday ?? 0) : 0
    let summary = m?.hasAccounts == true
      ? "\(rupees(m?.spentMonth ?? 0)) this month · \(rupees(m?.balance ?? 0)) in accounts"
      : "Add an account in Kaizen"
    Group {
      if family == .systemSmall {
        VStack(alignment: .leading, spacing: 4) {
          HStack(spacing: 6) {
            Tile(symbol: "wallet.pass.fill", hue: Hue.finance, size: 22)
            Text("Spent today").font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
          }
          Text(rupees(today)).font(.system(size: 22, weight: .bold, design: .rounded)).minimumScaleFactor(0.6)
          Text(summary).font(.system(size: 9)).foregroundStyle(.secondary).lineLimit(2)
          Spacer(minLength: 0)
          buttons
        }
      } else {
        HStack(spacing: 12) {
          VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
              Tile(symbol: "wallet.pass.fill", hue: Hue.finance)
              Text("Money").font(.system(size: 14, weight: .bold))
            }
            Spacer(minLength: 0)
            Text("Spent today").font(.system(size: 10)).foregroundStyle(.secondary)
            Text(rupees(today)).font(.system(size: 26, weight: .bold, design: .rounded))
            Text(summary).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
          }
          VStack(spacing: 8) {
            Spacer(minLength: 0)
            buttons.frame(width: 110).fixedSize(horizontal: false, vertical: true)
          }
          .frame(width: 110)
        }
      }
    }
    .widgetURL(open("page:finance"))
    .containerBackground(for: .widget) { Wash(hue: Hue.finance) }
  }
}

struct MoneyWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "money", provider: MoneyProvider()) { MoneyView(entry: $0) }
      .configurationDisplayName("Money")
      .description("Today's spending, with buttons to add an expense or income.")
      .supportedFamilies([.systemSmall, .systemMedium])
  }
}
