import XCTest
@testable import Sada
final class YouTubeTests: XCTestCase {
    func testSupportedLinks() {
        for link in ["https://youtu.be/i7u8zYhOP-o?t=20", "https://www.youtube.com/watch?v=i7u8zYhOP-o&list=abc", "https://youtube.com/shorts/i7u8zYhOP-o", "https://music.youtube.com/watch?v=i7u8zYhOP-o"] {
            XCTAssertEqual(YouTube.videoID(link), "i7u8zYhOP-o")
        }
    }
    func testRejectsSpoofedHostsAndMalformedIDs() {
        for link in ["https://youtube.com.evil.org/watch?v=i7u8zYhOP-o", "https://example.com/i7u8zYhOP-o", "https://youtu.be/short", "garbage"] { XCTAssertNil(YouTube.videoID(link)) }
    }
}
