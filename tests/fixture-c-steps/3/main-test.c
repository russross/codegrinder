#include <stdio.h>

#include "fixture.h"

int main(void) {
    const int values[] = {2, 4, 6};
    printf("one: %d\n", fixture_one(4));
    printf("two: %d\n", fixture_two(3, 4));
    printf("three: %d\n", fixture_three(values, 3));
    return 0;
}
