import * as ts from 'typescript';

type DestructuringLocation = {
  line: number;
  column: number;
  type: string;
};

type DestructuringOptions = {
  objectDestructuring?: boolean;
  arrayDestructuring?: boolean;
  minOccurrences?: number;
};

type DestructuringDetails = {
  objectDestructuringCount: number;
  arrayDestructuringCount: number;
  locations: DestructuringLocation[];
};

type DestructuringResult = {
  hasDestructuring: boolean;
  details: DestructuringDetails;
};

type MatcherOptions = DestructuringOptions & {
  message?: string;
};

type MatcherResult = {
  pass: boolean;
  message: () => string;
};

export function containsDestructuring(
  sourceCode: string, 
  options: DestructuringOptions = {}
): DestructuringResult {
  const {
    objectDestructuring = true,
    arrayDestructuring = true,
    minOccurrences = 1
  } = options;

  const sourceFile: ts.SourceFile = ts.createSourceFile(
    'solution.ts',
    sourceCode,
    ts.ScriptTarget.Latest,
    true
  );

  let objectDestructuringCount: number = 0;
  let arrayDestructuringCount: number = 0;
  const locations: DestructuringLocation[] = [];

  function visit(node: ts.Node): void {
    if (objectDestructuring && ts.isObjectBindingPattern(node)) {
      objectDestructuringCount++;
      const lineAndChar: ts.LineAndCharacter = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      locations.push({ 
        line: lineAndChar.line + 1, 
        column: lineAndChar.character + 1, 
        type: 'object' 
      });
    }
    
    if (arrayDestructuring && ts.isArrayBindingPattern(node)) {
      arrayDestructuringCount++;
      const lineAndChar: ts.LineAndCharacter = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      locations.push({ 
        line: lineAndChar.line + 1, 
        column: lineAndChar.character + 1, 
        type: 'array' 
      });
    }
    
    ts.forEachChild(node, visit);
  }
  
  visit(sourceFile);
  
  const totalCount: number = objectDestructuringCount + arrayDestructuringCount;
  const hasDestructuring: boolean = totalCount >= minOccurrences;
  
  return {
    hasDestructuring,
    details: {
      objectDestructuringCount,
      arrayDestructuringCount,
      locations
    }
  };
}

type DestructuringMatcher = {
  toUseDestructuring: (sourceCode: string, options?: MatcherOptions) => MatcherResult;
};

export function createDestructuringMatcher(): DestructuringMatcher {
  return {
    toUseDestructuring(
      sourceCode: string,
      options?: MatcherOptions
    ): MatcherResult {
      const result: DestructuringResult = containsDestructuring(sourceCode, options);
      const pass: boolean = result.hasDestructuring;
      
      const message: string = options?.message || 'Expected solution to use destructuring assignment syntax';
      
      return {
        pass,
        message: (): string => pass 
          ? `Solution unexpectedly uses destructuring.`
          : `${message}\n\nDetails: Found ${result.details.objectDestructuringCount} object destructuring patterns and ${result.details.arrayDestructuringCount} array destructuring patterns.`
      };
    }
  };
}

