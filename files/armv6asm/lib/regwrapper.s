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
        ldr     ip, =.r4
        stmea   ip, {r4,r5,r6,r7,r8,r9,r10,r11,sp,lr}

        @ call the user function
        ldr     ip, =target_function
        ldr     ip, [ip]
        blx     ip

        @ ip = bad_register
        mov     ip, #0

        @ check if the saved values match the current values
.cr4:   ldr     lr, =.r4
        ldr     lr, [lr]
        cmp     lr, r4
        movne   ip, #4
        movne   r4, lr

        ldr     lr, =.r5
        ldr     lr, [lr]
        cmp     lr, r5
        movne   ip, #5
        movne   r5, lr

        ldr     lr, =.r6
        ldr     lr, [lr]
        cmp     lr, r6
        movne   ip, #6
        movne   r6, lr

        ldr     lr, =.r7
        ldr     lr, [lr]
        cmp     lr, r7
        movne   ip, #7
        movne   r7, lr

        ldr     lr, =.r8
        ldr     lr, [lr]
        cmp     lr, r8
        movne   ip, #8
        movne   r8, lr

        ldr     lr, =.r9
        ldr     lr, [lr]
        cmp     lr, r9
        movne   ip, #9
        movne   r9, lr

        ldr     lr, =.r10
        ldr     lr, [lr]
        cmp     lr, r10
        movne   ip, #10
        movne   r10, lr

        ldr     lr, =.r11
        ldr     lr, [lr]
        cmp     lr, r11
        movne   ip, #11
        movne   r11, lr

        ldr     lr, =.sp
        ldr     lr, [lr]
        cmp     lr, sp
        movne   ip, #13
        movne   sp, lr

        @ save bad_register and return
        ldr     lr, =bad_register
        str     ip, [lr]
        ldr     lr, =.lr
        ldr     lr, [lr]
        bx      lr

        .data
.r4:    .word   0
.r5:    .word   0
.r6:    .word   0
.r7:    .word   0
.r8:    .word   0
.r9:    .word   0
.r10:   .word   0
.r11:   .word   0
.sp:    .word   0
.lr:    .word   0

target_function:
        .word 0
bad_register:
        .word 0
