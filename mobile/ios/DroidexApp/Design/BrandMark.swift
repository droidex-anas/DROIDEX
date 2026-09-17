import SwiftUI

// Fixed wordmark outlined from Silkscreen Regular (m01), Jason Kottke.
// googlefonts/silkscreen sources/Silkscreen.glyphs, blob 2d1301c6c8f429ac5999e54de786378bf5c3620f.
// Original glyph advances and desktop -0.04em tracking; no substitute pixel alphabet.
struct BrandMark: View {
    var body: some View {
        WordmarkShape().fill(style: FillStyle(eoFill: true))
            .aspectRatio(4385.0 / 625, contentMode: .fit)
            .accessibilityLabel("DROIDEX")
    }
}

private struct WordmarkShape: Shape {
    private static let outline: Path = {
        let contours: [[CGPoint]] = [
        [CGPoint(x: 375, y: 625), CGPoint(x: 375, y: 500), CGPoint(x: 500, y: 500), CGPoint(x: 500, y: 125), CGPoint(x: 375, y: 125), CGPoint(x: 375, y: 0), CGPoint(x: 0, y: 0), CGPoint(x: 0, y: 625)],
        [CGPoint(x: 125, y: 125), CGPoint(x: 370, y: 125), CGPoint(x: 370, y: 500), CGPoint(x: 125, y: 500)],
        [CGPoint(x: 835, y: 625), CGPoint(x: 835, y: 375), CGPoint(x: 960, y: 375), CGPoint(x: 960, y: 500), CGPoint(x: 1085, y: 500), CGPoint(x: 1085, y: 625), CGPoint(x: 1210, y: 625), CGPoint(x: 1210, y: 500), CGPoint(x: 1085, y: 500), CGPoint(x: 1085, y: 250), CGPoint(x: 1210, y: 250), CGPoint(x: 1210, y: 125), CGPoint(x: 1085, y: 125), CGPoint(x: 1085, y: 0), CGPoint(x: 710, y: 0), CGPoint(x: 710, y: 625)],
        [CGPoint(x: 835, y: 125), CGPoint(x: 1080, y: 125), CGPoint(x: 1080, y: 250), CGPoint(x: 835, y: 250)],
        [CGPoint(x: 1795, y: 625), CGPoint(x: 1795, y: 500), CGPoint(x: 1920, y: 500), CGPoint(x: 1920, y: 125), CGPoint(x: 1795, y: 125), CGPoint(x: 1795, y: 0), CGPoint(x: 1545, y: 0), CGPoint(x: 1545, y: 125), CGPoint(x: 1420, y: 125), CGPoint(x: 1420, y: 500), CGPoint(x: 1545, y: 500), CGPoint(x: 1545, y: 625)],
        [CGPoint(x: 1545, y: 130), CGPoint(x: 1795, y: 130), CGPoint(x: 1795, y: 495), CGPoint(x: 1545, y: 495)],
        [CGPoint(x: 2255, y: 625), CGPoint(x: 2255, y: 0), CGPoint(x: 2130, y: 0), CGPoint(x: 2130, y: 625)],
        [CGPoint(x: 2840, y: 625), CGPoint(x: 2840, y: 500), CGPoint(x: 2965, y: 500), CGPoint(x: 2965, y: 125), CGPoint(x: 2840, y: 125), CGPoint(x: 2840, y: 0), CGPoint(x: 2465, y: 0), CGPoint(x: 2465, y: 625)],
        [CGPoint(x: 2590, y: 125), CGPoint(x: 2835, y: 125), CGPoint(x: 2835, y: 500), CGPoint(x: 2590, y: 500)],
        [CGPoint(x: 3550, y: 625), CGPoint(x: 3550, y: 500), CGPoint(x: 3300, y: 500), CGPoint(x: 3300, y: 375), CGPoint(x: 3550, y: 375), CGPoint(x: 3550, y: 250), CGPoint(x: 3300, y: 250), CGPoint(x: 3300, y: 125), CGPoint(x: 3550, y: 125), CGPoint(x: 3550, y: 0), CGPoint(x: 3175, y: 0), CGPoint(x: 3175, y: 625)],
        [CGPoint(x: 4385, y: 625), CGPoint(x: 4385, y: 500), CGPoint(x: 4260, y: 500), CGPoint(x: 4260, y: 375), CGPoint(x: 4135, y: 375), CGPoint(x: 4135, y: 250), CGPoint(x: 4010, y: 250), CGPoint(x: 4010, y: 125), CGPoint(x: 3885, y: 125), CGPoint(x: 3885, y: 0), CGPoint(x: 3760, y: 0), CGPoint(x: 3760, y: 125), CGPoint(x: 3885, y: 125), CGPoint(x: 3885, y: 250), CGPoint(x: 4010, y: 250), CGPoint(x: 4010, y: 375), CGPoint(x: 4135, y: 375), CGPoint(x: 4135, y: 500), CGPoint(x: 4260, y: 500), CGPoint(x: 4260, y: 625)],
        [CGPoint(x: 3885, y: 625), CGPoint(x: 3885, y: 500), CGPoint(x: 3760, y: 500), CGPoint(x: 3760, y: 625)],
        [CGPoint(x: 4010, y: 500), CGPoint(x: 4010, y: 375), CGPoint(x: 3885, y: 375), CGPoint(x: 3885, y: 500)],
        [CGPoint(x: 4260, y: 250), CGPoint(x: 4260, y: 125), CGPoint(x: 4385, y: 125), CGPoint(x: 4385, y: 0), CGPoint(x: 4260, y: 0), CGPoint(x: 4260, y: 125), CGPoint(x: 4135, y: 125), CGPoint(x: 4135, y: 250)]
        ]
        return Path { path in
            for contour in contours {
                guard let first = contour.first else { continue }
                path.move(to: first)
                for point in contour.dropFirst() { path.addLine(to: point) }
                path.closeSubpath()
            }
        }
    }()

    func path(in rect: CGRect) -> Path {
        Self.outline.applying(CGAffineTransform(scaleX: rect.width / 4385, y: rect.height / 625)
            .concatenating(CGAffineTransform(translationX: rect.minX, y: rect.minY)))
    }
}
