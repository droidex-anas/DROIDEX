import DroidexCore
import SwiftUI
import UIKit

struct OnboardingView: View {
    @Environment(AppConnection.self) private var connection
    @State private var showPairing: Bool
    @State private var showGuide = false
    let allowsPreview: Bool

    init(startAtPairing: Bool = false, allowsPreview: Bool = true) {
        _showPairing = State(initialValue: startAtPairing)
        self.allowsPreview = allowsPreview
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    BrandMark().frame(width: 110, height: 16).padding(.top, 22)
                    PairingArtwork(phase: .intro).frame(height: 190).allowsHitTesting(false)
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Pick up where\nyou left off.")
                            .font(.largeTitle.weight(.semibold)).tracking(-1.1)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("The same projects. The same agents.\nNow from your phone.")
                            .font(.body).lineSpacing(4).foregroundStyle(DroidTheme.secondary)
                    }
                    Divider().overlay(DroidTheme.separator)
                    HStack(alignment: .top, spacing: 14) {
                        Text("01").font(.caption).monospacedDigit().foregroundStyle(DroidTheme.secondary).padding(.top, 4)
                        VStack(alignment: .leading, spacing: 7) {
                            Text("Start on your computer").font(.subheadline.weight(.semibold))
                            Text("Open DROIDEX → Settings → Remote. Share a project, then scan its QR here.")
                                .font(.subheadline).foregroundStyle(DroidTheme.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Button("See the pairing guide") { showGuide = true }.font(.subheadline).frame(minHeight: 44)
                    Text("Same trusted Wi-Fi. Your computer stays awake and keeps your provider credentials.")
                        .font(.footnote).foregroundStyle(DroidTheme.secondary)
                    if let error = connection.error { Text(error).font(.callout).foregroundStyle(DroidTheme.danger) }
                }
                .frame(maxWidth: 520).padding(.horizontal, 28).padding(.bottom, 24).frame(maxWidth: .infinity)
            }
            .background(DroidTheme.background)
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 6) {
                    Button { showPairing = true } label: {
                        Text("Add computer").font(.body.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 54)
                            .foregroundStyle(DroidTheme.background).background(DroidTheme.text, in: Capsule())
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain).accessibilityIdentifier("pairing.add-computer")
                    if allowsPreview {
                        Button("Explore offline preview") { connection.preview() }
                            .font(.footnote).foregroundStyle(DroidTheme.secondary).frame(minHeight: 44)
                    }
                }.frame(maxWidth: 520).padding(.horizontal, 28).padding(.top, 12).padding(.bottom, 6)
                    .frame(maxWidth: .infinity).background(DroidTheme.background)
            }
            .navigationDestination(isPresented: $showPairing) { PairComputerView() }
            .sheet(isPresented: $showGuide) { PairingGuideView() }
        }
        .tint(DroidTheme.text)
        .foregroundStyle(DroidTheme.text)
    }
}

private struct PairComputerView: View {
    @Environment(AppConnection.self) private var connection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage("hapticsEnabled") private var hapticsEnabled = true
    @State private var code = ""
    @State private var scanner = false
    @State private var scannedCode: String?
    @State private var progress: String?
    @State private var error: String?
    @State private var task: Task<Void, Never>?
    @State private var generation = 0
    @State private var contacted = false
    @FocusState private var codeFocused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                PairingArtwork(phase: error != nil ? .error : progress == nil ? .scan : contacted ? .approval : .verifying)
                    .frame(height: 210)
                    .allowsHitTesting(false)
                Text(progress == nil ? "Connect your computer" : contacted ? "Confirm on your computer" : "Connecting securely")
                    .font(.title.weight(.semibold)).tracking(-0.6)
                Text("Open Settings → Remote in DROIDEX on your computer. Scan the QR or copy its pairing code.")
                    .font(.body).foregroundStyle(DroidTheme.secondary)
                if let progress {
                    HStack(alignment: .top, spacing: 14) {
                        ProgressView().padding(.top, 3)
                        VStack(alignment: .leading, spacing: 6) {
                            Text(progress).font(.headline)
                            Text(contacted ? "Choose Approve phone on the computer. Your sessions will appear next." : "Checking the computer and its certificate. No credentials are sent to a third party.")
                                .font(.subheadline).foregroundStyle(DroidTheme.secondary)
                        }
                    }
                    .padding(20).frame(maxWidth: .infinity, alignment: .leading)
                    .background(DroidTheme.surface, in: RoundedRectangle(cornerRadius: 20))
                    Button("Cancel pairing") { cancel() }
                        .frame(minHeight: 44).buttonStyle(.plain)
                } else {
                    Button { codeFocused = false; scanner = true } label: {
                        Text("Scan QR code")
                            .font(.body.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 54)
                            .foregroundStyle(DroidTheme.background)
                            .background(DroidTheme.text, in: Capsule())
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain).accessibilityIdentifier("pairing.scan")
                    HStack {
                        Text("Or use a pairing code").font(.subheadline.weight(.medium))
                        Spacer()
                        PasteButton(payloadType: String.self) { values in
                            guard let value = values.first else { return }
                            code = value
                            pair()
                        }
                        .labelStyle(.titleOnly)
                        .accessibilityIdentifier("pairing.paste")
                    }
                    TextField("Paste the code from your computer", text: $code, axis: .vertical)
                        .lineLimit(2...4).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .font(.subheadline).focused($codeFocused).privacySensitive()
                        .padding(16).background(DroidTheme.surface, in: RoundedRectangle(cornerRadius: 16))
                        .accessibilityIdentifier("pairing.code")
                    Button { pair() } label: {
                        Text("Connect with code").font(.body.weight(.medium))
                            .frame(maxWidth: .infinity, minHeight: 50)
                            .background(DroidTheme.elevated, in: Capsule()).contentShape(Capsule())
                    }
                    .buttonStyle(.plain).disabled(code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityIdentifier("pairing.connect")
                }
                if let error {
                    Text(error).font(.callout).foregroundStyle(DroidTheme.danger)
                        .accessibilityIdentifier("pairing.error")
                }
                Text("The QR expires after three minutes. Choose New code on the desktop when needed. The same code works for scanning and pasting.")
                    .font(.footnote).foregroundStyle(DroidTheme.secondary)
            }
            .padding(24).frame(maxWidth: 540).frame(maxWidth: .infinity)
        }
        .background(DroidTheme.background)
        .navigationTitle("Add computer").navigationBarTitleDisplayMode(.inline)
        .scrollDismissesKeyboard(.interactively)
        .sheet(isPresented: $scanner, onDismiss: {
            guard let scannedCode else { return }
            self.scannedCode = nil
            code = scannedCode
            pair()
        }) {
            PairingScanner { result in
                switch result {
                case .success(let value): scannedCode = value
                case .failure(let failure): error = failure.localizedDescription
                }
                scanner = false
            }
        }
        .sensoryFeedback(.selection, trigger: contacted) { _, value in hapticsEnabled && value }
        .onDisappear { task?.cancel() }
    }

    private func cancel() {
        generation += 1
        task?.cancel()
        progress = nil
        contacted = false
        error = "Pairing cancelled. Choose New code on your computer to try again."
    }

    private func pair() {
        guard progress == nil else { return }
        error = nil
        do {
            let parsed = try PairingCode.parse(code)
            codeFocused = false
            generation += 1
            let current = generation
            contacted = false
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { progress = "Contacting your computer…" }
            task = Task {
                do {
                    let credential = try await DesktopConnection.pair(code: parsed, name: UIDevice.current.name) { name in
                        guard current == generation, !Task.isCancelled else { return }
                        contacted = true
                        progress = "Waiting for approval on \(name)"
                    }
                    try Task.checkCancellation()
                    guard current == generation else { return }
                    progress = "Connected. Opening your workspace…"
                    try connection.connect(credential)
                } catch {
                    guard !Task.isCancelled, current == generation else { return }
                    self.error = error.localizedDescription + (error is RemoteFailure ? "" : " Check Wi-Fi, local-network permission, and the computer’s firewall.")
                    progress = nil
                }
            }
        } catch { self.error = error.localizedDescription }
    }
}
