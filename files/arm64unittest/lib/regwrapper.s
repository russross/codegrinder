        .global callfunction, target_function, unsaved_register_number
        .text

// callfunction
//
// To test a function's register use, first write the function pointer
// to target_function. Then call callfunction as though it was the target
// function, and it will return the functions return value. Finally, check
// unsaved_register_number. If it is non-zero, then the target function did not
// observe proper register usage, and the value of unsaved_register_number is
// the number of a register that was not preserved properly.

callfunction:
        // save variable registers, fp (x29), lr (x30), and sp (x31)
        ldr     x17, =.x19
        str     x19, [x17, #0]
        str     x20, [x17, #8]
        str     x21, [x17, #16]
        str     x22, [x17, #24]
        str     x23, [x17, #32]
        str     x24, [x17, #40]
        str     x25, [x17, #48]
        str     x26, [x17, #56]
        str     x27, [x17, #64]
        str     x28, [x17, #72]
        str     x29, [x17, #80]
        str     x30, [x17, #88]
        // sp needs special treatment
        mov     x30, sp
        str     x30, [x17, #96]

        // call the user function
        ldr     x17, =target_function
        ldr     x17, [x17]
        blr     x17

        // x16 = unsaved_register_number
        mov     x16, #0

        // check if the saved values match the current values
        .macro checkregister number
        ldr     x30, =.x\number
        ldr     x30, [x30]
        cmp     x30, x\number
        // skip forward two instructions
        b.eq    8
        mov     x16, #\number
        mov     x\number, x30
        .endm

        checkregister   19
        checkregister   20
        checkregister   21
        checkregister   22
        checkregister   23
        checkregister   24
        checkregister   25
        checkregister   26
        checkregister   27
        checkregister   28
        checkregister   29

        // sp needs special treatment
        ldr     x30, =.sp
        ldr     x30, [x30]
        mov     x17, sp
        cmp     x17, x30
        b.eq    8
        mov     x16, #31
        mov     sp, x30

        // save unsaved_register_number and return
        ldr     x17, =unsaved_register_number
        str     x16, [x17]
        ldr     x30, =.x30
        ldr     x30, [x30]
        br      x30

        .data
        .balign 8
.x19:   .quad   0
.x20:   .quad   0
.x21:   .quad   0
.x22:   .quad   0
.x23:   .quad   0
.x24:   .quad   0
.x25:   .quad   0
.x26:   .quad   0
.x27:   .quad   0
.x28:   .quad   0
.x29:   .quad   0
.x30:   .quad   0
.sp:    .quad   0

target_function:
        .quad   0
unsaved_register_number:
        .quad   0
