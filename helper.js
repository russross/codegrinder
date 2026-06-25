// Helper module to demonstrate require() functionality

function add(a, b) {
    return a + b;
}

function multiply(a, b) {
    return a * b;
}

function greet(name) {
    return `Hello, ${name}!`;
}

// Export the functions using CommonJS pattern
module.exports = {
    add,
    multiply,
    greet
};
