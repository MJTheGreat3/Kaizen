// Linked into the app by build.rs: lets Rust ask WidgetKit to redraw the
// desktop widgets after it writes their data (see src/mac_widgets.rs).
import WidgetKit

@_cdecl("kaizen_reload_widgets")
public func kaizenReloadWidgets() {
  if #available(macOS 11.0, *) {
    WidgetCenter.shared.reloadAllTimelines()
  }
}
