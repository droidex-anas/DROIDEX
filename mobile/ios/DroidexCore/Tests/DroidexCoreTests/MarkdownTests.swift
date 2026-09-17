import Foundation
import Testing
@testable import DroidexCore

struct MarkdownTests {
    @Test func fencesStayCodeWhileStreamingAndDoNotParseTheirContents() {
        let source = "# Plan\n\n```swift\n# not a heading\nlet text = \"**literal**\"\n"
        let partial = MarkdownDocument.parse(source)
        #expect(partial.count == 2)
        #expect(partial[1].kind == .code("swift"))
        #expect(partial[1].text.contains("# not a heading"))
        let completed = MarkdownDocument.parse(source + "```\n\nDone.")
        #expect(completed[1].id == partial[1].id)
        #expect(completed[1].text == partial[1].text)
        #expect(completed.last?.kind == .paragraph)
    }

    @Test func listsQuotesAndTablesRemainDistinctBlocks() {
        let blocks = MarkdownDocument.parse("## Work\r\n\r\n- [x] Read\n  2. Write\n\n> A quote\n> More\n\n| File | Value |\n| --- | --- |\n| a \\| b | `x|y` |\n\n---")
        #expect(blocks.map(\.kind) == [.heading(2), .list("☑", 0), .list("2.", 1), .quote,
            .table([["File", "Value"], ["a | b", "`x|y`"]]), .rule])
        #expect(Set(blocks.map(\.id)).count == blocks.count)
    }

    @Test func appendingTokensDoesNotChangeCompletedBlockIdentity() {
        let prefix = "# Title\n\nParagraph **one**.\n\n"
        let before = MarkdownDocument.parse(prefix)
        for tail in ["N", "Next", "Next paragraph\n\n```", "Next paragraph\n\n```js\nconst value = 1;"] {
            #expect(Array(MarkdownDocument.parse(prefix + tail).prefix(2)) == before)
        }
    }

    @Test func largeDocumentParsesOffActorWithoutLosingUnicode() async {
        let source = String(repeating: "## Section\n\nمرحبا 🌿 **text**\n\n- A\n- B\n\n", count: 1_200)
        let parsed = await MarkdownWorker.shared.parse(source)
        #expect(parsed.count == 4_800)
        #expect(parsed[1].text.contains("مرحبا 🌿"))
    }
}
