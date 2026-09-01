import type {
  AssignmentKey,
  DaycareResponse,
  SignedRuntimeBundle,
} from "../generated/codegrinder.js";

interface DecodedFileMap {
  decoded: Record<string, string>;
  binary: Record<string, Uint8Array>;
}

interface DaycareResponseCallbacks {
  files(files: Record<string, string>): void;
  stderr(value: string): void;
  stdout(value: string): void;
}

interface ActionControls {
  actions: string[];
  grade: boolean;
  test: boolean;
}

type DaycareResponses = AsyncIterable<DaycareResponse> | Iterable<DaycareResponse>;

const textDecoder = new TextDecoder("utf-8", { fatal: true });
const binaryFileMessage = "This file contains binary data and cannot be displayed";

function parseAssignmentKey(value: string): AssignmentKey {
  const parts = value.split(":");
  if (parts.length !== 3 || parts.some((part) => part.trim() === "")) {
    throw new Error(`Invalid assignment key ${JSON.stringify(value)}`);
  }
  return {
    userId: parts[0],
    courseId: parts[1],
    problemSetId: parts[2],
  };
}

function formatAssignmentKey(assignment: AssignmentKey): string {
  return `${assignment.userId}:${assignment.courseId}:${assignment.problemSetId}`;
}

function normalizeRelativePath(path: string): string {
  if (path === "" || path.startsWith("/") || path.includes("\\")) {
    throw new Error(`Invalid workspace path ${JSON.stringify(path)}`);
  }
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Invalid workspace path ${JSON.stringify(path)}`);
  }
  return parts.join("/");
}

function availableActionControls(actions: Iterable<string>): ActionControls {
  const actionSet = new Set(actions);
  return {
    actions: [...actionSet].filter((action) => action !== "grade" && action !== "test"),
    grade: actionSet.has("grade"),
    test: actionSet.has("test"),
  };
}

function actionButtonLabel(action: string): string {
  return `${action.charAt(0).toUpperCase()}${action.slice(1)}`;
}

function decodeFileMap(
  files: Record<string, Uint8Array>,
): DecodedFileMap {
  const decoded: Record<string, string> = {};
  const binary: Record<string, Uint8Array> = {};
  for (const [rawPath, content] of Object.entries(files)) {
    const path = normalizeRelativePath(rawPath);
    try {
      decoded[path] = textDecoder.decode(content);
    } catch {
      decoded[path] = binaryFileMessage;
      binary[path] = content;
    }
  }
  return { decoded, binary };
}

async function consumeDaycareResponses(
  responses: DaycareResponses,
  callbacks: DaycareResponseCallbacks,
): Promise<SignedRuntimeBundle | null> {
  for await (const response of responses) {
    const responseBody = response.response;
    switch (responseBody.oneofKind) {
      case "error":
        throw new Error(responseBody.error);
      case "bundle":
        return responseBody.bundle;
      case "event": {
        const event = responseBody.event;
        if (event.event === "stdout") {
          callbacks.stdout(textDecoder.decode(event.streamData));
        } else if (event.event === "stderr") {
          callbacks.stderr(textDecoder.decode(event.streamData));
        } else if (event.event === "error") {
          callbacks.stderr(`${event.error}\n`);
        } else if (event.event === "files") {
          callbacks.files(decodeFileMap(event.files).decoded);
        }
        break;
      }
      default:
        break;
    }
  }
  return null;
}

export {
  actionButtonLabel,
  availableActionControls,
  consumeDaycareResponses,
  decodeFileMap,
  formatAssignmentKey,
  normalizeRelativePath,
  parseAssignmentKey,
};

export type { ActionControls, DaycareResponseCallbacks, DaycareResponses };
