                .global print_n, print_set, puts
                .equ    stdout, 1
                .equ    sys_write, 64
                .equ    sys_exit, 93
                .text

# puts(s)
puts:
                # a1: ptr
                # a2: len
                mv      a1, a0
                li      a2, 0
1:
                add     t0, a1, a2
                lb      t1, (t0)
                beqz    t1, 2f
                addi    a2, a2, 1
                j       1b
2:
                li      a0, stdout
                li      a7, sys_write
                ecall
                bgez    a0, 3f
                neg     a0, a0
                li      a7, sys_exit
                ecall
3:
                ret


# print_n(n)
print_n:
                addi    sp, sp, -32
                sd      ra, 24(sp)

                # a0: n
                # a1: ptr
                # a2: 10
                # a3: is_negative
                sltz    a3, a0
                bgez    a0, 1f
                neg     a0, a0
1:
                mv      a1, sp
                li      a2, 10
2:
                remu    t0, a0, a2
                addi    t0, t0, '0'
                sb      t0, (a1)
                addi    a1, a1, 1
                divu    a0, a0, a2
                bnez    a0, 2b
                beqz    a3, 3f
                li      t0, '-'
                sb      t0, (a1)
                addi    a1, a1, 1

                # a0: ptr_a
                # a1: ptr_b
                # a2: len
3:
                sub     a2, a1, sp
                mv      a0, sp
                addi    a1, a1, -1
4:
                lb      t0, (a0)
                lb      t1, (a1)
                sb      t0, (a1)
                sb      t1, (a0)
                addi    a0, a0, 1
                addi    a1, a1, -1
                blt     a0, a1, 4b

                add     t0, sp, a2
                sb      zero, (t0)

                mv      a0, sp
                call    puts
5:
                ld      ra, 24(sp)
                addi    sp, sp, 32
                ret

# print_set(set)
print_set:
                # prelude
                addi    sp, sp, -16
                sd      ra, 8(sp)

                # a0: in
                # a1: out
                # a2: i
                # a3: 10
                li      a1, 0
                li      a3, 10

                # for i from [9,0]
                li      a2, 9
1:
                li      t0, 1
                sll     t1, t0, a2
                and     t2, a0, t1
                beqz    t2, 2f
                mul     a1, a1, a3
                add     a1, a1, a2
2:
                addi    a2, a2, -1
                bgez    a2, 1b

                mv      a0, a1
                call    print_n

                ld      ra, 8(sp)
                addi    sp, sp, 16
                ret
