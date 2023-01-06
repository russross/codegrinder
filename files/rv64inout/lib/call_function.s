                .global call_function
                .equ    stderr, 2
                .equ    sys_write, 64
                .equ    sys_exit, 93
                .equ    sentinal, 170

                .data
bad_register_msg:
                .ascii  "\n!!! ERROR !!! A callee-saved register was not restored to its original\n"
                .ascii  "value before your function returned.\nQuitting.\n"
                .equ    bad_register_msg_len, (. - bad_register_msg)

                .text
# call_function(arg1, arg2, arg3, arg4, target_function)
#
# To test a function's register use, call call_function
# with the normal parameters (up to 4), and the address
# of the function as the 5th parameter.
#
# call_function will verify that all callee-saved registers
# were restored properly, and will also put useless values
# in all non-argument registers (it ignores a0-a3).
#
# If an incorrect usage is detected it prints an error message
# and exits.
#
# This is just a wrapper function, so it will not catch every
# case, and incorrect use of sp or ra will likely cause it to fail.
call_function:
                # save callee-saved registers
                addi    sp, sp, -128
                sd      ra, 120(sp)
                sd      s0, 112(sp)
                sd      s1, 104(sp)
                sd      s2, 96(sp)
                sd      s3, 88(sp)
                sd      s4, 80(sp)
                sd      s5, 72(sp)
                sd      s6, 64(sp)
                sd      s7, 56(sp)
                sd      s8, 48(sp)
                sd      s9, 40(sp)
                sd      s10, 32(sp)
                sd      s11, 24(sp)
                sd      gp, 16(sp)
                sd      tp, 8(sp)
                sd      sp, 0(sp)

                # saving sp on the stack is not a perfect solution
                # but it acts as a sanity check

                # make a useless value to act as sentinal
                li      t0, sentinal

                # trash t, a, and s registers
                mv      s0, t0
                addi    t0, t0, 17
                mv      s1, t0
                addi    t0, t0, 17
                mv      s2, t0
                addi    t0, t0, 17
                mv      s3, t0
                addi    t0, t0, 17
                mv      s4, t0
                addi    t0, t0, 17
                mv      s5, t0
                addi    t0, t0, 17
                mv      s6, t0
                addi    t0, t0, 17
                mv      s7, t0
                addi    t0, t0, 17
                mv      s8, t0
                addi    t0, t0, 17
                mv      s9, t0
                addi    t0, t0, 17
                mv      s10, t0
                addi    t0, t0, 17
                mv      s11, t0
                addi    t0, t0, 17
                mv      t1, t0
                addi    t0, t0, 17
                mv      t2, t0
                addi    t0, t0, 17
                mv      t3, t0
                addi    t0, t0, 17
                mv      t4, t0
                addi    t0, t0, 17
                mv      t5, t0
                addi    t0, t0, 17
                mv      t6, t0
                addi    t0, t0, 17
                mv      a5, t0
                addi    t0, t0, 17
                mv      a6, t0
                addi    t0, t0, 17
                mv      a7, t0

                # call the user function
                jalr    a4

                # check sp first
                ld      t0, 0(sp)
                bne     sp, t0, 1f

                # load sentinal value
                li      t0, sentinal

                # check all the callee-saved registers
                bne     s0, t0, 1f
                addi    t0, t0, 17
                bne     s1, t0, 1f
                addi    t0, t0, 17
                bne     s2, t0, 1f
                addi    t0, t0, 17
                bne     s3, t0, 1f
                addi    t0, t0, 17
                bne     s4, t0, 1f
                addi    t0, t0, 17
                bne     s5, t0, 1f
                addi    t0, t0, 17
                bne     s6, t0, 1f
                addi    t0, t0, 17
                bne     s7, t0, 1f
                addi    t0, t0, 17
                bne     s8, t0, 1f
                addi    t0, t0, 17
                bne     s9, t0, 1f
                addi    t0, t0, 17
                bne     s10, t0, 1f
                addi    t0, t0, 17
                bne     s11, t0, 1f
                j       2f
1:
                # bad register, print a message and quit
                li      a0, stderr
                la      a1, bad_register_msg
                li      a2, bad_register_msg_len
                li      a7, sys_write
                ecall
                li      a0, 1
                li      a7, sys_exit
                ecall
2:
                # trash t and a registers
                mv      t1, t0
                addi    t0, t0, 31
                mv      t2, t0
                addi    t0, t0, 31
                mv      t3, t0
                addi    t0, t0, 31
                mv      t4, t0
                addi    t0, t0, 31
                mv      t5, t0
                addi    t0, t0, 31
                mv      t6, t0

                # leave the return value in a0
                addi    t0, t0, 31
                mv      a1, t0
                addi    t0, t0, 31
                mv      a2, t0
                addi    t0, t0, 31
                mv      a3, t0
                addi    t0, t0, 31
                mv      a4, t0
                addi    t0, t0, 31
                mv      a5, t0
                addi    t0, t0, 31
                mv      a6, t0
                addi    t0, t0, 31
                mv      a7, t0

                # postlude
                ld      ra, 120(sp)
                ld      s0, 112(sp)
                ld      s1, 104(sp)
                ld      s2, 96(sp)
                ld      s3, 88(sp)
                ld      s4, 80(sp)
                ld      s5, 72(sp)
                ld      s6, 64(sp)
                ld      s7, 56(sp)
                ld      s8, 48(sp)
                ld      s9, 40(sp)
                ld      s10, 32(sp)
                ld      s11, 24(sp)
                ld      gp, 16(sp)
                ld      tp, 8(sp)
                addi    sp, sp, 128
                ret
