import DroidexCore
import SwiftUI

struct ComposerView: View {
    @AppStorage("hapticsEnabled") private var hapticsEnabled = true
    @Binding var text: String
    @Binding var configuration: SessionConfiguration
    let phase: SessionPhase
    let send: () -> Void
    let stop: () -> Void

    @State private var showsReasoning = false

    private var canSubmit: Bool {
        phase.canSend && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && text.trimmingCharacters(in: .whitespacesAndNewlines).count <= SessionStore.promptLimit
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 10) {
                TextField("Follow up…", text: $text, axis: .vertical)
                    .font(.body)
                    .lineLimit(1...5)
                    .frame(minHeight: 44)
                    .textInputAutocapitalization(.sentences)
                    .disabled(phase.approval != nil)
                    .accessibilityLabel("Message")
                    .accessibilityIdentifier("composer.input")

                HStack(spacing: 4) {
                    Menu {
                        ForEach(Harness.allCases, id: \.self) { harness in
                            Button {
                                configuration.harness = harness
                                let options = ModelChoice.options(for: harness)
                                if !options.contains(configuration.model) { configuration.model = options[0] }
                            } label: {
                                if configuration.harness == harness {
                                    Label(harness.rawValue, systemImage: "checkmark")
                                } else {
                                    Text(harness.rawValue)
                                }
                            }
                        }
                    } label: {
                        ConfigLabel(configuration.harness.rawValue, icon: "terminal")
                    }

                    Menu {
                        ForEach(ModelChoice.options(for: configuration.harness), id: \.self) { model in
                            Button { configuration.model = model } label: {
                                if configuration.model == model {
                                    Label(model.rawValue, systemImage: "checkmark")
                                } else {
                                    Text(model.rawValue)
                                }
                            }
                        }
                    } label: {
                        ConfigLabel(configuration.model.rawValue, icon: "cpu")
                    }

                    Button { showsReasoning = true } label: {
                        ConfigLabel(configuration.reasoning.title, icon: "sparkles")
                    }
                    .buttonStyle(.plain)
                    .popover(isPresented: $showsReasoning, arrowEdge: .bottom) {
                        ReasoningPicker(configuration: $configuration)
                            .presentationCompactAdaptation(.popover)
                    }

                    Spacer(minLength: 4)

                    Button {
                        if phase.isRunning { stop() } else { send() }
                    } label: {
                        Image(systemName: phase.isRunning ? "stop.fill" : "arrow.up")
                            .font(.body.weight(.semibold))
                            .frame(width: 42, height: 42)
                            .foregroundStyle(DroidTheme.background)
                            .background(canSubmit || phase.isRunning ? DroidTheme.text : DroidTheme.secondary, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!phase.isRunning && !canSubmit)
                    .accessibilityLabel(phase.isRunning ? "Stop response" : "Send message")
                    .accessibilityIdentifier(phase.isRunning ? "composer.stop" : "composer.send")
                }

                HStack(spacing: 8) {
                    Picker("Mode", selection: $configuration.interactionMode) {
                        ForEach(InteractionMode.allCases, id: \.self) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 180)
                    Spacer()
                    Text("Preview")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(DroidTheme.secondary)
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 10)
            .modifier(GlassChrome())

            if text.count > SessionStore.promptLimit {
                Text("Keep your message under \(SessionStore.promptLimit.formatted()) characters.")
                    .font(.footnote).foregroundStyle(DroidTheme.danger).padding(.horizontal, 8)
            } else if phase.approval != nil {
                Text("Review the pending action before sending another message.")
                    .font(.footnote).foregroundStyle(DroidTheme.secondary).padding(.horizontal, 8)
            }
        }
        .sensoryFeedback(.selection, trigger: configuration) { _, _ in hapticsEnabled }
    }
}

private struct ConfigLabel: View {
    let title: String
    let icon: String

    init(_ title: String, icon: String) {
        self.title = title
        self.icon = icon
    }

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.caption2)
            Text(title).lineLimit(1)
            Image(systemName: "chevron.down").font(.system(size: 8, weight: .semibold))
        }
        .font(.caption.weight(.medium))
        .foregroundStyle(DroidTheme.text)
        .padding(.horizontal, 8)
        .frame(height: 36)
        .contentShape(Rectangle())
    }
}

private struct ReasoningPicker: View {
    @Binding var configuration: SessionConfiguration

    private var effort: Binding<Double> {
        Binding(
            get: { Double(configuration.reasoning.rawValue) },
            set: { configuration.reasoning = ReasoningEffort(rawValue: Int($0.rounded())) ?? .high }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Reasoning")
                    .font(.headline)
                Text(configuration.reasoning.title)
                    .font(.subheadline)
                    .foregroundStyle(DroidTheme.secondary)
            }

            Slider(value: effort, in: 0...3, step: 1)
                .tint(DroidTheme.text)
                .accessibilityLabel("Reasoning effort")
                .accessibilityValue(configuration.reasoning.title)

            HStack {
                Text("Faster")
                Spacer()
                Text("Smarter")
            }
            .font(.caption)
            .foregroundStyle(DroidTheme.secondary)

            Divider().overlay(DroidTheme.border)

            HStack(spacing: 10) {
                Image(systemName: "cpu")
                    .foregroundStyle(DroidTheme.secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(configuration.model.rawValue)
                        .font(.subheadline.weight(.medium))
                    Text("Reasoning is saved with this session")
                        .font(.caption)
                        .foregroundStyle(DroidTheme.secondary)
                }
            }
        }
        .padding(20)
        .frame(width: 300)
        .presentationBackground(.regularMaterial)
    }
}
