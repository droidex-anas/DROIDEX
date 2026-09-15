import DroidexCore
import SwiftUI

struct ComposerView: View {
    @AppStorage("hapticsEnabled") private var hapticsEnabled = true
    @Binding var text: String
    @Binding var configuration: SessionConfiguration
    let phase: SessionPhase
    let send: () -> Void
    let stop: () -> Void

    private var canSubmit: Bool {
        phase.canSend && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && text.trimmingCharacters(in: .whitespacesAndNewlines).count <= SessionStore.promptLimit
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Menu {
                        Picker("Harness preview", selection: $configuration.harness) {
                            ForEach(Harness.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                        }
                        Picker("Interaction mode", selection: $configuration.interactionMode) {
                            ForEach(InteractionMode.allCases, id: \.self) { Text($0.title).tag($0) }
                        }
                        Text("Scripted previews only. No provider is connected.")
                    } label: {
                        HStack(spacing: 5) {
                            Text(configuration.harness.rawValue)
                            Text("·")
                            Text(configuration.interactionMode.title)
                            Image(systemName: "chevron.down").font(.caption2)
                        }
                        .font(.caption.weight(.medium))
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .disabled(!phase.canSend)
                    .accessibilityLabel("Session configuration")
                    Spacer(minLength: 8)
                    Text("Local preview").font(.caption2).foregroundStyle(DroidTheme.secondary)
                }
                HStack(alignment: .bottom, spacing: 10) {
                    TextField("Follow up…", text: $text, axis: .vertical)
                        .font(.body)
                        .lineLimit(1...5)
                        .frame(minHeight: 44)
                        .textInputAutocapitalization(.sentences)
                        .disabled(phase.approval != nil)
                        .accessibilityLabel("Message")
                        .accessibilityIdentifier("composer.input")
                    Button {
                        if phase.isRunning { stop() } else { send() }
                    } label: {
                        Image(systemName: phase.isRunning ? "stop.fill" : "arrow.up")
                            .font(.body.weight(.semibold))
                            .frame(width: 44, height: 44)
                            .foregroundStyle(DroidTheme.background)
                            .background(canSubmit || phase.isRunning ? DroidTheme.text : DroidTheme.secondary, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!phase.isRunning && !canSubmit)
                    .accessibilityLabel(phase.isRunning ? "Stop response" : "Send message")
                    .accessibilityIdentifier(phase.isRunning ? "composer.stop" : "composer.send")
                    .keyboardShortcut(.return, modifiers: .command)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 12)
            .modifier(GlassChrome())
            if text.count > SessionStore.promptLimit {
                Text("Keep your message under \(SessionStore.promptLimit.formatted()) characters.")
                    .font(.footnote).foregroundStyle(DroidTheme.danger)
                    .padding(.horizontal, 8)
            } else if phase.approval != nil {
                Text("Review the pending action before sending another message.")
                    .font(.footnote).foregroundStyle(DroidTheme.secondary)
                    .padding(.horizontal, 8)
            }
        }
        .sensoryFeedback(.selection, trigger: configuration) { _, _ in hapticsEnabled }
    }
}
