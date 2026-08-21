#include <stdio.h>

#include "fixture.h"

int main(void) {
    printf("one: %d\n", fixture_one(4));
    printf("two: %d\n", fixture_two(3, 4));
    return 0;
}
