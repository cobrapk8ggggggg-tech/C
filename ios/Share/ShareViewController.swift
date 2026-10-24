import UIKit
import Social
import UniformTypeIdentifiers

final class ShareViewController: SLComposeServiceViewController {
    override func isContentValid() -> Bool { true }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "حفظ في صدى"
        placeholder = "سيبدأ تحميل الصوت عند فتح صدى."
    }
    override func didSelectPost() {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        guard let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) || $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }) else { finish(); return }
        let type = provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) ? UTType.url.identifier : UTType.plainText.identifier
        provider.loadItem(forTypeIdentifier: type, options: nil) { [weak self] item, _ in
            let text = (item as? URL)?.absoluteString ?? (item as? String) ?? ""
            let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
            let url = detector?.firstMatch(in: text, range: NSRange(text.startIndex..., in: text))?.url
            DispatchQueue.main.async {
                guard let url, let host = url.host, ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].contains(host), let defaults = UserDefaults(suiteName: "group.com.sada.audio") else {
                    self?.title = "تعذر حفظ الرابط"
                    return
                }
                defaults.set(url.absoluteString, forKey: "pendingURL")
                self?.finish()
            }
        }
    }
    private func finish() { extensionContext?.completeRequest(returningItems: nil) }
}
