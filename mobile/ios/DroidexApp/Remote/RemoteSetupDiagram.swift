import SwiftUI

/// A diagram of the real Settings route, not a simulated connection or device render.
struct RemoteSetupDiagram: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                BrandMark().frame(width: 84, height: 12)
                Spacer()
                Text("On your computer").font(.caption).foregroundStyle(DroidTheme.secondary)
            }
            .padding(18)
            Divider().overlay(DroidTheme.separator)
            HStack(alignment: .top, spacing: 24) {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Settings").font(.caption.weight(.semibold))
                    Text("General").foregroundStyle(DroidTheme.secondary)
                    Text("Appearance").foregroundStyle(DroidTheme.secondary)
                    Text("Remote").fontWeight(.semibold)
                        .padding(.horizontal, 10).padding(.vertical, 7)
                        .background(DroidTheme.elevated, in: RoundedRectangle(cornerRadius: 8))
                }
                .font(.caption)
                Divider()
                VStack(alignment: .leading, spacing: 10) {
                    Text("Share a project").font(.subheadline.weight(.semibold))
                    Text("Choose the folder you want to work on from your phone.")
                        .font(.caption).foregroundStyle(DroidTheme.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Create pairing QR").font(.caption.weight(.semibold))
                        .padding(.vertical, 9).padding(.horizontal, 12)
                        .foregroundStyle(DroidTheme.background)
                        .background(DroidTheme.text, in: RoundedRectangle(cornerRadius: 9))
                }
            }
            .padding(18).fixedSize(horizontal: false, vertical: true)
        }
        .background(DroidTheme.surface, in: RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(DroidTheme.separator))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("On your computer: DROIDEX, Settings, Remote, share a project, Create pairing QR.")
        .allowsHitTesting(false)
    }
}
