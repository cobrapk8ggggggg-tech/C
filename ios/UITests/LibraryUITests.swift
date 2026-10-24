import XCTest
final class LibraryUITests: XCTestCase {
    func testLibraryAndImportSheet() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["المضافة حديثاً"].waitForExistence(timeout: 10))
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Sada Library"; shot.lifetime = .keepAlways; add(shot)
        app.buttons["إضافة رابط"].tap()
        XCTAssertTrue(app.staticTexts["أضف إلى صدى"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.buttons["تحميل الصوت"].isEnabled)
    }
}
