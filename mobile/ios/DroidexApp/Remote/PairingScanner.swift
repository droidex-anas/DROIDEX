import AVFoundation
import DroidexCore
import SwiftUI
import UIKit
import VisionKit

struct PairingScanner: View {
    let completion: (Result<String, RemoteFailure>) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var authorized = false
    @State private var checking = true
    @State private var unavailable: String?

    var body: some View {
        NavigationStack {
            Group {
                if checking {
                    ProgressView("Opening camera")
                } else if authorized && DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                    ScannerCamera(completion: completion)
                        .overlay(alignment: .bottom) {
                            Text("Scan the QR in DROIDEX → Settings → Remote")
                                .font(.subheadline.weight(.medium)).multilineTextAlignment(.center)
                                .padding(18).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
                                .padding(24).allowsHitTesting(false)
                        }
                } else {
                    VStack(spacing: 18) {
                        Text("Use a pairing code instead").font(.title2.weight(.semibold))
                        Text(unavailable ?? "The QR scanner is unavailable on this device. Copy the pairing code on your computer, then use Paste.")
                            .foregroundStyle(.secondary).multilineTextAlignment(.center)
                        Button("Back to pairing") { dismiss() }.frame(minHeight: 44)
                        if !authorized, let url = URL(string: UIApplication.openSettingsURLString) {
                            Link("Camera permission settings", destination: url)
                        }
                    }.padding(28)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle("Scan pairing code").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task {
                guard DataScannerViewController.isSupported else { checking = false; return }
                switch AVCaptureDevice.authorizationStatus(for: .video) {
                case .authorized: authorized = true
                case .notDetermined: authorized = await AVCaptureDevice.requestAccess(for: .video)
                default: unavailable = "Camera access is off. Enable it in Settings, or go back and paste your code."
                }
                checking = false
            }
        }
    }
}

private struct ScannerCamera: UIViewControllerRepresentable {
    let completion: (Result<String, RemoteFailure>) -> Void
    func makeUIViewController(context: Context) -> PairingCameraController { PairingCameraController(completion: completion) }
    func updateUIViewController(_ controller: PairingCameraController, context: Context) {}
    static func dismantleUIViewController(_ controller: PairingCameraController, coordinator: ()) { controller.stop() }
}

@MainActor
private final class PairingCameraController: UIViewController, DataScannerViewControllerDelegate {
    private let scanner = DataScannerViewController(
        recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced,
        recognizesMultipleItems: false, isHighFrameRateTrackingEnabled: false,
        isPinchToZoomEnabled: true, isGuidanceEnabled: true, isHighlightingEnabled: true
    )
    private let completion: (Result<String, RemoteFailure>) -> Void
    private var delivered = false

    init(completion: @escaping (Result<String, RemoteFailure>) -> Void) {
        self.completion = completion
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { return nil }

    override func viewDidLoad() {
        super.viewDidLoad()
        scanner.delegate = self
        addChild(scanner)
        view.addSubview(scanner.view)
        scanner.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            scanner.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scanner.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scanner.view.topAnchor.constraint(equalTo: view.topAnchor),
            scanner.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        scanner.didMove(toParent: self)
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !delivered else { return }
        do { try scanner.startScanning() }
        catch { finish(.failure(RemoteFailure("The camera could not start. Use Paste to pair instead."))) }
    }
    override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); stop() }
    func stop() { scanner.stopScanning() }
    func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
        for item in addedItems { read(item) }
    }
    func dataScanner(_ dataScanner: DataScannerViewController, didTapOn item: RecognizedItem) { read(item) }
    func dataScanner(_ dataScanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) {
        finish(.failure(RemoteFailure("Camera scanning became unavailable. Use Paste to pair instead.")))
    }
    private func read(_ item: RecognizedItem) {
        guard case .barcode(let barcode) = item, let payload = barcode.payloadStringValue else { return }
        do { _ = try PairingCode.parse(payload); finish(.success(payload)) }
        catch { finish(.failure(RemoteFailure("That QR is not a valid DROIDEX pairing code. Scan the code shown in Settings → Remote."))) }
    }
    private func finish(_ result: Result<String, RemoteFailure>) {
        guard !delivered else { return }
        delivered = true
        stop()
        completion(result)
    }
}
