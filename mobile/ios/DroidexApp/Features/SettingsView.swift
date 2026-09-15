import DroidexCore
import SwiftUI

struct SettingsView: View {
    @Environment(SessionStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @AppStorage("appearance") private var appearance = "system"
    @AppStorage("hapticsEnabled") private var hapticsEnabled = true
    @State private var confirmReset = false
    let onReset: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    BrandMark().frame(width: 146, height: 20).padding(.vertical, 12)
                    LabeledContent("Build", value: "Native preview · 0.1")
                }
                Section {
                    Picker("Theme", selection: $appearance) {
                        Text("System").tag("system")
                        Text("Dark").tag("dark")
                        Text("Light").tag("light")
                    }
                    Toggle("Haptic feedback", isOn: $hapticsEnabled)
                } header: {
                    Text("Appearance")
                } footer: {
                    Text("Feedback is reserved for selections, sending, stopping, and results. Reduce Motion and Reduce Transparency follow your system settings.")
                }
                Section("Runtime") {
                    LabeledContent("Connection", value: "Offline preview")
                    Text("No accounts, API keys, network requests, or command execution. Conversations and drafts are saved locally. Leaving the app stops active preview runs.")
                        .font(.callout).foregroundStyle(DroidTheme.secondary)
                }
                Section {
                    Button("Reset local preview", role: .destructive) { confirmReset = true }
                } footer: {
                    Text("Replaces the conversations on this device with the bundled examples. Your desktop DROIDEX app and repository are untouched.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(DroidTheme.background)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .confirmationDialog("Replace all local preview conversations?", isPresented: $confirmReset, titleVisibility: .visible) {
                Button("Reset local preview", role: .destructive) {
                    Task {
                        await store.resetPreview()
                        onReset()
                        dismiss()
                    }
                }
            }
        }
    }
}
