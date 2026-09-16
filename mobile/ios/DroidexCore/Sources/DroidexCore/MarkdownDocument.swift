import Foundation

public struct MarkdownBlock: Equatable, Identifiable, Sendable {
    public enum Kind: Equatable, Sendable {
        case paragraph, heading(Int), code(String), quote, list(String, Int), rule
        case table([[String]])
    }
    public let id: Int
    public let kind: Kind
    public let text: String
}

/// The supported block subset is explicit; inline syntax is rendered by Foundation on iOS.
public enum MarkdownDocument {
    public static func parse(_ source: String) -> [MarkdownBlock] {
        let lines = source.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var blocks: [MarkdownBlock] = []
        var index = 0
        func append(_ start: Int, _ kind: MarkdownBlock.Kind, _ body: [String]) {
            blocks.append(MarkdownBlock(id: start, kind: kind, text: body.joined(separator: "\n")))
        }
        while index < lines.count {
            let start = index
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty { index += 1; continue }
            if let fence = openingFence(trimmed) {
                index += 1
                var body: [String] = []
                while index < lines.count {
                    let candidate = lines[index].trimmingCharacters(in: .whitespaces)
                    if candidate.count >= fence.count && candidate.allSatisfy({ $0 == fence.character }) {
                        index += 1
                        break
                    }
                    body.append(lines[index]); index += 1
                }
                // An unclosed fence remains a code block while tokens are arriving.
                if body.last == "" { body.removeLast() }
                append(start, .code(fence.language), body)
                continue
            }
            if let level = headingLevel(trimmed) {
                append(start, .heading(level), [String(trimmed.dropFirst(level + 1))])
                index += 1; continue
            }
            if isRule(trimmed) { append(start, .rule, []); index += 1; continue }
            if trimmed.hasPrefix(">") {
                var body: [String] = []
                while index < lines.count {
                    let value = lines[index].trimmingCharacters(in: .whitespaces)
                    guard value.hasPrefix(">") else { break }
                    body.append(String(value.dropFirst()).trimmingCharacters(in: .whitespaces)); index += 1
                }
                append(start, .quote, body); continue
            }
            if index + 1 < lines.count, line.contains("|"), isTableDelimiter(lines[index + 1]) {
                var rows = [tableCells(line)]
                index += 2
                while index < lines.count, lines[index].contains("|"), !lines[index].isEmpty {
                    rows.append(tableCells(lines[index])); index += 1
                }
                append(start, .table(rows), []); continue
            }
            if let item = listItem(line) {
                append(start, .list(item.marker, item.depth), [item.text]); index += 1; continue
            }
            var body = [line]
            index += 1
            while index < lines.count {
                let next = lines[index].trimmingCharacters(in: .whitespaces)
                if next.isEmpty || openingFence(next) != nil || headingLevel(next) != nil || isRule(next)
                    || next.hasPrefix(">") || listItem(lines[index]) != nil { break }
                if index + 1 < lines.count, next.contains("|"), isTableDelimiter(lines[index + 1]) { break }
                body.append(lines[index]); index += 1
            }
            append(start, .paragraph, body)
        }
        return blocks
    }

    private static func openingFence(_ text: String) -> (character: Character, count: Int, language: String)? {
        guard let first = text.first, first == "`" || first == "~" else { return nil }
        let count = text.prefix(while: { $0 == first }).count
        guard count >= 3 else { return nil }
        let language = String(text.dropFirst(count)).trimmingCharacters(in: .whitespaces)
        guard first != "`" || !language.contains("`") else { return nil }
        return (first, count, String(language.prefix(40)))
    }

    private static func headingLevel(_ text: String) -> Int? {
        let count = text.prefix(while: { $0 == "#" }).count
        guard (1...6).contains(count), text.dropFirst(count).first == " " else { return nil }
        return count
    }

    private static func isRule(_ text: String) -> Bool {
        let value = text.filter { !$0.isWhitespace }
        guard value.count >= 3, let first = value.first, "-*_".contains(first) else { return false }
        return value.allSatisfy { $0 == first }
    }

    private static func listItem(_ text: String) -> (marker: String, depth: Int, text: String)? {
        let indent = text.prefix(while: { $0 == " " }).count
        let value = String(text.dropFirst(indent))
        if value.hasPrefix("- ") || value.hasPrefix("* ") || value.hasPrefix("+ ") {
            let body = String(value.dropFirst(2))
            if body.hasPrefix("[ ] ") { return ("☐", indent / 2, String(body.dropFirst(4))) }
            if body.lowercased().hasPrefix("[x] ") { return ("☑", indent / 2, String(body.dropFirst(4))) }
            return ("•", indent / 2, body)
        }
        let digits = value.prefix(while: { $0.isNumber && $0.isASCII })
        let rest = value.dropFirst(digits.count)
        guard !digits.isEmpty, digits.count <= 9, rest.hasPrefix(". ") || rest.hasPrefix(") ") else { return nil }
        return (String(digits) + ".", indent / 2, String(rest.dropFirst(2)))
    }

    private static func isTableDelimiter(_ text: String) -> Bool {
        let cells = tableCells(text)
        return !cells.isEmpty && cells.allSatisfy { cell in
            let value = cell.trimmingCharacters(in: CharacterSet(charactersIn: ": "))
            return value.count >= 3 && value.allSatisfy { $0 == "-" }
        }
    }

    private static func tableCells(_ text: String) -> [String] {
        var value = text.trimmingCharacters(in: .whitespaces)
        if value.hasPrefix("|") { value.removeFirst() }
        if value.hasSuffix("|") && !value.hasSuffix("\\|") { value.removeLast() }
        var cells: [String] = [], cell = "", escaped = false, inCode = false
        for character in value {
            if escaped { cell.append(character); escaped = false; continue }
            if character == "\\" { escaped = true; continue }
            if character == "`" { inCode.toggle() }
            if character == "|" && !inCode { cells.append(cell.trimmingCharacters(in: .whitespaces)); cell = "" }
            else { cell.append(character) }
        }
        if escaped { cell.append("\\") }
        cells.append(cell.trimmingCharacters(in: .whitespaces))
        return cells
    }
}

public actor MarkdownWorker {
    public static let shared = MarkdownWorker()
    public func parse(_ source: String) -> [MarkdownBlock] { MarkdownDocument.parse(source) }
}
