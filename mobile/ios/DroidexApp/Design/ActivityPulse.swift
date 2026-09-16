import SwiftUI

struct ActivityPulse: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        if reduceMotion || scenePhase != .active {
            Circle().fill(DroidTheme.secondary).frame(width: 5, height: 5)
        } else {
            ProgressView().controlSize(.mini).frame(width: 12, height: 12).accessibilityLabel("Working")
        }
    }
}
