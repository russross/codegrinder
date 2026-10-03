declare module "commonmark" {
    interface MarkdownNode {
        destination: string | null;
        type: string;
    }

    interface NodeWalkerEvent {
        entering: boolean;
        node: MarkdownNode;
    }

    interface NodeWalker {
        next(): NodeWalkerEvent | null;
    }

    interface ParsedNode {
        walker(): NodeWalker;
    }

    class Parser {
        parse(input: string): ParsedNode;
    }

    class HtmlRenderer {
        render(node: ParsedNode): string;
    }
}
