import XCTest

final class DroidexUITests: XCTestCase {
    @MainActor
    func testSeededSessionCanBeReviewedAndApproved() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        let session = app.staticTexts["Refine the mobile composer"]
        XCTAssertTrue(session.waitForExistence(timeout: 5))
        session.tap()
        let review = app.buttons["review.open"]
        XCTAssertTrue(review.waitForExistence(timeout: 5))
        if !review.isHittable { app.swipeUp() }
        review.tap()
        let approve = app.buttons["approval.allow"]
        XCTAssertTrue(approve.waitForExistence(timeout: 5))
        for _ in 0..<4 where !approve.isHittable { app.swipeUp() }
        approve.tap()
        let removed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: approve)
        XCTAssertEqual(XCTWaiter.wait(for: [removed], timeout: 5), .completed)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Reviewed sample patch"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    func testNewSessionCanStartAndStop() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        let compose = app.buttons["inbox.compose"]
        XCTAssertTrue(compose.waitForExistence(timeout: 5))
        compose.tap()
        let prompt = app.descendants(matching: .any).matching(identifier: "new-session.prompt").firstMatch
        XCTAssertTrue(prompt.waitForExistence(timeout: 5))
        prompt.tap()
        prompt.typeText("Make the mobile composer feel native")
        app.buttons["new-session.start"].tap()
        let stop = app.buttons["composer.stop"]
        XCTAssertTrue(stop.waitForExistence(timeout: 5))
        stop.tap()
        XCTAssertTrue(app.buttons["composer.send"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Stopped"].exists)
    }

    @MainActor
    func testAddComputerOpensPairingAndInvalidCodeShowsError() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--pairing-ui-testing"]
        app.launch()
        let add = app.buttons["pairing.add-computer"]
        XCTAssertTrue(add.waitForExistence(timeout: 5))
        for _ in 0..<3 where !add.isHittable { app.swipeUp() }
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
    func testSettingsRemoteCanStartPairing() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        let settings = app.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.tap()
        let remote = app.descendants(matching: .any).matching(identifier: "settings.remote").firstMatch
        XCTAssertTrue(remote.waitForExistence(timeout: 3))
        for _ in 0..<3 where !remote.isHittable { app.swipeUp() }
        remote.tap()
        let add = app.buttons["remote.add-computer"]
        XCTAssertTrue(add.waitForExistence(timeout: 3))
        add.tap()
        XCTAssertTrue(app.buttons["pairing.scan"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "pairing.paste").firstMatch.exists)
    }

    @MainActor
    func testActivityCanExpandAndCollapseWithoutLosingReviewEntry() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        let session = app.staticTexts["Refine the mobile composer"]
        XCTAssertTrue(session.waitForExistence(timeout: 5))
        session.tap()
        let activity = app.buttons["activity.disclosure"]
        XCTAssertTrue(activity.waitForExistence(timeout: 5))
        for _ in 0..<3 where !activity.isHittable { app.swipeDown() }
        activity.tap()
        XCTAssertTrue(app.staticTexts["Inspect sample layout"].exists)
        activity.tap()
        XCTAssertFalse(app.staticTexts["Inspect sample layout"].exists)
        XCTAssertTrue(app.buttons["review.open"].isHittable)
    }

    @MainActor
    func testNewPlanSessionNavigatesAfterSheetDismissal() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        let compose = app.buttons["inbox.compose"]
        XCTAssertTrue(compose.waitForExistence(timeout: 5))
        compose.tap()
        let start = app.buttons["new-session.start"]
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        XCTAssertFalse(start.isEnabled)
        let prompt = app.descendants(matching: .any).matching(identifier: "new-session.prompt").firstMatch
        prompt.tap()
        prompt.typeText("Plan a small test change")
        let plan = app.segmentedControls.buttons["Plan"]
        for _ in 0..<3 where !plan.isHittable { app.swipeUp() }
        plan.tap()
        XCTAssertTrue(app.staticTexts["Think it through."].exists)
        XCTAssertTrue(start.isEnabled)
        start.tap()
        XCTAssertTrue(app.buttons["review.open"].waitForExistence(timeout: 5))
        XCTAssertFalse(start.exists)
        XCTAssertTrue(app.buttons["composer.stop"].waitForExistence(timeout: 5))
        app.buttons["composer.stop"].tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(compose.waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == %@", "Plan a small test change")).count, 1)
    }

}
