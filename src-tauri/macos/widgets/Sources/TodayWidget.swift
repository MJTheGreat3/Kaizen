// Today: four lists, as on the phone: due today or overdue, today's habits,
// undated tasks and active goals. Widgets can't scroll, so each list pages
// with its own arrows. Ticking a task or habit applies it in Kaizen.

import AppIntents
import SwiftUI
import WidgetKit

struct TodayEntry: TimelineEntry {
  let date: Date
  let today: TodayData?
  let goals: [GoalData]
  let pending: Set<String>
  let pages: [String: Int]
}

struct TodayProvider: TimelineProvider {
  func placeholder(in context: Context) -> TodayEntry {
    TodayEntry(date: .now, today: nil, goals: [], pending: [], pages: [:])
  }

  func entry() -> TodayEntry {
    TodayEntry(date: .now, today: Store.today, goals: Store.feed?.goals ?? [], pending: Store.pending(), pages: Store.pages)
  }

  func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) { completion(entry()) }

  func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
    // Again just after midnight, when the lists change.
    let midnight = Calendar.current.startOfDay(for: .now.addingTimeInterval(86_400)).addingTimeInterval(60)
    completion(Timeline(entries: [entry()], policy: .after(min(midnight, .now.addingTimeInterval(1800)))))
  }
}

/// One of the four lists: a title with its count, a page of rows and arrows.
struct Pane<Content: View>: View {
  var key: String
  var title: String
  var count: String
  var page: Int
  var pages: Int
  var empty: String
  var isEmpty: Bool
  @ViewBuilder var rows: () -> Content

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack(spacing: 4) {
        Text(title.uppercased()).font(.system(size: 9, weight: .bold)).kerning(0.5)
        if !count.isEmpty { Text("· \(count)").font(.system(size: 9, weight: .bold)) }
        Spacer(minLength: 0)
        if pages > 1 {
          Button(intent: TurnPage(list: key, by: -1)) { Image(systemName: "chevron.up") }
            .disabled(page == 0)
          Button(intent: TurnPage(list: key, by: 1)) { Image(systemName: "chevron.down") }
            .disabled(page >= pages - 1)
        }
      }
      .foregroundStyle(.secondary)
      .buttonStyle(.plain)
      .font(.system(size: 9, weight: .bold))
      if isEmpty {
        Spacer(minLength: 0)
        Text(empty).font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity)
        Spacer(minLength: 0)
      } else {
        rows()
        Spacer(minLength: 0)
      }
    }
    .padding(8)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(.primary.opacity(0.05)))
  }
}

struct CheckRow: View {
  var title: String
  var meta: String
  var metaColor: Color
  var done: Bool
  var tint: Color

  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: done ? "checkmark.circle.fill" : "circle")
        .font(.system(size: 13))
        .foregroundStyle(tint)
      Text(title).font(.system(size: 12)).lineLimit(1).opacity(done ? 0.5 : 1)
        .strikethrough(done, color: .secondary)
      Spacer(minLength: 2)
      if !meta.isEmpty { Text(meta).font(.system(size: 10)).foregroundStyle(metaColor).lineLimit(1) }
    }
    .frame(height: 19)
    .contentShape(Rectangle())
  }
}

struct TodayView: View {
  var entry: TodayEntry
  static let rows = 5
  static let goalRows = 3

  func slice<T>(_ items: [T], key: String, per: Int) -> (items: [T], page: Int, pages: Int) {
    let pages = max(1, Int((Double(items.count) / Double(per)).rounded(.up)))
    let page = min(entry.pages[key] ?? 0, pages - 1)
    return (Array(items.dropFirst(page * per).prefix(per)), page, pages)
  }

  var body: some View {
    let t = entry.today
    let stale = t == nil || t?.date != dayKey(entry.date)
    let due = t?.tasks ?? []
    let someday = t?.someday ?? []
    let habits = t?.habits ?? []
    let habitDone = { (h: WidgetHabit) in (h.done ?? false) != entry.pending.contains("habit:\(h.id)") }
    let doneCount = habits.filter(habitDone).count
    let dueCount = due.count + (t?.moreTasks ?? 0)

    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Link(destination: open("page:today")) {
          HStack(spacing: 8) {
            Tile(symbol: "sun.max.fill", hue: Hue.today)
            VStack(alignment: .leading, spacing: 0) {
              Text(stale ? "Today" : (t?.label ?? "Today")).font(.system(size: 14, weight: .bold))
              Text(stale ? "Open Kaizen to bring this up to date"
                : [dueCount > 0 ? "\(dueCount) due" : nil, habits.isEmpty ? nil : "\(doneCount) of \(habits.count) habits"]
                  .compactMap { $0 }.joined(separator: " · ").ifEmpty("All clear"))
                .font(.system(size: 10)).foregroundStyle(.secondary)
            }
          }
        }
        Spacer()
        LinkButton(url: "kaizen://open/board", symbol: "scribble")
        LinkButton(url: "kaizen://open/task", symbol: "plus")
      }

      if !stale {
        Grid(horizontalSpacing: 6, verticalSpacing: 6) {
          GridRow {
            let d = slice(due, key: "due", per: Self.rows)
            Pane(key: "due", title: "Due today", count: dueCount > 0 ? "\(dueCount)" : "", page: d.page, pages: d.pages,
                 empty: "Nothing due", isEmpty: due.isEmpty) {
              ForEach(d.items) { task in taskRow(task) }
            }
            let h = slice(habits, key: "habits", per: Self.rows)
            Pane(key: "habits", title: "Habits", count: habits.isEmpty ? "" : "\(doneCount)/\(habits.count)", page: h.page,
                 pages: h.pages, empty: "No habits today", isEmpty: habits.isEmpty) {
              ForEach(h.items) { habit in
                Button(intent: TickHabit(id: habit.id)) {
                  CheckRow(title: habit.name, meta: habit.progress ?? "", metaColor: .secondary, done: habitDone(habit),
                           tint: Color(hex: habit.color, fallback: Hue.accent))
                }
                .buttonStyle(.plain)
              }
            }
          }
          GridRow {
            let s = slice(someday, key: "someday", per: Self.rows)
            Pane(key: "someday", title: "Someday", count: someday.isEmpty ? "" : "\(someday.count)", page: s.page,
                 pages: s.pages, empty: "No undated tasks", isEmpty: someday.isEmpty) {
              ForEach(s.items) { task in taskRow(task) }
            }
            let g = slice(entry.goals, key: "goals", per: Self.goalRows)
            Pane(key: "goals", title: "Goals", count: entry.goals.isEmpty ? "" : "\(entry.goals.count)", page: g.page,
                 pages: g.pages, empty: "No active goals", isEmpty: entry.goals.isEmpty) {
              ForEach(g.items) { goal in goalRow(goal) }
            }
          }
        }
      } else {
        Spacer()
      }
    }
    .containerBackground(for: .widget) { Wash(hue: Hue.today) }
  }

  func taskRow(_ task: WidgetTask) -> some View {
    let done = entry.pending.contains("task:\(task.id)")
    let tint = task.overdue == true ? Hue.danger : Color.secondary
    return Button(intent: CompleteTask(id: task.id)) {
      CheckRow(title: task.title, meta: task.when ?? "", metaColor: tint, done: done, tint: done ? Hue.today : tint)
    }
    .buttonStyle(.plain)
    .disabled(done)
  }

  func goalRow(_ goal: GoalData) -> some View {
    Link(destination: open("page:goals")) {
      VStack(alignment: .leading, spacing: 3) {
        HStack {
          Text(goal.title).font(.system(size: 12)).lineLimit(1)
          Spacer(minLength: 2)
          Text("\(goal.percent)%").font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary)
        }
        ProgressView(value: Double(goal.percent), total: 100)
          .progressViewStyle(.linear)
          .tint(Color(hex: goal.color, fallback: Hue.accent))
          .controlSize(.mini)
      }
      .frame(height: 30)
    }
  }
}

extension String {
  func ifEmpty(_ other: String) -> String { isEmpty ? other : self }
}

struct TodayWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "today", provider: TodayProvider()) { TodayView(entry: $0) }
      .configurationDisplayName("Today")
      .description("Due and undated tasks, habits and goals. Tick tasks and habits off here.")
      .supportedFamilies([.systemLarge, .systemExtraLarge])
  }
}
