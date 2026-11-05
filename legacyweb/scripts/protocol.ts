import type {
  AssignmentKey,
  AssignmentProblemProgress,
  AssignmentActionResult,
  RunAssignmentActionResponse,
  GetWorkspaceResponse,
} from "../generated/codegrinder.js";

type WorkspaceFiles = GetWorkspaceResponse["studentOwnedFiles"];
type WorkspaceResponse = Omit<GetWorkspaceResponse, "assignment"> & {
  assignment: AssignmentKey;
};

interface WorkspaceProblem {
  readonly progress: AssignmentProblemProgress;
  workspace: WorkspaceResponse;
}

interface DaycareResponseCallbacks {
  files(files: Record<string, Uint8Array>): void;
  stderr(value: string): void;
  stdout(value: string): void;
}

interface ActionControls {
  actions: string[];
  grade: boolean;
  test: boolean;
}

type ActionResponses = AsyncIterable<RunAssignmentActionResponse> | Iterable<RunAssignmentActionResponse>;

const textDecoder = new TextDecoder("utf-8", { fatal: true });

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

function validateFileMapPaths(files: Readonly<Record<string, Uint8Array>>): void {
  for (const path of Object.keys(files)) {
    normalizeRelativePath(path);
  }
}

function workspaceState(
  workspace: GetWorkspaceResponse,
): WorkspaceResponse {
  if (!workspace.assignment) {
    throw new Error("Workspace response did not include its assignment key");
  }
  validateFileMapPaths(workspace.systemOwnedFiles);
  validateFileMapPaths(workspace.studentOwnedFiles);
  return {
    ...workspace,
    assignment: workspace.assignment,
  };
}

function localStudentFiles(
  problem: WorkspaceProblem,
  localFiles: Readonly<WorkspaceFiles>,
): WorkspaceFiles {
  const studentFiles: WorkspaceFiles = {};
  for (const [path, serverContent] of Object.entries(problem.workspace.studentOwnedFiles)) {
    studentFiles[path] = localFiles[path] ?? serverContent;
  }
  return studentFiles;
}

// Execution events update the local view; only the final result acknowledges persistence.
async function consumeActionResponses(
  responses: ActionResponses,
  callbacks: DaycareResponseCallbacks,
): Promise<AssignmentActionResult> {
  for await (const response of responses) {
    const responseBody = response.response;
    switch (responseBody.oneofKind) {
      case "result":
        return responseBody.result;
      case "event": {
        const event = responseBody.event;
        if (event.event === "stdout") {
          callbacks.stdout(textDecoder.decode(event.streamData));
        } else if (event.event === "stderr") {
          callbacks.stderr(textDecoder.decode(event.streamData));
        } else if (event.event === "error") {
          callbacks.stderr(`${event.error}\n`);
        } else if (event.event === "files") {
          validateFileMapPaths(event.files);
          callbacks.files(event.files);
        }
        break;
      }
      default:
        throw new Error("Unexpected execution response from the server");
    }
  }
  throw new Error("Server ended execution without a result");
}

export {
  actionButtonLabel,
  availableActionControls,
  consumeActionResponses,
  formatAssignmentKey,
  localStudentFiles,
  normalizeRelativePath,
  parseAssignmentKey,
  validateFileMapPaths,
  workspaceState,
};

export type {
  ActionControls,
  DaycareResponseCallbacks,
  ActionResponses,
  WorkspaceFiles,
  WorkspaceProblem,
  WorkspaceResponse,
};
