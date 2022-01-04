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
                addi    sp, sp, -64
                sw      ra, 60(sp)
                sw      s0, 56(sp)
                sw      s1, 52(sp)
                sw      s2, 48(sp)
                sw      s3, 44(sp)
                sw      s4, 40(sp)
                sw      s5, 36(sp)
                sw      s6, 32(sp)
                sw      s7, 28(sp)
                sw      s8, 24(sp)
                sw      s9, 20(sp)
                sw      s10, 16(sp)
                sw      s11, 12(sp)
                sw      gp, 8(sp)
                sw      tp, 4(sp)
                sw      sp, 0(sp)

                # saving sp on the stack is not a perfect solution
                # but it acts as a sanity check

                # make a useless value to act as sentinal
                li      t0, sentinal

                # trash t, a, and s registers
                mv      t1, t0
                mv      t2, t0
                mv      t3, t0
                mv      t4, t0
                mv      t5, t0
                mv      t6, t0
                mv      a5, t0
                mv      a6, t0
                mv      a7, t0
                mv      s0, t0
                mv      s1, t0
                mv      s2, t0
                mv      s3, t0
                mv      s4, t0
                mv      s5, t0
                mv      s6, t0
                mv      s7, t0
                mv      s8, t0
                mv      s9, t0
                mv      s10, t0
                mv      s11, t0

                # call the user function
                jalr    a4

                # check sp first
                lw      t0, 0(sp)
                bne     sp, t0, 1f

                # load sentinal value
                li      t0, sentinal

                # check all the callee-saved registers
                bne     s0, t0, 1f
                bne     s1, t0, 1f
                bne     s2, t0, 1f
                bne     s3, t0, 1f
                bne     s4, t0, 1f
                bne     s5, t0, 1f
                bne     s6, t0, 1f
                bne     s7, t0, 1f
                bne     s8, t0, 1f
                bne     s9, t0, 1f
                bne     s10, t0, 1f
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
                mv      t2, t0
                mv      t3, t0
                mv      t4, t0
                mv      t5, t0
                mv      t6, t0

                # leave the return value in a0
                mv      a1, t0
                mv      a2, t0
                mv      a3, t0
                mv      a4, t0
                mv      a5, t0
                mv      a6, t0
                mv      a7, t0

                # postlude
                lw      ra, 60(sp)
                lw      s0, 56(sp)
                lw      s1, 52(sp)
                lw      s2, 48(sp)
                lw      s3, 44(sp)
                lw      s4, 40(sp)
                lw      s5, 36(sp)
                lw      s6, 32(sp)
                lw      s7, 28(sp)
                lw      s8, 24(sp)
                lw      s9, 20(sp)
                lw      s10, 16(sp)
                lw      s11, 12(sp)
                lw      gp, 8(sp)
                lw      tp, 4(sp)
                addi    sp, sp, 64
                ret
