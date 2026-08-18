'use strict';

const fs = require('fs');
const { execSolution } = require('jstest');

const solutionPath = 'helloWorld.js';
const sourceCode = fs.readFileSync(solutionPath, 'utf8');

describe('Hello World', () => {
  test('prints the correct message', () => {
    const output = execSolution(solutionPath);
    expect(output).toPrintLines(['Hello, World!'], {
      message: 'Print exactly "Hello, World!" including capitalization and punctuation.',
    });
  });

  test('uses console.log', () => {
    expect(sourceCode).toHaveFunctionCall('console.log', {
      message: 'Use console.log() to print the message.',
    });
  });
});
