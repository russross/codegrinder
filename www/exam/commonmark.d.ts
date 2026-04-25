declare module "commonmark" {
    interface ParsedNode {}

    class Parser {
        parse(input: string): ParsedNode;
    }

    class HtmlRenderer {
        render(node: ParsedNode): string;
    }
}
