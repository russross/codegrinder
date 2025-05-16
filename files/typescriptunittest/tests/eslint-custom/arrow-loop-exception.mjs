export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require type annotations for variables except in for loops, arrow functions, and destructuring patterns"
    },
    schema: []
  },
  create(context) {
    return {
      VariableDeclaration(node) {
        if (node.parent && 
            (node.parent.type === "ForStatement" || 
             node.parent.type === "ForOfStatement" || 
             node.parent.type === "ForInStatement")) {
          return;
        }
        
        node.declarations.forEach(declaration => {
          if (!declaration.id || declaration.id.typeAnnotation || !declaration.init) {
            return;
          }
          
          if (declaration.init.type === "ArrowFunctionExpression") {
            return;
          }
          
          if (declaration.id.type === "ObjectPattern" || declaration.id.type === "ArrayPattern") {
            return;
          }
          
          context.report({
            node: declaration,
            message: "Variable '{{name}}' should have an explicit type annotation.",
            data: { name: declaration.id.name }
          });
        });
      }
    };
  }
};
