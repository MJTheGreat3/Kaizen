// Taps on the widgets. Each leaves an action for Kaizen and returns at once;
// WidgetKit then redraws the widget, which shows the tap as already done.

import AppIntents
import WidgetKit

struct CompleteTask: AppIntent {
  static var title: LocalizedStringResource = "Complete task"
  static var isDiscoverable = false
  @Parameter(title: "Task") var id: String

  init() {}
  init(id: String) { self.id = id }

  func perform() async throws -> some IntentResult {
    Store.act("task:\(id)")
    return .result()
  }
}

struct TickHabit: AppIntent {
  static var title: LocalizedStringResource = "Tick habit"
  static var isDiscoverable = false
  @Parameter(title: "Habit") var id: String

  init() {}
  init(id: String) { self.id = id }

  func perform() async throws -> some IntentResult {
    Store.act("habit:\(id)")
    return .result()
  }
}

/// Shows the next or previous page of one of the Today widget's lists.
struct TurnPage: AppIntent {
  static var title: LocalizedStringResource = "Turn page"
  static var isDiscoverable = false
  @Parameter(title: "List") var list: String
  @Parameter(title: "By") var by: Int

  init() {}
  init(list: String, by: Int) {
    self.list = list
    self.by = by
  }

  func perform() async throws -> some IntentResult {
    var pages = Store.pages
    pages[list] = max(0, (pages[list] ?? 0) + by)
    Store.pages = pages
    return .result()
  }
}

struct MusicControl: AppIntent {
  static var title: LocalizedStringResource = "Control music"
  static var isDiscoverable = false
  /// `play`, `pause`, `next` or `prev`.
  @Parameter(title: "Command") var command: String

  init() {}
  init(_ command: String) { self.command = command }

  func perform() async throws -> some IntentResult {
    Store.act("music:\(command)")
    return .result()
  }
}
