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
    private lazy var transfers: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: "com.sada.audio.downloads")
        config.sessionSendsLaunchEvents = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
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
        _ = transfers
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.elapsed = self?.player?.currentTime ?? 0 }
        }
    }
    func download(_ link: String) async {
        guard !busy else { return }
        busy = true
        do {
            let source = try await YouTube.resolve(link)
            let task = transfers.downloadTask(with: source.url)
            task.taskDescription = source.title + "\n" + source.author
            task.resume()
        } catch { busy = false; message = error.localizedDescription }
    }
    private func accept(_ temp: URL, description: String, valid: Bool) {
        defer { busy = false; try? FileManager.default.removeItem(at: temp) }
        do {
            guard valid else { throw SourceError.invalidAudio }
            let probe = try AVAudioPlayer(contentsOf: temp)
            guard probe.duration > 0 else { throw SourceError.invalidAudio }
            let file = UUID().uuidString + ".m4a"
            try FileManager.default.moveItem(at: temp, to: root.appendingPathComponent(file))
            let parts = description.components(separatedBy: "\n")
            tracks.insert(Track(id: UUID(), title: parts.first ?? "صوت", author: parts.dropFirst().joined(separator: " "), file: file, duration: probe.duration), at: 0)
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

extension Library: URLSessionDownloadDelegate {
    nonisolated func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        do { try FileManager.default.moveItem(at: location, to: copy) }
        catch { Task { @MainActor in self.busy = false; self.message = error.localizedDescription }; return }
        let response = downloadTask.response as? HTTPURLResponse
        let valid = response?.statusCode == 200 && !(response?.mimeType ?? "").contains("text") && !(response?.mimeType ?? "").contains("json")
        let description = downloadTask.taskDescription ?? "صوت"
        Task { @MainActor in self.accept(copy, description: description, valid: valid) }
    }
    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error { Task { @MainActor in self.busy = false; self.message = error.localizedDescription } }
    }
    nonisolated func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        Task { @MainActor in BackgroundEvents.completion?(); BackgroundEvents.completion = nil }
    }
}
@MainActor enum BackgroundEvents { static var completion: (() -> Void)? }
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        BackgroundEvents.completion = completionHandler
    }
}
