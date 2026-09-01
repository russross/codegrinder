interface WorkerFileNode {
  content: string;
  fileType?: string;
  children?: never;
}

interface WorkerDirectoryNode {
  children: Record<string, WorkerWorkspaceNode>;
  collapsed: boolean;
  content?: never;
}

type WorkerWorkspaceNode = WorkerDirectoryNode | WorkerFileNode;

interface WorkerFileSystem {
  rootNode: WorkerDirectoryNode;
}

interface InitializeWorkerRequest {
  inputUrl: string;
  type: "initialize";
}

interface RunWorkerRequest {
  code: string;
  fileSystem: WorkerFileSystem;
  type: "run";
}

interface LoadPythonModulesRequest {
  modules: readonly string[];
  requestId: number;
  type: "loadModules";
}

type CommonWorkerRequest = InitializeWorkerRequest | RunWorkerRequest;
type PythonWorkerRequest = CommonWorkerRequest | LoadPythonModulesRequest;

interface LoadingWorkerEvent {
  status: string;
  type: "loading";
}

interface ReadyWorkerEvent {
  type: "ready";
}

interface OutputWorkerEvent {
  stream: "stderr" | "stdout";
  type: "output";
  value: string;
}

interface DisplayImageWorkerEvent {
  pngBase64: string;
  type: "displayImage";
}

interface FinishedWorkerEvent {
  type: "finished";
}

interface FailedWorkerEvent {
  message: string;
  type: "failed";
}

interface PythonModulesLoadedEvent {
  requestId: number;
  type: "modulesLoaded";
}

interface PythonModuleLoadFailedEvent {
  message: string;
  requestId: number;
  type: "moduleLoadFailed";
}

type WorkerEvent =
  | DisplayImageWorkerEvent
  | FailedWorkerEvent
  | FinishedWorkerEvent
  | LoadingWorkerEvent
  | OutputWorkerEvent
  | PythonModuleLoadFailedEvent
  | PythonModulesLoadedEvent
  | ReadyWorkerEvent;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWorkspaceNode(value: unknown): value is WorkerWorkspaceNode {
  if (!isRecord(value)) {
    return false;
  }
  if ("children" in value) {
    if (!isRecord(value.children) || typeof value.collapsed !== "boolean") {
      return false;
    }
    return Object.values(value.children).every(isWorkspaceNode);
  }
  return typeof value.content === "string"
    && (value.fileType === undefined || typeof value.fileType === "string");
}

function isWorkerFileSystem(value: unknown): value is WorkerFileSystem {
  return isRecord(value)
    && isWorkspaceNode(value.rootNode)
    && "children" in value.rootNode;
}

function isInitializeRequest(value: unknown): value is InitializeWorkerRequest {
  return isRecord(value) && value.type === "initialize" && typeof value.inputUrl === "string";
}

function isRunRequest(value: unknown): value is RunWorkerRequest {
  return isRecord(value)
    && value.type === "run"
    && typeof value.code === "string"
    && isWorkerFileSystem(value.fileSystem);
}

function isCommonWorkerRequest(value: unknown): value is CommonWorkerRequest {
  return isRecord(value) && (isInitializeRequest(value) || isRunRequest(value));
}

function isPythonWorkerRequest(value: unknown): value is PythonWorkerRequest {
  if (isCommonWorkerRequest(value)) {
    return true;
  }
  return isRecord(value)
    && value.type === "loadModules"
    && typeof value.requestId === "number"
    && Array.isArray(value.modules)
    && value.modules.every((moduleName) => typeof moduleName === "string");
}

function isWorkerEvent(value: unknown): value is WorkerEvent {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }
  switch (value.type) {
    case "displayImage":
      return typeof value.pngBase64 === "string";
    case "finished":
    case "ready":
      return true;
    case "failed":
      return typeof value.message === "string";
    case "loading":
      return typeof value.status === "string";
    case "moduleLoadFailed":
      return typeof value.message === "string" && typeof value.requestId === "number";
    case "modulesLoaded":
      return typeof value.requestId === "number";
    case "output":
      return (value.stream === "stderr" || value.stream === "stdout")
        && typeof value.value === "string";
    default:
      return false;
  }
}

export {
  isCommonWorkerRequest,
  isPythonWorkerRequest,
  isWorkerEvent,
};
export type {
  CommonWorkerRequest,
  DisplayImageWorkerEvent,
  FailedWorkerEvent,
  FinishedWorkerEvent,
  InitializeWorkerRequest,
  LoadingWorkerEvent,
  LoadPythonModulesRequest,
  OutputWorkerEvent,
  PythonModuleLoadFailedEvent,
  PythonModulesLoadedEvent,
  PythonWorkerRequest,
  ReadyWorkerEvent,
  RunWorkerRequest,
  WorkerEvent,
  WorkerDirectoryNode,
  WorkerFileSystem,
  WorkerWorkspaceNode,
};
