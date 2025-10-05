# Project Layout and Tools

This document provides a guide to the project layout and the tools used for development and building.

## Agent Instructions

After any code change, you **must** run `make`. This command will build the project and push the changes to the test server, allowing for immediate testing.

When researching and planning, prefer reading whole files over
isolated fragments.

## Critical Project Directives

- **Do Not Regress:** Under no circumstances should working code be removed or simplified to test UI mockups or for any other reason without explicit permission. The project must not regress.
- **gRPC Code is Sacred:** The gRPC setup, including the `.proto` file, generated client code, and data loading sequences, is critical to the application's function. Do not modify or delete any gRPC-related code without explicit permission.
- **gRPC Access Strategy:** All gRPC calls must use the `CodeGrinderServicePromiseClient` to ensure a consistent `async/await` pattern across the application.

## Project Layout

- `.pushed_to_exam`: This file is a marker created by the `make` command after successfully pushing changes to the test server.
- `index.html`: The main entry point of the application.
- `codegrinder_pb.js` and `codegrinder_grpc_web_pb.js`: These are JavaScript files generated from the protobuf definition. They contain the message classes and the gRPC-web client service.
- `rpc/codegrinder.proto`: The protobuf definition file that describes the gRPC services and messages.
- `Makefile`: Contains the build commands.
- `package.json`: Defines the project's dependencies and scripts.
- `webpack.config.js`: The configuration file for webpack, which is used to bundle the JavaScript files.
- `dist/bundle.js`: The final bundled JavaScript file that is included in `index.html`.
- `index.js`: The entry point for webpack, which imports and exports the protobuf modules.
- `RPC.md`: The gRPC message flows. Only message sequences defined
  in this spec document are allowed.
- `UI.md`: The UI spec.

## Tools

- **npm**: The Node Package Manager is used to manage the project's dependencies. To install the dependencies, run `npm install`.
- **webpack**: This project uses webpack to bundle the JavaScript files into a single file (`bundle.js`). The configuration is in `webpack.config.js`.
- **make**: The `make` command is used to trigger the build process. It reads the `Makefile` and executes the commands defined in it. To build the project, run `make`.
- **protoc**: The protobuf compiler is used to generate the JavaScript files from the `.proto` definition. The command to regenerate the files is in the `Makefile`.

## Debugging and Troubleshooting

This project went through a significant debugging and refactoring process. Here are the key takeaways to avoid repeating the same mistakes:

1.  **Build Process**: The initial `browserify` build process was brittle. Switching to **webpack** provided a more robust and configurable solution for managing dependencies and bundling the application.

2.  **Protobuf Generation**: The `protoc` command must be configured to generate code compatible with the chosen module system. For this project, we use `import_style=commonjs` to generate CommonJS modules that can be used with webpack. The default `closure` style is not compatible with a webpack build.

3.  **Webpack Configuration**:
    *   **Single Entry Point**: When bundling multiple generated files that might export variables with the same name, it is best to create a single entry point (e.g., `index.js`) that imports all the necessary modules and exports them as a single module. This avoids issues with overwritten exports.
    *   **Exposing a Library**: To make the bundled code accessible to inline scripts in `index.html`, the `output.library` and `output.libraryTarget` options in `webpack.config.js` are essential. This exposes the bundled module as a global variable (e.g., `window.codegrinder`).

4.  **gRPC-web Client/Server Interaction**:
    *   **Generic Errors**: The `RpcError: Error in parsing response body` is a generic error that often indicates the client is not receiving a valid gRPC-web response. This can be caused by server-side errors (which might return HTML error pages), network issues, or configuration mismatches.
    *   **Compression**: gRPC's per-message compression can be problematic for `grpc-web` clients. The client may fail to decompress the response, leading to the `Error in parsing response body` error. Disabling gzip compression on the server is a valid workaround. The recommended approach for production is to use a proxy like Envoy to handle compression at the HTTP level.

5.  **Debugging Strategy**:
    *   **Simplify**: When facing a complex issue, try to simplify the problem. For example, we switched from the authenticated `getUserMe` call to the unauthenticated `GetVersion` call to isolate the problem.
    *   **Inspect Server Code**: Understanding the server's configuration and code is crucial for debugging client-server communication issues.
    *   **Leverage Search**: Searching for error messages and library names can quickly lead to known issues, documentation, and solutions.

6.  **Read rpc/codegrinder.proto**:
    *   **Do not assume**: A common source of errors is making
        incorrect assumptions about the protocol messages and field
        names. Always check in rpc/codegrinder.proto or look at the
        generated files if more specific details are needed.

7.  **Protobuf Object Handling**:
    *   **Use Protobuf Objects Consistently**: Avoid converting protobuf message objects to plain JavaScript objects (using `.toObject()`) for use in application state. Mixing these two types of objects can lead to serialization errors (e.g., `f.serializeBinary is not a function`) when a function expects a full protobuf message object but receives a plain object.
    *   **Access Fields via Getters**: When working with a protobuf message object, always use the generated getter methods (e.g., `getFoo()`, `getBarMap()`, `getBazList()`) to access its fields. Do not access properties directly, as the internal structure is not guaranteed. For map fields, use methods like `getEntryList()` to get an array of key-value pairs or `has()` to check for a key's existence.
