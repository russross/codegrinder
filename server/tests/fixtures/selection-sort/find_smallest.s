                .global find_smallest
                .text

# find_smallest(begin_address, end_address) -> address_of_smallest
find_smallest:
                # a0: current address
                # a1: end address
                # a2: address of smallest
                # a3: value of smallest
                # a4: elt
                mv      a2, a0
                lw      a3, (a0)
                addi    a0, a0, 4
1:              bge     a0, a1, 3f
                lw      a4, (a0)
                bge     a4, a3, 2f
                mv      a2, a0
                mv      a3, a4
2:              addi    a0, a0, 4
                j       1b
3:              mv      a0, a2
                ret
