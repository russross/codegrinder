.global regwrapper, target_function, bad_register

.text

@ regwrapper
@
@ To test a function's register use, first write the function pointer
@ to target_function. Then call regwrapper as though it was the target
@ function, and it will return the functions return value. Finally, check
@ bad_register. If it is non-zero, then the target function did not
@ observe proper register usage, and the value of bad_register is the
@ number of a register that was not preserved properly.

regwrapper:
        @ save variable registers, sp, and lr
        push    {r0}
        ldr     r0, =.r4
        stmea   r0, {r4,r5,r6,r7,r8,r9,r10,r11,r13,r14}
        pop     {r0}

        @ call the user function
        ldr     r14, =target_function
        ldr     r14, [r14]
        blx     r14

        @ save r0 without using sp in case sp is broken
        ldr     r14, =.r0
        str     r0, [r14]

        @ r0 = bad_register
        ldr     r0, =0

        @ check if the saved values match the current values
.cr4:   ldr     r14, =.r4
        ldr     r14, [r14]
        cmp     r14, r4
        beq     .cr5
        ldr     r0, =4
        ldr     r4, =.r4
        ldr     r4, [r4]

.cr5:   ldr     r14, =.r5
        ldr     r14, [r14]
        cmp     r14, r5
        beq     .cr6
        ldr     r0, =5
        ldr     r5, =.r5
        ldr     r5, [r5]

.cr6:   ldr     r14, =.r6
        ldr     r14, [r14]
        cmp     r14, r6
        beq     .cr7
        ldr     r0, =6
        ldr     r6, =.r6
        ldr     r6, [r6]

.cr7:   ldr     r14, =.r7
        ldr     r14, [r14]
        cmp     r14, r7
        beq     .cr8
        ldr     r0, =7
        ldr     r7, =.r7
        ldr     r7, [r7]

.cr8:   ldr     r14, =.r8
        ldr     r14, [r14]
        cmp     r14, r8
        beq     .cr9
        ldr     r0, =8
        ldr     r8, =.r8
        ldr     r8, [r8]

.cr9:   ldr     r14, =.r9
        ldr     r14, [r14]
        cmp     r14, r9
        beq     .cr10
        ldr     r0, =9
        ldr     r9, =.r9
        ldr     r9, [r9]

.cr10:  ldr     r14, =.r10
        ldr     r14, [r14]
        cmp     r14, r10
        beq     .cr11
        ldr     r0, =10
        ldr     r10, =.r10
        ldr     r10, [r10]

.cr11:  ldr     r14, =.r11
        ldr     r14, [r14]
        cmp     r14, r11
        beq     .cr13
        ldr     r0, =11
        ldr     r11, =.r11
        ldr     r11, [r11]

        @ expected value of sp is stored value +4
.cr13:  ldr     r14, =.r13
        ldr     r14, [r14]
        add     r14, r14, #4
        cmp     r14, r13
        beq     .cr14
        ldr     r0, =13
        ldr     r13, =.r13
        ldr     r13, [r13]
        add     r13, r13, #4

.cr14:  ldr     r14, =.r14
        ldr     r14, [r14]
        cmp     r14, r14
        beq     .end
        ldr     r0, =14
        ldr     r14, =.r14
        ldr     r14, [r14]

        @ return
.end:   ldr     r14, =bad_register
        str     r0, [r14]
        ldr     r0, =.r0
        ldr     r0, [r0]
        ldr     r14, =.r14
        ldr     r14, [r14]
        bx      lr

.pool
.data

.r0:    .word   0
.r4:    .word   0
.r5:    .word   0
.r6:    .word   0
.r7:    .word   0
.r8:    .word   0
.r9:    .word   0
.r10:   .word   0
.r11:   .word   0
.r13:   .word   0
.r14:   .word   0

target_function:
        .word 0
bad_register:
        .word 0
