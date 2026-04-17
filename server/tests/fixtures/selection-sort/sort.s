                .global sort
                .text

# sort(begin_address, end_address)
sort:
                #       +-------------------+
                #       | saved ra          | 24
                #       +-------------------+
                #       | saved s1          | 16
                #       +-------------------+
                #       | saved s0          | 8
                #       +-------------------+
                # sp -> |                   |
                #       +-------------------+
                #
                # s0: start
                # s1: end 

                # prelude
                addi    sp, sp, -16
                sw      ra, 12(sp)
                sw      s1, 8(sp)
                sw      s0, 4(sp)

                mv      s0, a0
                mv      s1, a1
1:              bge     s0, s1, 2f
                mv      a0, s0
                mv      a1, s1
                jal     find_smallest
                lw      t0, (s0)
                lw      t1, (a0)
                sw      t0, (a0)
                sw      t1, (s0)
                addi    s0, s0, 4
                j       1b

                # postlude
2:              lw      ra, 12(sp)
                lw      s1, 8(sp)
                lw      s0, 4(sp)
                addi    sp, sp, 16
                ret
