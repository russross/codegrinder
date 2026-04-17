Selection sort
==============

Implement the function `sort` in `sort.s` to perform a selection
sort over an array:

    sort(begin_address, end_address)

Selection sort works by finding the smallest element in the array
and swapping it with the first element:

    [8, 5, 2, 4, 7] => [2, 5, 8, 4, 7]
     ^-----^

Then the first element is correct, so ignore it and repeat on the
rest of the list:

    2 [5, 8, 4, 7] => 2 [4, 8, 5, 7]
       ^-----^

Now the first two elements are sorter, so ignore them and repeat on
the rest of the list:

    2, 4 [8, 5, 7] => 2, 4 [5, 8, 7]
          ^--^

repeat:

    2, 4, 5 [8, 7] => 2, 4, 5, [7, 8]
             ^--^

repeat:

    2, 4, 5, 7, [8] => 2, 4, 5, 7, [8]

Now there is no unsorted list left:

    2, 4, 5, 7, 8

so the list is fully sorted and the function is finished.
    

This function should:

*   Allocate a stack frame (it is a non-leaf function)
*   Call `find_smallest` from step 1 to find the smallest element
    in the entire input
*   Swap the first element and the smallest element
*   Increment the `begin_address` value by 4 and repeat
*   End when `begin_address` and `end_address` are the same
*   Restore any s-registers used from the stack, restore the ra
    register, deallocate the stack frame, and return
