.macro print str
                li      a0, stdout
                la      a1, \str
                li      a2, \str\()_len
                li      a7, sys_write
                ecall
                bgez    a0, 9876f
                neg     a0, a0
                li      a7, sys_exit
                ecall
9876:
.endm
