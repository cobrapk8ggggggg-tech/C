import Foundation

struct AudioSource {
    let url: URL
    let title: String
    let author: String
}
enum SourceError: LocalizedError {
    case invalidURL, unavailable, invalidAudio
    var errorDescription: String? {
        switch self {
        case .invalidURL: return "ألصق رابط فيديو يوتيوب صالحاً."
        case .unavailable: return "لم يُرجع المصدر رابط صوت قابلاً للتنزيل. حاول بفيديو آخر."
        case .invalidAudio: return "الملف المستلم ليس صوتاً صالحاً للتشغيل."
        }
    }
}
enum YouTube {
    static func videoID(_ text: String) -> String? {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = url.host?.lowercased(), ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].contains(host) else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        let id: String?
        if host == "youtu.be" { id = parts.first }
        else if ["shorts", "embed", "live"].contains(parts.first ?? "") { id = parts.dropFirst().first }
        else { id = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "v" })?.value }
        guard let id, id.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil else { return nil }
        return id
    }
    // Port of the attached watch?pbj=1 request. Only direct MP4 audio is playable by AVPlayer.
    static func resolve(_ text: String) async throws -> AudioSource {
        guard let id = videoID(text) else { throw SourceError.invalidURL }
        var request = URLRequest(url: URL(string: "https://www.youtube.com/watch?v=\(id)&pbj=1")!)
        request.setValue("Mozilla/5.0", forHTTPHeaderField: "User-Agent")
        request.setValue("1", forHTTPHeaderField: "x-youtube-client-name")
        request.setValue("2.20260715.04.00", forHTTPHeaderField: "x-youtube-client-version")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw SourceError.unavailable }
        let json: Any
        if let decoded = try? JSONSerialization.jsonObject(with: data) { json = decoded }
        else if let html = String(data: data, encoding: .utf8),
                let marker = html.range(of: "ytInitialPlayerResponse = "),
                let start = html[marker.upperBound...].firstIndex(of: "{") {
            var depth = 0, quoted = false, escaped = false
            var end: String.Index?
            for index in html[start...].indices {
                let char = html[index]
                if escaped { escaped = false; continue }
                if char == "\\" && quoted { escaped = true; continue }
                if char == "\"" { quoted.toggle() }
                if !quoted {
                    if char == "{" { depth += 1 }
                    if char == "}" { depth -= 1; if depth == 0 { end = index; break } }
                }
            }
            guard let end, let payload = String(html[start...end]).data(using: .utf8) else { throw SourceError.unavailable }
            json = ["playerResponse": try JSONSerialization.jsonObject(with: payload)]
        } else { throw SourceError.unavailable }
        let objects = (json as? [[String: Any]]) ?? [(json as? [String: Any]) ?? [:]]
        for object in objects {
            guard let player = object["playerResponse"] as? [String: Any],
                  let stream = player["streamingData"] as? [String: Any],
                  let formats = stream["adaptiveFormats"] as? [[String: Any]] else { continue }
            let audio = formats.filter { ($0["mimeType"] as? String ?? "").hasPrefix("audio/mp4") }
                .sorted { ($0["bitrate"] as? Int ?? 0) > ($1["bitrate"] as? Int ?? 0) }
            for format in audio {
                guard let value = format["url"] as? String, let url = URL(string: value), url.scheme == "https" else { continue }
                let detail = player["videoDetails"] as? [String: Any] ?? [:]
                return AudioSource(url: url, title: detail["title"] as? String ?? id, author: detail["author"] as? String ?? "YouTube")
            }
        }
        // serverAbrStreamingUrl is a streaming protocol endpoint, not an M4A file;
        // appending itag as in the sample cannot safely create a downloadable audio file.
        throw SourceError.unavailable
    }
}
