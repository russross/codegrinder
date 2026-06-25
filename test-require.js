// Test file demonstrating require() functionality

console.log("Testing require() functionality...\n");

// Load the helper module
const helper = require('/helper.js');

// Test the imported functions
console.log("Testing add function:");
console.log("helper.add(5, 3) =", helper.add(5, 3));

console.log("\nTesting multiply function:");
console.log("helper.multiply(4, 7) =", helper.multiply(4, 7));

console.log("\nTesting greet function:");
console.log(helper.greet("CodeGrinder"));

console.log("\nrequire() is working correctly!");
