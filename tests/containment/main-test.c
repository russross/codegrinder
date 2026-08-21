#include <stdio.h>

int containment_answer(void);

int main(void) {
    int input = 0;
    if (scanf("%d", &input) != 1) {
        return 1;
    }
    printf("%d\n", containment_answer() + input);
    return 0;
}
