import { LanguageSupport, StreamLanguage } from "@codemirror/language";
import type { StreamParser, StringStream } from "@codemirror/language";

// These spellings follow src/tokenizer.rs and src/parser.rs. Mnemonics are
// special only at the start of a statement; elsewhere they can name symbols.
const instructions = new Set([
  "add", "sub", "sll", "slt", "sltu", "xor", "srl", "sra", "or", "and",
  "mul", "mulh", "mulhsu", "mulhu", "div", "divu", "rem", "remu",
  "addi", "slli", "slti", "sltiu", "xori", "ori", "andi", "srli", "srai",
  "jalr", "beq", "bne", "blt", "bge", "bltu", "bgeu", "bgez", "bnez",
  "lui", "auipc", "jal", "fence", "fence.tso", "fence.i", "ecall", "ebreak",
  "lb", "lh", "lw", "lbu", "lhu", "sb", "sh", "sw",
  "li", "la", "call", "tail", "mv", "ret", "nop", "neg", "seqz", "snez",
  "sltz", "sgtz", "beqz", "blez", "bltz", "bgtz", "bgt", "ble", "bgtu",
  "bleu", "j", "jr", "not",
]);

// Compressed and atomic names are closed sets, rather than arbitrary c.* or
// amo* instructions. Release ordering uses the standard .rl suffix.
for (const name of [
  "add", "mv", "jr", "jalr", "li", "lui", "addi", "addi16sp", "addi4spn",
  "slli", "lwsp", "swsp", "lw", "sw", "and", "or", "xor", "sub", "srli",
  "srai", "andi", "beqz", "bnez", "j", "jal", "nop", "ebreak",
]) instructions.add(`c.${name}`);

for (const name of [
  "lr", "sc", "amoswap", "amoadd", "amoxor", "amoand", "amoor", "amomin",
  "amomax", "amominu", "amomaxu",
]) {
  for (const suffix of ["", ".aq", ".rl", ".aqrl"]) {
    instructions.add(`${name}.w${suffix}`);
  }
}

const directives = new Set([
  "global", "globl", "equ", "set", "text", "data", "bss", "space", "zero",
  "balign", "ascii", "string", "asciz", "byte", "2byte", "half", "4byte", "word",
]);
const registers = /^(?:x(?:[0-9]|[12][0-9]|3[01])|zero|ra|sp|gp|tp|fp|t[0-6]|s(?:[0-9]|1[01])|a[0-7])$/;

// Rust permits ASCII letters, _ and $ at the start of an identifier, and
// Unicode alphanumeric characters, _, . and $ afterward. A leading dot is
// a directive introducer, an internal .L name, or the current-address expression.
const identifier = /^(?:[A-Za-z_$]|\.L)[\p{Alphabetic}\p{N}_.$]*/u;
const directiveName = /^[\p{Alphabetic}\p{N}][\p{Alphabetic}\p{N}_.$]*/u;
const labelColon = /^[ \t\r]*:/;
const referenceSuffix = /^[ \t\r]*[fb](?![\p{Alphabetic}\p{N}_.$])/u;
const escapes = new Set(["n", "t", "r", "\\", "'", '"', "0"]);

interface RiscletState {
  position: "labelOrStatement" | "statement" | "operands";
  afterInteger: boolean;
  fence: boolean;
}

// Source is assembled one physical line at a time. Strings, labels and
// statement context therefore never continue onto the next line.
function resetLine(state: RiscletState): void {
  state.position = "labelOrStatement";
  state.afterInteger = false;
  state.fence = false;
}

function nextCharacter(stream: StringStream): string | undefined {
  const point = stream.string.codePointAt(stream.pos);
  if (point === undefined) return undefined;
  const character = String.fromCodePoint(point);
  stream.pos += character.length;
  return character;
}

// Character literals contain exactly one Unicode character or supported
// escape. Consume malformed literals locally so highlighting recovers next line.
function quotedLiteral(stream: StringStream, quote: string): string {
  let valid = true;
  let characters = 0;
  while (!stream.eol()) {
    const character = nextCharacter(stream);
    if (character === quote && (quote === '"' || characters > 0)) {
      return valid && (quote === '"' || characters === 1)
        ? quote === '"' ? "string" : "number"
        : "invalid";
    }
    if (character === "\\") {
      const escape = nextCharacter(stream);
      if (escape === undefined || !escapes.has(escape)) valid = false;
    }
    characters += 1;
  }
  return "invalid";
}

// Match the tokenizer's radix rules, including traditional leading-zero
// octal. Signs remain operators, and unsigned 32-bit bit patterns are accepted.
function integerLiteral(stream: StringStream): string | null {
  // A bare lowercase 0b is a local-label reference, not an empty binary literal.
  if (stream.match(/^0b(?![01])/, false)) {
    stream.next();
    return "number";
  }
  const matched = stream.match(/^(?:0[xX][0-9a-fA-F]*|0[bB][01]*|0[oO][0-7]*|0[0-7]*|[1-9][0-9]*)/);
  if (!matched) return null;
  const text = stream.current();
  const prefix = text.slice(0, 2).toLowerCase();
  const radix = prefix === "0x" ? 16 : prefix === "0b" ? 2
    : prefix === "0o" || text.startsWith("0") ? 8 : 10;
  const digits = ["0x", "0b", "0o"].includes(prefix) ? text.slice(2) : text;
  const value = Number.parseInt(digits, radix);
  return Number.isNaN(value) || value > 0xffffffff ? "invalid" : "number";
}

// A single initial label may precede the statement. Numeric label references
// are an integer followed by the identifier f or b, even with whitespace.
function integerStyle(stream: StringStream, state: RiscletState): string {
  if (state.position === "labelOrStatement" && stream.match(labelColon, false)) {
    state.position = "statement";
    return "labelName";
  }
  const statement = state.position !== "operands";
  state.position = "operands";
  state.afterInteger = true;
  if (statement) return "invalid";
  return stream.match(referenceSuffix, false) ? "labelName" : "number";
}

export const riscletStreamParser: StreamParser<RiscletState> = {
  name: "risclet",
  startState: () => ({ position: "labelOrStatement", afterInteger: false, fence: false }),
  blankLine: resetLine,
  token(stream, state) {
    if (stream.sol()) resetLine(state);
    if (stream.match(/^[ \t\r]+/)) return null;
    if (stream.peek() === "#") {
      stream.skipToEnd();
      return "lineComment";
    }

    // Keep numeric-reference context across whitespace, but no other tokens.
    const afterInteger = state.afterInteger;
    state.afterInteger = false;
    const quote = stream.peek();
    if (quote === '"' || quote === "'") {
      stream.next();
      const style = quotedLiteral(stream, quote);
      if (style === "number") return integerStyle(stream, state);
      state.position = "operands";
      return style;
    }
    const number = integerLiteral(stream);
    if (number !== null) {
      if (number === "number") return integerStyle(stream, state);
      state.position = "operands";
      return number;
    }

    // The leading dot decision is lexical, including unknown directive errors.
    if (!stream.match(/^\.L/, false) && stream.eat(".")) {
      if (!stream.match(directiveName)) return "atom";
      state.position = "operands";
      return directives.has(stream.current().slice(1)) ? "meta" : "invalid";
    }
    if (stream.match(identifier)) {
      const name = stream.current();
      if (registers.test(name)) {
        const statement = state.position !== "operands";
        state.position = "operands";
        return statement ? "invalid" : "variableName.standard";
      }

      // Opcode-shaped identifiers are legal label and symbol names. Registers
      // are reserved lexically, so they cannot take this label-definition path.
      if (state.position === "labelOrStatement" && stream.match(labelColon, false)) {
        state.position = "statement";
        return "labelName";
      }
      if (state.position !== "operands") {
        state.position = "operands";
        state.fence = name === "fence";
        return instructions.has(name) ? "keyword" : "invalid";
      }
      if (afterInteger && (name === "f" || name === "b")) return "labelName";
      if (state.fence) return /^[iorw]+$/.test(name) ? "atom" : "invalid";
      return "variableName";
    }

    // Expressions use arithmetic and bitwise operators, without GAS relocation
    // functions. Parentheses also delimit base registers in memory operands.
    if (stream.match(/^(?:<<|>>|[+*/%&|^~\-])/)) return "operator";
    if (stream.match(/^[()]/)) return "paren";
    if (stream.match(/^[,:]/)) return "punctuation";
    nextCharacter(stream);
    return "invalid";
  },
  languageData: {
    commentTokens: { line: "#" },
    closeBrackets: { brackets: ["(", "'", '"'] },
    wordChars: "_.$",
  },
};

// Consumers can use the language directly or the conventional language-support
// factory alongside their existing CodeMirror theme and highlighting extension.
export const riscletLanguage = StreamLanguage.define(riscletStreamParser);

export function risclet(): LanguageSupport {
  return new LanguageSupport(riscletLanguage);
}
