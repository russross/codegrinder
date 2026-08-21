'use strict';

const acorn = require('acorn');
const { execFileSync } = require('child_process');

function parseSource(sourceCode) {
  return acorn.parse(sourceCode, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    locations: true,
  });
}

function walkAST(node, visitor) {
  if (!node || typeof node !== 'object') {
    return;
  }

  visitor(node);
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        walkAST(item, visitor);
      }
      continue;
    }
    if (child && typeof child === 'object' && child.type) {
      walkAST(child, visitor);
    }
  }
}

function findAll(sourceCode, nodeType) {
  const tree = parseSource(sourceCode);
  const results = [];
  walkAST(tree, node => {
    if (node.type === nodeType) {
      results.push(node);
    }
  });
  return results;
}

function memberExpressionName(node) {
  if (!node) {
    return '';
  }
  if (node.type === 'Identifier') {
    return node.name;
  }
  if (node.type !== 'MemberExpression' || node.computed) {
    return '';
  }

  const objectName = memberExpressionName(node.object);
  const propertyName = memberExpressionName(node.property);
  return objectName && propertyName ? `${objectName}.${propertyName}` : '';
}

function findFunctionCalls(sourceCode, functionName) {
  return findAll(sourceCode, 'CallExpression').filter(
    node => memberExpressionName(node.callee) === functionName,
  );
}

function findMethodCalls(sourceCode, methodName) {
  return findAll(sourceCode, 'CallExpression').filter(node => {
    if (!node.callee || node.callee.type !== 'MemberExpression' || node.callee.computed) {
      return false;
    }
    return memberExpressionName(node.callee.property) === methodName;
  });
}

function matchSignature(sourceCode, functionName, argCount) {
  const tree = parseSource(sourceCode);
  let found = null;

  walkAST(tree, node => {
    if (found) {
      return;
    }
    if (
      node.type === 'FunctionDeclaration'
      && node.id?.name === functionName
      && node.params.length === argCount
    ) {
      found = node;
      return;
    }
    if (
      node.type === 'VariableDeclarator'
      && node.id?.name === functionName
      && node.init
      && (node.init.type === 'FunctionExpression' || node.init.type === 'ArrowFunctionExpression')
      && node.init.params.length === argCount
    ) {
      found = node;
    }
  });

  return found;
}

function execSolution(filename, args = []) {
  try {
    const output = execFileSync('node', [filename, ...args], {
      cwd: process.cwd(),
      timeout: 10000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const normalized = output.replace(/\r\n/g, '\n').replace(/\n$/, '');
    return normalized.length === 0 ? [] : normalized.split('\n');
  } catch (error) {
    const stderr = error.stderr ? error.stderr.toString() : '';
    throw new Error(`Error executing ${filename}:\n${stderr || error.message}`);
  }
}

function installMatchers() {
  expect.extend({
    toHaveASTNodes(sourceCode, nodeType, options = {}) {
      const { min = 1, message } = options;
      const nodes = findAll(sourceCode, nodeType);
      const pass = nodes.length >= min;
      return {
        pass,
        message: () => message
          || `Expected at least ${min} ${nodeType} node(s), but found ${nodes.length}.`,
      };
    },

    toHaveFunctionCall(sourceCode, functionName, options = {}) {
      const { message } = options;
      const calls = findFunctionCalls(sourceCode, functionName);
      return {
        pass: calls.length > 0,
        message: () => message || `Expected solution to call '${functionName}'.`,
      };
    },

    toHaveMethodCall(sourceCode, methodName, options = {}) {
      const { message } = options;
      const calls = findMethodCalls(sourceCode, methodName);
      return {
        pass: calls.length > 0,
        message: () => message || `Expected solution to call a '.${methodName}()' method.`,
      };
    },

    toHaveFunction(sourceCode, functionName, argCount, options = {}) {
      const { message } = options;
      const match = matchSignature(sourceCode, functionName, argCount);
      return {
        pass: match !== null,
        message: () => message
          || `Expected solution to define '${functionName}' with ${argCount} parameter(s).`,
      };
    },

    toPrintLines(actualLines, expectedLines, options = {}) {
      const { exact = true, message } = options;
      const pass = exact
        ? actualLines.length === expectedLines.length
          && expectedLines.every((line, i) => actualLines[i] === line)
        : expectedLines.every((line, i) => actualLines[i] === line);
      return {
        pass,
        message: () => message
          || `Expected output:\n  ${expectedLines.join('\n  ')}\nActual output:\n  ${actualLines.join('\n  ')}`,
      };
    },
  });
}

module.exports = {
  execSolution,
  findAll,
  findFunctionCalls,
  findMethodCalls,
  installMatchers,
  matchSignature,
  parseSource,
  walkAST,
};
