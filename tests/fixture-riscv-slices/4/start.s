                .global _start
                .equ    sys_exit, 93
                .equ    fixture_stage_args, 0

                .data
newline:        .asciz "\n"

                .text
_start:
                la      gp, __global_pointer$
                jal     fixture_stage
                jal     print_int
                la      a0, newline
                jal     print_string
                li      a0, 0
                li      a7, sys_exit
                ecall
