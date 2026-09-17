import DroidexCore
import SwiftUI

struct SettingsView: View {
    @Environment(SessionStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @AppStorage("appearance") private var appearance = "system"
    @AppStorage("hapticsEnabled") private var hapticsEnabled = true

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    BrandMark().frame(width: 146, height: 20).padding(.vertical, 12)
                    LabeledContent("Build", value: "Remote checkpoint · 0.4")
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
                Section("Connection") {
                    NavigationLink {
                        RemoteSettingsView()
                    } label: {
                        HStack {
                            Text("Remote")
                            Spacer()
                            Text(store.isConnected ? "Connected" : "Offline")
                                .foregroundStyle(DroidTheme.secondary)
                        }
                        .frame(minHeight: 44)
                    }
                    .accessibilityIdentifier("settings.remote")
                }
            }
            .scrollContentBackground(.hidden)
            .background(DroidTheme.background)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}
