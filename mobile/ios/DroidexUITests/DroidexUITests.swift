import XCTest

final class DroidexUITests: XCTestCase {
    @MainActor
    func testAddComputerOpensPairingAndInvalidCodeShowsError() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--pairing-ui-testing"]
        app.launch()
        let add = app.buttons["pairing.add-computer"]
        XCTAssertTrue(add.waitForExistence(timeout: 5))
        XCTAssertTrue(add.isHittable)
        add.tap()
        XCTAssertTrue(app.buttons["pairing.scan"].waitForExistence(timeout: 3))
        let code = app.descendants(matching: .any).matching(identifier: "pairing.code").firstMatch
        XCTAssertTrue(code.waitForExistence(timeout: 3))
        code.tap()
        code.typeText("not-a-pairing-code")
        let connect = app.buttons["pairing.connect"]
        for _ in 0..<3 where !connect.isHittable { app.swipeUp() }
        connect.tap()
        XCTAssertTrue(app.staticTexts["pairing.error"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["pairing.scan"].exists)
    }

    @MainActor
    func testBackAndReopenPairingKeepsThePrimaryActionHittable() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--pairing-ui-testing"]
        app.launch()
        let add = app.buttons["pairing.add-computer"]
        XCTAssertTrue(add.waitForExistence(timeout: 5))
        add.tap()
        XCTAssertTrue(app.buttons["pairing.scan"].waitForExistence(timeout: 3))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(add.waitForExistence(timeout: 3))
        XCTAssertTrue(add.isHittable)
        add.tap()
        XCTAssertTrue(app.buttons["pairing.scan"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.buttons["Explore offline preview"].exists)
    }
}
