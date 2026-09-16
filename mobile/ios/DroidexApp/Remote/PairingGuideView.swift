import SwiftUI
import WebKit

struct PairingGuideView: View {
    @Environment(\.dismiss) private var dismiss
    private let guideURL = RemoteArtworkResources.url("droidex-pairing-guide", extension: "svg")

    var body: some View {
        NavigationStack {
            Group {
                if let guideURL {
                    BundledPairingGuide(url: guideURL)
                } else {
                    ContentUnavailableView("Guide unavailable", systemImage: "doc",
                                           description: Text("Rebuild the app with its RemoteArtwork resources."))
                }
            }
            .background(DroidTheme.background)
            .navigationTitle("Pairing guide")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                if let guideURL {
                    ToolbarItem(placement: .primaryAction) {
                        ShareLink(item: guideURL) { Text("Share SVG") }
                            .accessibilityIdentifier("remote.share-guide")
                    }
                }
            }
        }
    }
}

private struct BundledPairingGuide: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .clear
        if let svg = try? String(contentsOf: url, encoding: .utf8) {
            let html = """
            <!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'">
            <style>html,body{margin:0;background:#0b0c0e}svg{display:block;width:100%;height:auto}</style>
            </head><body>\(svg)</body></html>
            """
            view.loadHTMLString(html, baseURL: nil)
        }
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}
}
