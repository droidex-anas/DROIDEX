import SwiftUI
import WebKit

/// A bundled vector illustration, not a second connection or a web application.
/// The web view receives only presentation state; all controls stay native.
enum PairingArtworkPhase: String {
    case intro, scan, verifying, approval, syncing, connected, running, offline, error
}

struct PairingArtwork: View {
    let phase: PairingArtworkPhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false

    var body: some View {
        PairingArtworkSurface(phase: phase, reduced: reduceMotion,
                              active: visible && scenePhase == .active)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .onAppear { visible = true }
            .onDisappear { visible = false }
    }
}

private struct PairingArtworkSurface: UIViewRepresentable {
    let phase: PairingArtworkPhase
    let reduced: Bool
    let active: Bool

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        view.isUserInteractionEnabled = false
        view.accessibilityElementsHidden = true
        view.navigationDelegate = context.coordinator
        context.coordinator.view = view
        if let url = RemoteArtworkResources.url("droidex-artwork", extension: "html"),
           let html = try? String(contentsOf: url, encoding: .utf8) {
            // The document is self-contained with a hash-locked script CSP.
            // No file-system read access or network origin is granted.
            view.loadHTMLString(html, baseURL: nil)
        }
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.update(phase: phase, reduced: reduced, active: active)
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        coordinator.ready = false
        view.evaluateJavaScript("window.DroidexNativeArtwork?.destroy()", completionHandler: nil)
        view.stopLoading()
        view.navigationDelegate = nil
        coordinator.view = nil
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        weak var view: WKWebView?
        var ready = false
        private var desired = ""
        private var sent = ""

        func update(phase: PairingArtworkPhase, reduced: Bool, active: Bool) {
            desired = "{phase:'\(phase.rawValue)',reducedMotion:\(reduced),active:\(active)}"
            sendIfReady()
        }

        private func sendIfReady() {
            guard ready, !desired.isEmpty, desired != sent else { return }
            sent = desired
            view?.evaluateJavaScript("window.DroidexNativeArtwork?.update(\(desired))", completionHandler: nil)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            ready = true
            sent = ""
            sendIfReady()
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            decisionHandler(action.request.url?.absoluteString == "about:blank" ? .allow : .cancel)
        }
    }
}

enum RemoteArtworkResources {
    static func url(_ name: String, extension ext: String) -> URL? {
        // Synchronized Xcode groups can flatten individual resources; explicit
        // folder references preserve this directory instead.
        Bundle.main.url(forResource: name, withExtension: ext)
            ?? Bundle.main.url(forResource: name, withExtension: ext, subdirectory: "RemoteArtwork")
            ?? Bundle.main.url(forResource: name, withExtension: ext, subdirectory: "Resources/RemoteArtwork")
    }
}
