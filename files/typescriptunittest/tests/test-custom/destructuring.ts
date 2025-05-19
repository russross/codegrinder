import * as ts from 'typescript';

export function containsDestructuring(
  sourceCode: string, 
  options: {
    objectDestructuring?: boolean,
    arrayDestructuring?: boolean,
    minOccurrences?: number,
  } = {}
): { 
  hasDestructuring: boolean, 
  details: {
    objectDestructuringCount: number,
    arrayDestructuringCount: number,
    locations: { line: number, column: number, type: string }[]
  } 
} {
  const {
    objectDestructuring = true,
    arrayDestructuring = true,
    minOccurrences = 1
  } = options;

  const sourceFile = ts.createSourceFile(
    'solution.ts',
    sourceCode,
    ts.ScriptTarget.Latest,
    true
  );

  let objectDestructuringCount = 0;
  let arrayDestructuringCount = 0;
  const locations: { line: number, column: number, type: string }[] = [];

  function visit(node: ts.Node) {
    if (objectDestructuring && ts.isObjectBindingPattern(node)) {
      objectDestructuringCount++;
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      locations.push({ line: line + 1, column: character + 1, type: 'object' });
    }
    
    if (arrayDestructuring && ts.isArrayBindingPattern(node)) {
      arrayDestructuringCount++;
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      locations.push({ line: line + 1, column: character + 1, type: 'array' });
    }
    
    ts.forEachChild(node, visit);
  }
  
  visit(sourceFile);
  
  const totalCount = objectDestructuringCount + arrayDestructuringCount;
  const hasDestructuring = totalCount >= minOccurrences;
  
  return {
    hasDestructuring,
    details: {
      objectDestructuringCount,
      arrayDestructuringCount,
      locations
    }
  };
}

export function createDestructuringMatcher() {
  return {
    toUseDestructuring(
      sourceCode: string,
      options?: {
        objectDestructuring?: boolean,
        arrayDestructuring?: boolean,
        minOccurrences?: number,
        message?: string
      }
    ) {
      const result = containsDestructuring(sourceCode, options);
      const pass = result.hasDestructuring;
      
      const message = options?.message || 'Expected solution to use destructuring assignment syntax';
      
      return {
        pass,
        message: () => pass 
          ? `Solution unexpectedly uses destructuring.`
          : `${message}\n\nDetails: Found ${result.details.objectDestructuringCount} object destructuring patterns and ${result.details.arrayDestructuringCount} array destructuring patterns.`
      };
    }
  };
} 

