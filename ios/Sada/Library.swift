import SwiftUI
import AVFoundation
import MediaPlayer

struct Track: Codable, Identifiable, Equatable {
    var id: UUID
    var title: String
    var author: String
    var file: String
    var duration: Double
}
@MainActor final class Library: NSObject, ObservableObject, AVAudioPlayerDelegate {
    @Published var tracks: [Track] = []
    @Published var current: Track?
    @Published var playing = false
    @Published var busy = false
    @Published var message: String?
    @Published var elapsed = 0.0
    private var player: AVAudioPlayer?
    private var timer: Timer?
    private let root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    override init() {
        super.init()
        tracks = (try? JSONDecoder().decode([Track].self, from: Data(contentsOf: root.appendingPathComponent("library.json")))) ?? []
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch { message = error.localizedDescription }
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in Task { @MainActor in self?.resume() }; return .success }
        center.pauseCommand.addTarget { [weak self] _ in Task { @MainActor in self?.pause() }; return .success }
        center.nextTrackCommand.addTarget { [weak self] _ in Task { @MainActor in self?.next(1) }; return .success }
        center.previousTrackCommand.addTarget { [weak self] _ in Task { @MainActor in self?.next(-1) }; return .success }
        NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let type = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            Task { @MainActor in if type == AVAudioSession.InterruptionType.began.rawValue { self?.pause() } }
        }
        NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            let reason = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            Task { @MainActor in if reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { self?.pause() } }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.elapsed = self?.player?.currentTime ?? 0 }
        }
    }
    func download(_ link: String) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let source = try await YouTube.resolve(link)
            let (temp, response) = try await URLSession.shared.download(from: source.url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  !(http.mimeType ?? "").contains("text"), !(http.mimeType ?? "").contains("json") else { throw SourceError.invalidAudio }
            let probe = try AVAudioPlayer(contentsOf: temp)
            guard probe.duration > 0 else { throw SourceError.invalidAudio }
            let id = UUID(), file = UUID().uuidString + ".m4a"
            try FileManager.default.moveItem(at: temp, to: root.appendingPathComponent(file))
            tracks.insert(Track(id: id, title: source.title, author: source.author, file: file, duration: probe.duration), at: 0)
            try save()
            message = "تم الحفظ • متاح بدون إنترنت"
        } catch { message = error.localizedDescription }
    }
    func importShared() {
        guard let defaults = UserDefaults(suiteName: "group.com.sada.audio"), let link = defaults.string(forKey: "pendingURL") else { return }
        defaults.removeObject(forKey: "pendingURL")
        Task { await download(link) }
    }
    private func save() throws { try JSONEncoder().encode(tracks).write(to: root.appendingPathComponent("library.json"), options: .atomic) }
    func play(_ track: Track) {
        do {
            player = try AVAudioPlayer(contentsOf: root.appendingPathComponent(track.file))
            player?.delegate = self
            current = track
            resume()
        } catch { message = error.localizedDescription }
    }
    func resume() {
        do { try AVAudioSession.sharedInstance().setActive(true) } catch { message = error.localizedDescription }
        playing = player?.play() ?? false
        metadata()
    }
    func pause() { player?.pause(); playing = false; metadata() }
    func toggle() { if playing { pause() } else if player != nil { resume() } else if let first = tracks.first { play(first) } }
    func next(_ step: Int) {
        guard !tracks.isEmpty else { return }
        let index = current.flatMap { tracks.firstIndex(of: $0) } ?? 0
        play(tracks[(index + step + tracks.count) % tracks.count])
    }
    func seek(_ seconds: Double) { player?.currentTime = seconds; elapsed = seconds; metadata() }
    func delete(_ track: Track) {
        do {
            try FileManager.default.removeItem(at: root.appendingPathComponent(track.file))
            tracks.removeAll { $0.id == track.id }
            if current?.id == track.id { pause(); current = nil; player = nil }
            try save()
        } catch { message = error.localizedDescription }
    }
    private func metadata() {
        guard let current else { MPNowPlayingInfoCenter.default().nowPlayingInfo = nil; return }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [MPMediaItemPropertyTitle: current.title, MPMediaItemPropertyArtist: current.author, MPMediaItemPropertyPlaybackDuration: current.duration, MPNowPlayingInfoPropertyElapsedPlaybackTime: player?.currentTime ?? 0, MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0]
    }
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) { Task { @MainActor in next(1) } }
}
