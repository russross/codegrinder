#!/usr/bin/env python

#
# CS2810 Project 06: Assembler
# Example implememtation by Russ Ross
# October 2010; revised February 2011
#

import sys

# all possible C-instruction destinations
DESTINATIONS = {
    '':     '000',
    'M':    '001',
    'D':    '010',
    'MD':   '011',
    'A':    '100',
    'AM':   '101',
    'AD':   '110',
    'AMD':  '111',
}

# all possible C-instruction computations (A/M + ALU inputs)
COMPUTATIONS = {
    '0':    '0101010',
    '1':    '0111111',
    '-1':   '0111010',
    'D':    '0001100',
    'A':    '0110000',
    '!D':   '0001101',
    '!A':   '0110001',
    '-D':   '0001111',
    '-A':   '0110011',
    'D+1':  '0011111',
    'A+1':  '0110111',
    'D-1':  '0001110',
    'A-1':  '0110010',
    'D+A':  '0000010',
    'A+D':  '0000010',
    'D-A':  '0010011',
    'A-D':  '0000111',
    'D&A':  '0000000',
    'A&D':  '0000000',
    'D|A':  '0010101',
    'A|D':  '0010101',

    'M':    '1110000',
    '!M':   '1110001',
    '-M':   '1110011',
    'M+1':  '1110111',
    'M-1':  '1110010',
    'D+M':  '1000010',
    'M+D':  '1000010',
    'D-M':  '1010011',
    'M-D':  '1000111',
    'D&M':  '1000000',
    'M&D':  '1000000',
    'D|M':  '1010101',
    'M|D':  '1010101',
}

# all possible C-instruction jump conditions
JUMPS = {
    '':     '000',
    'JGT':  '001',
    'JEQ':  '010',
    'JGE':  '011',
    'JLT':  '100',
    'JNE':  '101',
    'JLE':  '110',
    'JMP':  '111',
}

# test if a given string is a valid symbol
def isSymbol(s):
    if s == '' or s[0].isdigit():
        return False
    for ch in s:
        if not ch.isalnum() and ch not in '_.$:':
            return False
    return True

# test if a given string is a valid constant (0--32767)
def isConstant(s):
    return s.isdigit() and int(s) < 32768

def fail(msg, srcline, srclinenumber):
    print('Quitting due to error on line %d:' % srclinenumber, file=sys.stderr)
    print('  Input: ' + repr(srcline), file=sys.stderr)
    print('  Error: ' + msg, file=sys.stderr)
    sys.exit(-1)

#
# Parser
# reads the input file, strips comments, blank lines, and whitespace,
# then parses each line into one of the three supported command types
#
# parse each line into one of:
#   * None
#   * ('A_INSTRUCTION', symbol, srcline, srclinenumber)
#   * ('C_INSTRUCTION' dest, comp, jump, srcline, srclinenumber)
#   * ('L_INSTRUCTION', symbol, srcline, srclinenumber)

def parse(fp):
    srclinenumber = 0
    result = []
    for line in fp:
        srclinenumber += 1
        res = parseLine(line, srclinenumber)
        if res is None:
            continue
        result.append(res)

    # return the complete list of parsed lines
    return result


def parseLine(srcline, srclinenumber):
    line = srcline

    # first strip away comments
    comment = line.find('//')
    if comment >= 0:
        line = line[:comment]

    # next remove leading and trailing whitespace (including newline)
    line = line.strip()

    # empty line (ignore)
    if line == '':
        return None

    # A command: @label or @constant
    if line.startswith('@'):
        line = line[1:].strip()
        if not isSymbol(line) and not isConstant(line):
            fail('@ command must have a valid symbol ' +
                    'or constant value',
                    srcline, srclinenumber)
        return ('A_INSTRUCTION', line, srcline, srclinenumber)

    # L command: (label)
    if line.startswith('(') and line.endswith(')'):
        line = line[1:-1].strip()
        if not isSymbol(line):
            fail('label must be a valid symbol',
                    srcline, srclinenumber)
        return ('L_INSTRUCTION', line, srcline, srclinenumber)

    # C command: DEST=COMPUTATION;JUMP
    (dest, comp, jump) = ('', None, '')

    # handle the destination part
    eq = line.find('=')
    if eq >= 0:
        dest = line[:eq].strip()
        line = line[eq+1:].strip()
        if dest == '':
            fail('destination must not be blank when = is present',
                    srcline, srclinenumber)
        if dest not in DESTINATIONS:
            fail('invalid destination',
                    srcline, srclinenumber)

    # handle the jump part
    semi = line.find(';')
    if semi >= 0:
        jump = line[semi + 1:].strip()
        line = line[:semi].strip()
        if jump == '':
            fail('jump must not be blank when ; is present',
                    srcline, srclinenumber)
        if jump not in JUMPS:
            fail('invalid jump instruction',
                    srcline, srclinenumber)

    # handle the computation part
    comp = line
    if comp == '':
        fail('computation must not be blank',
                srcline, srclinenumber)
    if comp not in COMPUTATIONS:
        fail('invalid computation',
                srcline, srclinenumber)

    return ('C_INSTRUCTION', dest, comp, jump, srcline, srclinenumber)


#
# SymbolTable class
# Manages a symbol table.
#
# Functions as specified in the book.
#
class SymbolTable:
    # set up built-in symbols
    def __init__(self):
        self.table = {
            'SP':       0,
            'LCL':      1,
            'ARG':      2,
            'THIS':     3,
            'THAT':     4,
            'R0':       0,
            'R1':       1,
            'R2':       2,
            'R3':       3,
            'R4':       4,
            'R5':       5,
            'R6':       6,
            'R7':       7,
            'R8':       8,
            'R9':       9,
            'R10':      10,
            'R11':      11,
            'R12':      12,
            'R13':      13,
            'R14':      14,
            'R15':      15,
            'SCREEN':   0x4000,
            'KBD':      0x6000,
        }

    # add a new entry
    def addEntry(self, symbol, address):
        self.table[symbol] = address

    # test if an entry exists
    def contains(self, symbol):
        return symbol in self.table

    # look up address associated with a label
    def getAddress(self, symbol):
        return self.table[symbol]

# the main loop
def main():
    # validate input arguments
    if len(sys.argv) != 2 or not sys.argv[1].endswith('.asm'):
        print('Usage: %s <input>.asm' % sys.argv[0], file=sys.stderr)
        sys.exit(-1)

    # in.asm -> in.hack
    source = sys.argv[1]
    target = source[:-len('.asm')] + '.hack'

    # this object persist across both passes
    symboltable = SymbolTable()

    infile = open(source)
    parsedlines = parse(infile)
    infile.close()
    outfile = open(target, 'w')

    # parse file twice. address labels are assigned in first pass,
    # variable labels are assigned in second, and code is generated in second
    for sweep in (1, 2):
        # open files (output is only written during second pass)

        # keep track of instruction number and next available variable slot
        pc = 0
        variable = 16

        # loop through command lines
        for line in parsedlines:
            if line[0] == 'A_INSTRUCTION':
                # get the value to load
                symbol = line[1]

                if isSymbol(symbol) and sweep == 2:
                    # symbols are resolved on the second pass only
                    if symboltable.contains(symbol):
                        value = symboltable.getAddress(symbol)
                    else:
                        symboltable.addEntry(symbol, variable)
                        value = variable
                        variable += 1
                elif isConstant(symbol):
                    # constants are easy
                    value = int(symbol)
                else:
                    # found a symbol on the first pass
                    value = 0

                # format it as a 15-bit binary number
                n = bin(value)[2:]
                n = '0'*(15-len(n)) + n

                # write the output
                if sweep == 2:
                    print('0' + n, file=outfile)

                # advance the address counter
                pc += 1

            elif line[0] == 'C_INSTRUCTION':
                # get the pieces
                command = '111'
                command += COMPUTATIONS[line[2]]
                command += DESTINATIONS[line[1]]
                command += JUMPS[line[3]]

                # write the output
                if sweep == 2:
                    print(command, file=outfile)

                # advance the address counter
                pc += 1

            elif line[0] == 'L_INSTRUCTION':
                # get the label name
                label = line[1]
                assert isSymbol(label)

                # add to the symbol table (first pass only)
                if sweep == 1:
                    if symboltable.contains(label):
                        fail('label already used: [%s]' % label,
                                line[2], line[3])
                    symboltable.addEntry(label, pc)

            else:
                assert False

    outfile.close()

if __name__ == '__main__':
    main()
