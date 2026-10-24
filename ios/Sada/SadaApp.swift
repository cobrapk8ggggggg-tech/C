import SwiftUI

@main struct SadaApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var library = Library()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            LibraryView().environmentObject(library)
                .preferredColorScheme(.dark).tint(.white)
                .environment(\.layoutDirection, .rightToLeft)
                .onChange(of: phase) { _, value in if value == .active { library.importShared() } }
                .onOpenURL { url in Task { await library.download(url.absoluteString) } }
        }
    }
}
struct Cover: View {
    var large = false
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: large ? 28 : 12).fill(LinearGradient(colors: [Color(white: 0.23), Color(white: 0.06)], startPoint: .topLeading, endPoint: .bottomTrailing))
            Circle().stroke(.white.opacity(0.06), lineWidth: large ? 32 : 6).padding(large ? 42 : 9)
            Image(systemName: "waveform").font(.system(size: large ? 82 : 23, weight: .ultraLight)).foregroundStyle(.white)
        }.aspectRatio(1, contentMode: .fit)
    }
}
struct LibraryView: View {
    @EnvironmentObject var library: Library
    @State private var add = false
    @State private var player = false
    @State private var sidebar = false
    @State private var query = ""
    var body: some View {
        ZStack(alignment: .trailing) {
            Color.black.ignoresSafeArea()
            VStack(spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("صدى").font(.system(size: 14, weight: .medium)).foregroundStyle(.secondary)
                        Text("المضافة حديثاً").font(.system(size: 34, weight: .bold))
                    }
                    Spacer()
                    Button { add = true } label: { Image(systemName: "plus").font(.title3).frame(width: 44, height: 44).background(.white.opacity(0.1), in: Circle()) }.accessibilityLabel("إضافة رابط")
                    Button { withAnimation(.easeInOut) { sidebar.toggle() } } label: { Image(systemName: "sidebar.right").font(.title3).frame(width: 44, height: 44) }.accessibilityLabel("المكتبة")
                }.padding(.horizontal, 24).padding(.top, 16).padding(.bottom, 24)
                HStack {
                    Image(systemName: "magnifyingglass")
                    TextField("ابحث في مكتبتك", text: $query)
                }.foregroundStyle(.secondary).padding(15).background(Color(white: 0.09), in: RoundedRectangle(cornerRadius: 16)).padding(.horizontal, 24)
                HStack { Text("محفوظة على جهازك"); Spacer(); Text("\(library.tracks.count) مقطع") }.font(.caption).foregroundStyle(.secondary).padding(24)
                if library.tracks.isEmpty {
                    Spacer()
                    Cover().frame(width: 124).rotationEffect(.degrees(-7)).padding(.bottom, 22)
                    Text("كل ما تحب، معك دائماً").font(.title3.bold())
                    Text("أضف رابطاً واحفظ الصوت في مكتبتك\nواستمع إليه حتى بدون إنترنت.").font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center).lineSpacing(7).padding(.top, 8)
                    Button { add = true } label: { Label("إضافة أول مقطع", systemImage: "plus").font(.subheadline.bold()).padding(.horizontal, 22).padding(.vertical, 15).background(.white, in: Capsule()).foregroundStyle(.black) }.padding(.top, 24)
                    Spacer()
                } else {
                    ScrollView {
                        LazyVStack(spacing: 18) {
                            ForEach(library.tracks.filter { query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) }) { track in
                                HStack(spacing: 14) {
                                    Button { library.play(track); player = true } label: {
                                        HStack(spacing: 14) {
                                            Cover().frame(width: 60)
                                            VStack(alignment: .leading, spacing: 6) { Text(track.title).font(.headline).lineLimit(1); Text(track.author).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                                            Spacer()
                                        }
                                    }.buttonStyle(.plain)
                                    Menu { Button("حذف من الجهاز", role: .destructive) { library.delete(track) } } label: { Image(systemName: "ellipsis").frame(width: 44, height: 44) }
                                }
                            }
                        }.padding(.horizontal, 24)
                    }
                }
                if library.busy { HStack { ProgressView().tint(.white); Text("جارٍ حفظ الصوت…").font(.caption) }.padding() }
                HStack(spacing: 14) {
                    Cover().frame(width: 44)
                    Button { player = true } label: { VStack(alignment: .leading, spacing: 4) { Text(library.current?.title ?? "غير مشغّل").font(.subheadline.bold()).lineLimit(1); Text(library.current?.author ?? "مكتبتك، على إيقاعك").font(.caption2).foregroundStyle(.secondary) }.frame(maxWidth: .infinity, alignment: .leading) }.buttonStyle(.plain)
                    Button { library.toggle() } label: { Image(systemName: library.playing ? "pause.fill" : "play.fill").font(.title2).frame(width: 44, height: 44) }.accessibilityLabel("تشغيل أو إيقاف")
                    Button { library.next(1) } label: { Image(systemName: "forward.fill").frame(width: 40, height: 44) }.accessibilityLabel("التالي")
                }.padding(12).background(Color(white: 0.12), in: RoundedRectangle(cornerRadius: 22)).padding(16)
            }
            if sidebar {
                Color.black.opacity(0.6).ignoresSafeArea().onTapGesture { withAnimation { sidebar = false } }
                VStack(alignment: .leading, spacing: 28) {
                    HStack { Text("المكتبة").font(.largeTitle.bold()); Spacer(); Button { sidebar = false } label: { Image(systemName: "xmark") } }
                    Label("المضافة حديثاً", systemImage: "clock").padding(16).frame(maxWidth: .infinity, alignment: .leading).background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
                    Label("الأغاني المحفوظة", systemImage: "music.note")
                    Label("متاحة بدون إنترنت", systemImage: "arrow.down.circle")
                    Spacer()
                    Button { sidebar = false; add = true } label: { Label("إضافة من يوتيوب", systemImage: "plus.circle") }
                }.padding(24).frame(maxWidth: 320).background(Color(white: 0.1)).transition(.move(edge: .trailing))
            }
        }
        .sheet(isPresented: $add) { AddView().presentationDetents([.medium, .large]) }
        .sheet(isPresented: $player) { PlayerView() }
        .alert("صدى", isPresented: Binding(get: { library.message != nil }, set: { if !$0 { library.message = nil } })) { Button("حسناً") { library.message = nil } } message: { Text(library.message ?? "") }
    }
}
struct AddView: View {
    @EnvironmentObject var library: Library
    @Environment(\.dismiss) var dismiss
    @State private var link = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Capsule().fill(.gray).frame(width: 36, height: 4).frame(maxWidth: .infinity)
            Text("أضف إلى صدى").font(.largeTitle.bold())
            Text("ألصق رابط يوتيوب لحفظ الصوت على جهازك.").foregroundStyle(.secondary)
            TextField("https://youtu.be/…", text: $link).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().padding(18).background(Color(white: 0.12), in: RoundedRectangle(cornerRadius: 14)).environment(\.layoutDirection, .leftToRight)
            Button { let value = link; dismiss(); Task { await library.download(value) } } label: { Label("تحميل الصوت", systemImage: "arrow.down").font(.headline).frame(maxWidth: .infinity).padding(18).background(.white, in: RoundedRectangle(cornerRadius: 16)).foregroundStyle(.black) }.disabled(YouTube.videoID(link) == nil || library.busy)
            Spacer()
        }.padding(28).background(.black)
    }
}
struct PlayerView: View {
    @EnvironmentObject var library: Library
    @Environment(\.dismiss) var dismiss
    var body: some View {
        GeometryReader { geo in
            VStack(spacing: 24) {
                Button { dismiss() } label: { Capsule().fill(.gray).frame(width: 36, height: 4).padding(12) }.accessibilityLabel("إغلاق المشغل")
                Spacer(minLength: 0)
                Cover(large: true).frame(maxWidth: min(geo.size.width - 56, 470)).shadow(color: .white.opacity(0.06), radius: 35)
                VStack(alignment: .leading, spacing: 9) { Text(library.current?.title ?? "اختر مقطعاً من مكتبتك").font(.title2.bold()).lineLimit(2); Text(library.current?.author ?? "صدى").foregroundStyle(.secondary) }.frame(maxWidth: .infinity, alignment: .leading)
                VStack {
                    Slider(value: Binding(get: { library.elapsed }, set: { library.seek($0) }), in: 0...max(library.current?.duration ?? 1, 1)).disabled(library.current == nil)
                    HStack { Text(time(library.elapsed)); Spacer(); Text(time(library.current?.duration ?? 0)) }.font(.caption.monospacedDigit()).foregroundStyle(.secondary).environment(\.layoutDirection, .leftToRight)
                }
                HStack(spacing: 50) {
                    Button { library.next(-1) } label: { Image(systemName: "backward.fill").font(.title) }
                    Button { library.toggle() } label: { Image(systemName: library.playing ? "pause.fill" : "play.fill").font(.system(size: 46)) }.accessibilityLabel("تشغيل أو إيقاف")
                    Button { library.next(1) } label: { Image(systemName: "forward.fill").font(.title) }
                }.environment(\.layoutDirection, .leftToRight).padding(.vertical, 20)
                Spacer(minLength: 0)
                HStack { Image(systemName: "arrow.down.circle.fill"); Text("الصوت المحفوظ متاح بدون إنترنت"); Spacer(); Image(systemName: "headphones") }.font(.caption).foregroundStyle(.secondary)
            }.padding(28).frame(maxWidth: .infinity).background(.black)
        }
    }
    func time(_ seconds: Double) -> String { String(format: "%d:%02d", Int(seconds) / 60, Int(seconds) % 60) }
}
