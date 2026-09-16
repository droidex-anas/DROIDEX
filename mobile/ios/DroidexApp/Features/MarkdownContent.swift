import DroidexCore
import Observation
import SwiftUI
import UIKit

@MainActor @Observable
private final class MarkdownRendering {
    var blocks: [MarkdownBlock] = []
    @ObservationIgnored private var latest = ""
    @ObservationIgnored private var revision = 0
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var task: Task<Void, Never>?

    func update(_ source: String) {
        latest = source
        revision += 1
        guard task == nil else { return }
        let token = generation
        task = Task {
            while !Task.isCancelled && token == generation {
                let expected = revision
                let parsed = await MarkdownWorker.shared.parse(latest)
                guard !Task.isCancelled, token == generation else { return }
                blocks = parsed
                if expected == revision { task = nil; return }
                // Coalesce an arriving token burst without postponing rendering indefinitely.
                do { try await Task.sleep(for: .milliseconds(60)) } catch { return }
            }
        }
    }

    func cancel() { generation += 1; task?.cancel(); task = nil }
}

struct MarkdownContent: View {
    let text: String
    @State private var rendering = MarkdownRendering()
    init(source: String) { self.text = source }

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 14) {
            ForEach(rendering.blocks) { block in MarkdownBlockView(block: block).equatable() }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { rendering.update(text) }
        .onChange(of: text) { _, value in rendering.update(value) }
        .onDisappear { rendering.cancel() }
        .environment(\.openURL, OpenURLAction { url in
            guard ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") else { return .discarded }
            return .systemAction
        })
    }
}

private struct MarkdownBlockView: View, Equatable {
    let block: MarkdownBlock

    var body: some View {
        switch block.kind {
        case .paragraph: InlineMarkdown(text: block.text)
        case .heading(let level):
            InlineMarkdown(text: block.text)
                .font(level <= 2 ? .title3.weight(.semibold) : .headline)
                .padding(.top, level == 1 ? 8 : 3)
                .accessibilityAddTraits(.isHeader)
        case .code(let language): CodeBlock(text: block.text, language: language)
        case .quote:
            HStack(alignment: .top, spacing: 12) {
                Rectangle().fill(DroidTheme.separator).frame(width: 2)
                InlineMarkdown(text: block.text).foregroundStyle(DroidTheme.secondary)
            }.fixedSize(horizontal: false, vertical: true)
        case .list(let marker, let depth):
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(marker).font(.callout).foregroundStyle(DroidTheme.secondary)
                    .frame(minWidth: 14, alignment: .trailing)
                InlineMarkdown(text: block.text)
            }.padding(.leading, CGFloat(min(depth, 6)) * 14)
        case .rule: Divider().overlay(DroidTheme.separator)
        case .table(let rows): MarkdownTable(rows: rows)
        }
    }
}

private struct InlineMarkdown: View {
    let text: String
    private var attributed: AttributedString {
        var value = (try? AttributedString(markdown: text, options: .init(
            interpretedSyntax: .inlineOnlyPreservingWhitespace, failurePolicy: .returnPartiallyParsedIfPossible
        ))) ?? AttributedString(text)
        for run in value.runs {
            if run.inlinePresentationIntent?.contains(.code) == true {
                value[run.range].font = .system(.callout, design: .monospaced)
                value[run.range].backgroundColor = DroidTheme.elevated
            }
            if let url = run.link, !["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") {
                value[run.range].link = nil
            }
        }
        return value
    }
    var body: some View {
        Text(attributed).lineSpacing(4).textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private struct CodeBlock: View {
    let text: String
    let language: String
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language.isEmpty ? "Code" : language).font(.caption.weight(.medium))
                Spacer()
                Button(copied ? "Copied" : "Copy") { UIPasteboard.general.string = text; copied = true }
                    .font(.caption.weight(.medium)).buttonStyle(.plain).frame(minWidth: 44, minHeight: 36)
                    .accessibilityLabel("Copy code")
            }.foregroundStyle(DroidTheme.secondary).padding(.horizontal, 14)
            Divider().overlay(DroidTheme.separator)
            ScrollView(.horizontal) {
                Text(verbatim: text.isEmpty ? " " : text)
                    .font(.system(.callout, design: .monospaced)).lineSpacing(4)
                    .textSelection(.enabled).fixedSize(horizontal: true, vertical: true).padding(14)
            }
        }
        .background(DroidTheme.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(DroidTheme.separator.opacity(0.65)))
        .onChange(of: text) { _, _ in copied = false }
        .task(id: copied) {
            guard copied else { return }
            do { try await Task.sleep(for: .seconds(2)); copied = false } catch { }
        }
    }
}

private struct MarkdownTable: View {
    let rows: [[String]]
    var body: some View {
        ScrollView(.horizontal) {
            Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 10) {
                ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                    GridRow(alignment: .top) {
                        ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                            InlineMarkdown(text: cell).font(index == 0 ? .subheadline.weight(.semibold) : .subheadline)
                                .frame(minWidth: 70, maxWidth: 240, alignment: .leading)
                        }
                    }
                    if index == 0 { Divider().gridCellUnsizedAxes(.horizontal) }
                }
            }.padding(14)
        }
        .background(DroidTheme.surface, in: RoundedRectangle(cornerRadius: 12))
        .accessibilityLabel("Table. Scroll horizontally for more columns.")
    }
}
