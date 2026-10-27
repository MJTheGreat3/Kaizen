// Music: the record with the cover on its label and a progress ring, as on
// the phone. Middle plays or pauses, the bottom corners skip, top left opens
// the song in Spotify, top right opens Music in Kaizen.

import AppIntents
import SwiftUI
import WidgetKit

struct MusicEntry: TimelineEntry {
  let date: Date
  let music: MusicData?
  let art: NSImage?
  /// 0...1 at `date`.
  let progress: Double
  let accent: Color
}

struct MusicProvider: TimelineProvider {
  func placeholder(in context: Context) -> MusicEntry {
    MusicEntry(date: .now, music: nil, art: nil, progress: 0.3, accent: Hue.accent)
  }

  /// The cover, kept in the extension's own caches by URL.
  func cover(_ url: String?) async -> NSImage? {
    guard let url, let remote = URL(string: url) else { return nil }
    let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    let file = caches.appendingPathComponent("cover-\(remote.lastPathComponent).jpg")
    if let data = try? Data(contentsOf: file), let image = NSImage(data: data) { return image }
    var request = URLRequest(url: remote)
    request.timeoutInterval = 8
    guard let (data, _) = try? await URLSession.shared.data(for: request), let image = NSImage(data: data) else { return nil }
    try? data.write(to: file)
    return image
  }

  func entries() async -> [MusicEntry] {
    let m = Store.music
    let art = await cover(m?.art)
    let accent = art.flatMap(averageColor) ?? Hue.accent
    let duration = (m?.durationMs ?? 0) / 1000
    var position = (m?.progressMs ?? 0) / 1000
    if m?.playing == true, let at = m?.at { position += Date.now.timeIntervalSince1970 - at / 1000 }
    let progress = { (p: Double) in duration > 0 ? min(1, max(0, p / duration)) : 0 }
    guard m?.playing == true, duration > 0 else {
      return [MusicEntry(date: .now, music: m, art: art, progress: progress(position), accent: accent)]
    }
    // The ring moves every 10 seconds until the song ends.
    let left = max(0, duration - position)
    return stride(from: 0.0, through: min(left, 600), by: 10).map {
      MusicEntry(date: .now.addingTimeInterval($0), music: m, art: art, progress: progress(position + $0), accent: accent)
    }
  }

  func getSnapshot(in context: Context, completion: @escaping (MusicEntry) -> Void) {
    Task { completion(await entries().first!) }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<MusicEntry>) -> Void) {
    Task {
      let list = await entries()
      completion(Timeline(entries: list, policy: .after((list.last?.date ?? .now).addingTimeInterval(30))))
    }
  }
}

/// The cover's average colour, for the ring and buttons.
func averageColor(_ image: NSImage) -> Color? {
  guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff) else { return nil }
  var r = 0.0, g = 0.0, b = 0.0, n = 0.0
  let step = max(1, min(bitmap.pixelsWide, bitmap.pixelsHigh) / 16)
  for x in stride(from: 0, to: bitmap.pixelsWide, by: step) {
    for y in stride(from: 0, to: bitmap.pixelsHigh, by: step) {
      guard let c = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.sRGB) else { continue }
      r += c.redComponent
      g += c.greenComponent
      b += c.blueComponent
      n += 1
    }
  }
  guard n > 0 else { return nil }
  // Brightened a little so it reads on the dark face.
  let lift = { (v: Double) in min(1, v / n * 1.25 + 0.08) }
  return Color(red: lift(r), green: lift(g), blue: lift(b))
}

struct Record: View {
  var art: NSImage?
  var body: some View {
    GeometryReader { geo in
      let size = min(geo.size.width, geo.size.height)
      ZStack {
        Circle().fill(Color(hex: "#111114"))
        ForEach(0..<6) { i in
          Circle().stroke(Color.white.opacity(0.05), lineWidth: 1).padding(size * (0.06 + Double(i) * 0.035))
        }
        Group {
          if let art {
            Image(nsImage: art).resizable().scaledToFill()
          } else {
            Color(hex: "#2A2A31").overlay(Image(systemName: "music.note").foregroundStyle(.secondary))
          }
        }
        .frame(width: size * 0.58, height: size * 0.58)
        .clipShape(Circle())
        Circle().fill(Hue.ink).frame(width: size * 0.06, height: size * 0.06)
      }
      .frame(width: size, height: size)
      .position(x: geo.size.width / 2, y: geo.size.height / 2)
    }
  }
}

struct RoundButton: View {
  var symbol: String
  var color: Color
  var body: some View {
    Image(systemName: symbol)
      .font(.system(size: 10, weight: .bold))
      .foregroundStyle(.white)
      .frame(width: 24, height: 24)
      .background(Circle().fill(color))
  }
}

struct MusicView: View {
  var entry: MusicEntry

  var body: some View {
    let m = entry.music
    let playing = m?.playing == true
    let hasSong = m?.title != nil
    ZStack {
      // Progress ring around the record.
      Circle().stroke(Color.white.opacity(0.15), lineWidth: 3).padding(10)
      Circle().trim(from: 0, to: entry.progress).stroke(entry.accent, style: StrokeStyle(lineWidth: 3, lineCap: .round))
        .rotationEffect(.degrees(-90)).padding(10)
      Record(art: hasSong ? entry.art : nil).padding(16)

      Button(intent: MusicControl(playing ? "pause" : "play")) {
        ZStack {
          Circle().fill(Color.clear).contentShape(Circle())
          if !playing {
            Image(systemName: "play.fill").font(.system(size: 22)).foregroundStyle(.white.opacity(0.9))
              .shadow(radius: 4)
          }
        }
      }
      .buttonStyle(.plain)
      .padding(30)

      VStack {
        HStack {
          if let uri = m?.uri, let url = URL(string: uri) {
            Link(destination: url) { RoundButton(symbol: "waveform", color: entry.accent) }
              .help("Open the song in Spotify")
          }
          Spacer()
          Link(destination: open("page:music")) { RoundButton(symbol: "music.note", color: entry.accent) }
        }
        Spacer()
        HStack {
          Button(intent: MusicControl("prev")) { RoundButton(symbol: "backward.fill", color: entry.accent) }
          Spacer()
          Button(intent: MusicControl("next")) { RoundButton(symbol: "forward.fill", color: entry.accent) }
        }
        .buttonStyle(.plain)
      }
      .padding(-4)

      if m?.connected != true {
        Text("Connect Spotify in Kaizen").font(.system(size: 10, weight: .semibold)).foregroundStyle(.white)
          .padding(6).background(Capsule().fill(.black.opacity(0.6)))
      }
    }
    .containerBackground(for: .widget) {
      ZStack {
        Hue.ink
        RadialGradient(colors: [entry.accent.opacity(0.35), .clear], center: .center, startRadius: 10, endRadius: 120)
      }
    }
  }
}

struct MusicWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "music", provider: MusicProvider()) { MusicView(entry: $0) }
      .configurationDisplayName("Music")
      .description("What Spotify is playing. Play, pause and skip from here.")
      .supportedFamilies([.systemSmall])
  }
}

@main
struct KaizenWidgets: WidgetBundle {
  var body: some Widget {
    TodayWidget()
    StreakWidget()
    UpNextWidget()
    DebtWidget()
    MoneyWidget()
    MusicWidget()
  }
}
