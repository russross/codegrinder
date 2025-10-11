# Project Guidelines

This document outlines the structure, build process, and general development guidelines for this project. It is intended to serve as a reference for all contributors.

## Project Structure

The project is a single-page application (SPA) built with TypeScript, Webpack, and gRPC-web. The core components are:

*   **`index.html`**: The main HTML file that serves as the entry point for the application.
*   **`index.ts`**: The primary TypeScript file that bootstraps the application.
*   **`style.css`**: Global styles for the application.
*   **`codegrinder.proto`**: Defines the gRPC service and message structures. This file is used to generate TypeScript code for gRPC-web.
*   **`codegrinder.ts`**: Generated TypeScript code from `codegrinder.proto`.
*   **`codegrinder.client.ts`**: Client-side gRPC-web implementation.
*   **`webpack.config.ts`**: Webpack configuration for building the project.
*   **`tsconfig.json`**: TypeScript configuration.
*   **`package.json`**: Project dependencies and scripts.
*   **`dist/`**: Output directory for the build process.

## Build Process

The project uses Webpack to bundle TypeScript and other assets. The `proto-gen.sh` script is responsible for generating gRPC-web client code from the `.proto` definition.

1.  **gRPC Code Generation**: Run `proto-gen.sh` to generate `codegrinder.ts` from `codegrinder.proto`.
2.  **Dependency Installation**: Install Node.js dependencies using `npm install`.
3.  **Build**: Compile TypeScript and bundle assets using Webpack. The build command is typically defined in `package.json` (e.g., `npm run build`).

## User Interface (UI)

The user interface is described in detail in `UI.md`. Key aspects include:

*   **Layout**: A three-pane layout with a file selection tree, a CodeMirror editor, and an information pane (with tabs for instructions and a terminal).
*   **Components**: Utilizes CodeMirror for the editor, xterm.js for the terminal, and split.js for pane resizing.
*   **Interactions**: Describes how users interact with file selection, editing, and action buttons.

## gRPC Message Flows

The application communicates with a gRPC backend. The message flows are documented in `RPC.md`. This includes:

*   **Initial Assignment Load**: Sequence for loading user and assignment data at application startup.
*   **Loading a Single Problem**: Details the steps for fetching problem-specific data and student progress.
*   **Advance to Next Step**: Logic for progressing through problem steps.
*   **Perform an Action**: Describes the process for handling user actions, including saving and grading.
*   **Daycare Interaction**: Explains the communication with the daycare server for code execution and assessment.

## Development Guidelines

To maintain code quality and consistency, please adhere to the following guidelines:

*   **Strict Typing**: Always use strict typing. Annotate function parameters and return types explicitly. Avoid `null` types where practical and refrain from using `any` or other type-system shortcuts. Strive for correctness and clarity in type definitions.
*   **Clean Builds**: Ensure that the project builds cleanly without any warnings or errors before considering a task complete or reporting success. This includes passing all linting and type-checking checks.
*   **Batch Changes**: Prefer reading entire files and making comprehensive changes in a single, large edit operation rather than numerous small reads and writes. This improves efficiency and reduces potential conflicts.
*   **No Placeholders/TODOs**: Do not leave placeholder comments or `TODO`s in the code. If a feature is incomplete, either implement it fully or use assertions or explicit error handling to draw attention to the incomplete state. Never silently swallow or ignore errors unless it is an explicit part of the specification.
*   **Code Style**: Follow existing code style and formatting conventions observed in the project. Use a linter and formatter if configured (e.g., Prettier, ESLint).
*   **Testing**: Write unit and integration tests for new features and bug fixes to ensure correctness and prevent regressions. Refer to existing test patterns in the project.
*   **Handling int64**: Protobuf `int64` and `uint64` types are represented as `bigint` in TypeScript to ensure precision. Be mindful of this when working with these values. When a `bigint` needs to be used with an API or a library that expects a `string` (e.g., for a URL parameter or a request field that is mapped to a string), explicitly convert it using `.toString()`.
