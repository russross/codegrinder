import { createDestructuringMatcher } from './test-custom/destructuring';

expect.extend(createDestructuringMatcher());

declare global {
  namespace jest {
    interface Matchers<R> {
      toUseDestructuring(options?: {
        objectDestructuring?: boolean,
        arrayDestructuring?: boolean,
        minOccurrences?: number,
        message?: string
      }): R;
    }
  }
}
