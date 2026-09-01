import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import type { RpcOptions } from "@protobuf-ts/runtime-rpc";
import {
  AssignmentDownloadStatus,
  Commit,
  CommitSaveStatus,
  DaycareRequest,
  GetAssignmentRequest,
  GetWorkspaceRequest,
  GradingCommit,
  HelloRequest,
  ListAssignmentsRequest,
  RuntimeBundle,
  SaveGradedCommitRequest,
  SaveUngradedCommitRequest,
  SaveWorkspaceCommitRequest,
  WorkspaceFileState,
} from "../generated/codegrinder.js";
import type {
  AssignmentKey,
  AssignmentListItem,
  Commit as CommitMessage,
  GetAssignmentResponse,
  GetWorkspaceResponse,
  HelloResponse,
  SaveUngradedCommitResponse,
  SignedRuntimeBundle,
} from "../generated/codegrinder.js";
import { CodeGrinderServiceClient } from "../generated/codegrinder.client.js";
import { Timestamp } from "../generated/google/protobuf/timestamp.js";
import type { Timestamp as TimestampMessage } from "../generated/google/protobuf/timestamp.js";
import { createPrompt } from "./prompt.js";
import {
  actionButtonLabel,
  availableActionControls,
  consumeDaycareResponses,
  decodeFileMap,
  formatAssignmentKey,
  normalizeRelativePath,
  parseAssignmentKey,
} from "./protocol.js";

const textEncoder = new TextEncoder();

type TextFiles = Record<string, string>;
type BinaryFiles = Record<string, Uint8Array>;
type RenderInstructions = (files: Readonly<BinaryFiles>) => string;
type OutputCallback = (value: string) => void;
type FileCallback = (files: TextFiles) => void;

type WorkspaceProblem = GetWorkspaceResponse & {
  systemFiles: TextFiles;
  studentFiles: TextFiles;
  files: TextFiles;
  binaryFiles: BinaryFiles;
  internalFiles: Record<string, string>;
  studentPaths: Set<string>;
  completed: boolean;
};

type LoadedAssignment = Omit<GetAssignmentResponse, "assignment" | "problems"> & {
  assignment: AssignmentKey;
  assignmentKey: string;
  problems: WorkspaceProblem[];
  lockedForLms: boolean;
};

interface WorkspaceSaveResult {
  problem: WorkspaceProblem;
  saveStatus: CommitSaveStatus;
  message: string;
}

interface GradeResult extends WorkspaceSaveResult {
  passed: boolean;
  commit: CommitMessage;
}

type PreparedAction = SaveUngradedCommitResponse & {
  bundle: SignedRuntimeBundle;
};

type SessionHandler = (sessionKey: string) => void;
type AssignmentHandler = (assignment: LoadedAssignment) => void | Promise<void>;
type ErrorHandler = (error: unknown) => void;
type ActionHandler = (action: string) => void | Promise<void>;
type TestHandler = () => void | Promise<void>;

function workspaceState(
  workspace: GetWorkspaceResponse,
  renderInstructions: RenderInstructions,
  completed = false,
): WorkspaceProblem {
  const system = decodeFileMap(workspace.systemOwnedFiles);
  const student = decodeFileMap(workspace.studentOwnedFiles);
  const rawFiles = { ...workspace.systemOwnedFiles, ...workspace.studentOwnedFiles };
  return {
    ...workspace,
    actions: [...workspace.actions].sort((left, right) => left.localeCompare(right)),
    systemFiles: system.decoded,
    studentFiles: student.decoded,
    files: { ...system.decoded, ...student.decoded },
    binaryFiles: { ...system.binary, ...student.binary },
    internalFiles: { "doc.html": renderInstructions(rawFiles) },
    studentPaths: new Set(Object.keys(student.decoded)),
    completed,
  };
}

function copyWorkspaceState(target: WorkspaceProblem, source: WorkspaceProblem): WorkspaceProblem {
  Object.assign(target, source);
  return target;
}

function localStudentFiles(problem: WorkspaceProblem, localFiles: Readonly<TextFiles>): TextFiles {
  const studentFiles: TextFiles = {};
  for (const path of problem.studentPaths) {
    studentFiles[path] = localFiles[path] ?? problem.studentFiles[path];
  }
  return studentFiles;
}

function buildCommit(problem: WorkspaceProblem, action: string, note: string): CommitMessage {
  if (!problem.assignment) {
    throw new Error("Workspace response did not include its assignment key");
  }
  const now = Timestamp.fromDate(new Date());
  return Commit.create({
    assignment: problem.assignment,
    problemId: problem.problemId,
    step: problem.stepNumber,
    action,
    note,
    files: Object.fromEntries(Object.entries(problem.studentFiles).map(([path, content]) => [
      normalizeRelativePath(path),
      problem.binaryFiles[path] ?? textEncoder.encode(content),
    ])),
    createdAt: now,
    updatedAt: now,
  });
}

function assignmentsEqual(left: AssignmentKey | undefined, right: AssignmentKey | undefined): boolean {
  return left?.userId === right?.userId
    && left?.courseId === right?.courseId
    && left?.problemSetId === right?.problemSetId;
}

function timestampHasPassed(timestamp: TimestampMessage | undefined): boolean {
  if (!timestamp) {
    return false;
  }
  const seconds = BigInt(timestamp.seconds);
  return seconds * 1000n + BigInt(Math.floor(timestamp.nanos / 1_000_000)) <= BigInt(Date.now());
}

function saveStatusMessage(status: CommitSaveStatus, operation: string): string {
  if (status === CommitSaveStatus.SAVED) {
    return "";
  }
  if (status === CommitSaveStatus.NOT_SAVED_NOT_OWNER) {
    return `${operation} was not saved because you do not own this assignment`;
  }
  if (status === CommitSaveStatus.NOT_SAVED_LOCKED) {
    return `${operation} was not saved because the assignment is locked`;
  }
  return `${operation} returned an unknown save status`;
}

function requirePreparedAction(response: SaveUngradedCommitResponse): asserts response is PreparedAction {
  if (!response.bundle || response.bundle.bundle.length === 0) {
    throw new Error("The server could not prepare a daycare runtime");
  }
}

class CodeGrinder {
  sessionKey: string;
  private readonly client: CodeGrinderServiceClient;
  private readonly renderInstructions: RenderInstructions;
  private user: HelloResponse | null;

  constructor(
    sessionKey = "",
    baseUrl = window.location.origin,
    renderInstructions: RenderInstructions = () => "",
  ) {
    this.sessionKey = sessionKey ?? "";
    this.user = null;
    this.client = this.#createClient(baseUrl, "same-origin");
    this.renderInstructions = renderInstructions;
  }

  #createClient(baseUrl: string, credentials: RequestCredentials): CodeGrinderServiceClient {
    return new CodeGrinderServiceClient(
      new GrpcWebFetchTransport({ baseUrl, fetchInit: { credentials } }),
    );
  }

  #authOptions(): RpcOptions {
    if (this.sessionKey === "") {
      throw new Error("You are not logged in");
    }
    return { meta: { authorization: `Bearer ${this.sessionKey}` } };
  }

  #rememberHello(hello: HelloResponse): HelloResponse {
    if (hello.sessionKey !== "") {
      this.sessionKey = hello.sessionKey;
    }
    if (hello.userId === "" || this.sessionKey === "") {
      throw new Error("Hello did not return an authenticated session");
    }
    this.user = hello;
    return this.user;
  }

  async login(token: string): Promise<HelloResponse> {
    if (token.trim() === "") {
      throw new Error("A login token is required");
    }
    const call = await this.client.hello(HelloRequest.create({ token }), {});
    return this.#rememberHello(call.response);
  }

  async restoreSession(): Promise<HelloResponse | null> {
    if (this.sessionKey === "") {
      return null;
    }
    try {
      const call = await this.client.hello(HelloRequest.create({ token: "" }), this.#authOptions());
      return this.#rememberHello(call.response);
    } catch (error: unknown) {
      this.logout();
      throw error;
    }
  }

  logout(): void {
    this.sessionKey = "";
    this.user = null;
  }

  getMe(): HelloResponse | null {
    return this.user;
  }

  async listAssignments(): Promise<AssignmentListItem[]> {
    const call = await this.client.listAssignments(
      ListAssignmentsRequest.create({ search: [], includeStudentContext: false }),
      this.#authOptions(),
    );
    return [...call.response.items].sort((left, right) => {
      const courseOrder = left.courseName.localeCompare(right.courseName);
      return courseOrder || left.assignmentTitle.localeCompare(right.assignmentTitle);
    });
  }

  async #getWorkspace(
    assignment: AssignmentKey | undefined,
    problemId: string,
    stepNumber: string,
    fileState: WorkspaceFileState,
  ): Promise<WorkspaceProblem> {
    const call = await this.client.getWorkspace(
      GetWorkspaceRequest.create({
        assignment,
        problemId,
        stepNumber,
        fileState,
        includeContents: true,
        includeSolutionFiles: false,
      }),
      this.#authOptions(),
    );
    return workspaceState(call.response, this.renderInstructions);
  }

  async loadAssignment(key: string | AssignmentKey): Promise<LoadedAssignment> {
    const assignment = typeof key === "string" ? parseAssignmentKey(key) : key;
    const [assignmentCall, items] = await Promise.all([
      this.client.getAssignment(
        GetAssignmentRequest.create({ assignment }),
        this.#authOptions(),
      ),
      this.listAssignments(),
    ]);
    const response = assignmentCall.response;
    if (!response.assignment || !assignmentsEqual(response.assignment, assignment)) {
      throw new Error("GetAssignment returned the wrong assignment key");
    }
    if (response.downloadStatus !== AssignmentDownloadStatus.AVAILABLE) {
      if (response.downloadStatus === AssignmentDownloadStatus.NOT_OPEN) {
        throw new Error("This assignment is not open yet");
      }
      if (response.downloadStatus === AssignmentDownloadStatus.PREREQ_NOT_READY) {
        throw new Error(`Complete ${response.prerequisiteProblemSetId || "the prerequisite assignment"} first`);
      }
      throw new Error("This assignment is not available");
    }
    const problems = await Promise.all(response.problems.map(async (summary) => {
      const problem = await this.#getWorkspace(
        assignment,
        summary.problemId,
        "0",
        WorkspaceFileState.CURRENT,
      );
      problem.completed = summary.completed;
      return problem;
    }));
    if (problems.length === 0) {
      throw new Error("This assignment has no problems");
    }
    const listItem = items.find((item) => assignmentsEqual(item.assignment, assignment));
    return {
      ...response,
      assignment,
      assignmentKey: formatAssignmentKey(assignment),
      courseName: response.courseName,
      problemSetNote: response.problemSetNote,
      problems,
      lockedForLms: timestampHasPassed(listItem?.lockAt),
    };
  }

  async #refreshProblem(
    problem: WorkspaceProblem,
    localFiles: Readonly<TextFiles> | null,
    fileState: WorkspaceFileState = WorkspaceFileState.CURRENT,
  ): Promise<WorkspaceProblem> {
    const refreshed = await this.#getWorkspace(
      problem.assignment,
      problem.problemId,
      problem.stepNumber,
      fileState,
    );
    if (localFiles && fileState === WorkspaceFileState.CURRENT) {
      refreshed.studentFiles = localStudentFiles(refreshed, localFiles);
      refreshed.files = { ...refreshed.systemFiles, ...refreshed.studentFiles };
    }
    return copyWorkspaceState(problem, refreshed);
  }

  async sync(
    problem: WorkspaceProblem,
    localFiles: Readonly<TextFiles>,
  ): Promise<WorkspaceSaveResult> {
    await this.#refreshProblem(problem, localFiles);
    const call = await this.client.saveWorkspaceCommit(
      SaveWorkspaceCommitRequest.create({
        commit: buildCommit(problem, "", "web autosave"),
      }),
      this.#authOptions(),
    );
    return {
      problem,
      saveStatus: call.response.saveStatus,
      message: saveStatusMessage(call.response.saveStatus, "work"),
    };
  }

  async reset(problem: WorkspaceProblem): Promise<WorkspaceProblem> {
    return this.#refreshProblem(problem, null, WorkspaceFileState.STEP_START);
  }

  async #prepareAction(
    problem: WorkspaceProblem,
    localFiles: Readonly<TextFiles>,
    action: string,
  ): Promise<PreparedAction> {
    await this.#refreshProblem(problem, localFiles);
    if (!problem.actions.includes(action)) {
      throw new Error(`Action ${JSON.stringify(action)} is not available for this step`);
    }
    const call = await this.client.saveUngradedCommit(
      SaveUngradedCommitRequest.create({
        commit: GradingCommit.create({
          hostname: "",
          userId: this.user?.userId ?? "",
          commit: buildCommit(problem, action, `web ${action}`),
        }),
      }),
      this.#authOptions(),
    );
    const response = call.response;
    requirePreparedAction(response);
    return response;
  }

  async #runDaycare(
    signedBundle: SignedRuntimeBundle,
    stdoutCallback: OutputCallback,
    stderrCallback: OutputCallback,
    fileCallback: FileCallback,
  ): Promise<SignedRuntimeBundle | null> {
    const runtime = RuntimeBundle.fromBinary(signedBundle.bundle);
    if (runtime.hostname === "") {
      throw new Error("The runtime bundle does not name a daycare host");
    }
    const daycare = this.#createClient(`${window.location.protocol}//${runtime.hostname}`, "omit");
    const call = daycare.daycare(DaycareRequest.create({ bundle: signedBundle, args: [] }), {});
    return consumeDaycareResponses(call.responses, {
      files: fileCallback,
      stderr: stderrCallback,
      stdout: stdoutCallback,
    });
  }

  #applyReturnedFiles(problem: WorkspaceProblem, files: Readonly<TextFiles>): void {
    for (const [path, content] of Object.entries(files)) {
      if (!problem.studentPaths.has(path)) {
        continue;
      }
      problem.studentFiles[path] = content;
      problem.files[path] = content;
    }
  }

  async grade(
    problem: WorkspaceProblem,
    localFiles: Readonly<TextFiles>,
    stdoutCallback: OutputCallback,
    stderrCallback: OutputCallback,
  ): Promise<GradeResult> {
    const prepared = await this.#prepareAction(problem, localFiles, "grade");
    const finalBundle = await this.#runDaycare(
      prepared.bundle,
      stdoutCallback,
      stderrCallback,
      (files) => this.#applyReturnedFiles(problem, files),
    );
    if (finalBundle === null) {
      throw new Error("Daycare ended without returning a signed graded runtime bundle");
    }
    const runtime = RuntimeBundle.fromBinary(finalBundle.bundle);
    if (!runtime.commit) {
      throw new Error("Daycare returned no graded commit");
    }
    const saved = await this.client.saveGradedCommit(
      SaveGradedCommitRequest.create({ bundle: finalBundle }),
      this.#authOptions(),
    );
    const passed = runtime.commit.reportCard?.passed === true && runtime.commit.score === 1;
    if (passed && saved.response.saveStatus === CommitSaveStatus.SAVED) {
      if (BigInt(problem.stepNumber) < BigInt(problem.lastStepNumber)) {
        const next = await this.#getWorkspace(
          problem.assignment,
          problem.problemId,
          (BigInt(problem.stepNumber) + 1n).toString(),
          WorkspaceFileState.CURRENT,
        );
        copyWorkspaceState(problem, next);
      } else {
        problem.completed = true;
      }
    }
    return {
      problem,
      passed,
      commit: runtime.commit,
      saveStatus: saved.response.saveStatus,
      message: saveStatusMessage(saved.response.saveStatus, "grade"),
    };
  }

  async action(
    problem: WorkspaceProblem,
    localFiles: Readonly<TextFiles>,
    action: string,
    stdoutCallback: OutputCallback,
    stderrCallback: OutputCallback,
  ): Promise<WorkspaceSaveResult> {
    if (action === "grade") {
      throw new Error("Use Grade to submit work for grading");
    }
    const prepared = await this.#prepareAction(problem, localFiles, action);
    await this.#runDaycare(
      prepared.bundle,
      stdoutCallback,
      stderrCallback,
      (files) => this.#applyReturnedFiles(problem, files),
    );
    return {
      problem,
      saveStatus: prepared.saveStatus,
      message: saveStatusMessage(prepared.saveStatus, "work"),
    };
  }
}

interface NavigationControl {
  item: HTMLLIElement;
  button: HTMLButtonElement;
}

function appendNavigationControl(navBar: HTMLElement, label: string): NavigationControl {
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.innerText = label;
  item.appendChild(button);
  navBar.appendChild(item);
  return { item, button };
}

class CodeGrinderUI {
  actionHandler: ActionHandler;
  readonly assignmentsList: HTMLOListElement;
  readonly buttonAssignments: HTMLButtonElement;
  readonly buttonAuthenticator: HTMLButtonElement;
  readonly buttonGrade: HTMLButtonElement;
  readonly buttonProblems: HTMLButtonElement;
  readonly buttonReset: HTMLButtonElement;
  readonly buttonSync: HTMLButtonElement;
  readonly buttonTest: HTMLButtonElement;
  readonly problemsList: HTMLOListElement;
  testHandler: TestHandler;

  private readonly actionButtons = new Map<string, NavigationControl>();
  private actions: string[] = [];
  private readonly assignmentHandler: AssignmentHandler;
  private readonly codeGrinder: CodeGrinder;
  private readonly errorHandler: ErrorHandler;
  private readonly navBar: HTMLElement;
  private readonly sessionHandler: SessionHandler;

  constructor(
    navBar: HTMLElement,
    codeGrinder: CodeGrinder,
    sessionHandler: SessionHandler,
    assignmentHandler: AssignmentHandler,
    errorHandler: ErrorHandler,
  ) {
    this.codeGrinder = codeGrinder;
    this.sessionHandler = sessionHandler;
    this.assignmentHandler = assignmentHandler;
    this.errorHandler = errorHandler;
    this.actionHandler = () => {};
    this.testHandler = () => {};
    this.navBar = navBar;

    const assignmentsControl = appendNavigationControl(navBar, "Assignments");
    const problemsControl = appendNavigationControl(navBar, "Problems");
    const testControl = appendNavigationControl(navBar, "Test");
    const gradeControl = appendNavigationControl(navBar, "Grade");
    const syncControl = appendNavigationControl(navBar, "Sync");
    const resetControl = appendNavigationControl(navBar, "Reset");
    const authenticatorControl = appendNavigationControl(navBar, "Login");
    this.buttonAssignments = assignmentsControl.button;
    this.buttonProblems = problemsControl.button;
    this.buttonTest = testControl.button;
    this.buttonGrade = gradeControl.button;
    this.buttonSync = syncControl.button;
    this.buttonReset = resetControl.button;
    this.buttonAuthenticator = authenticatorControl.button;

    this.assignmentsList = document.createElement("ol");
    this.assignmentsList.classList.add("dropdown");
    assignmentsControl.item.appendChild(this.assignmentsList);
    this.problemsList = document.createElement("ol");
    this.problemsList.classList.add("dropdown");
    problemsControl.item.appendChild(this.problemsList);

    this.buttonAuthenticator.addEventListener("click", () => this.#handleLogin());
    this.buttonAssignments.addEventListener("click", () => this.#showAssignments());
    this.buttonProblems.addEventListener("click", () => {
      this.problemsList.style.display = "block";
    });
    this.buttonTest.addEventListener("click", async () => {
      try {
        await this.testHandler();
      } catch (error) {
        this.errorHandler(error);
      }
    });
    document.addEventListener("click", (event) => {
      if (event.target !== this.buttonProblems) {
        this.problemsList.style.display = "none";
      }
      if (event.target !== this.buttonAssignments) {
        this.assignmentsList.style.display = "none";
      }
    });
    this.setActions([]);
    this.updateAuthenticationStatus();
  }

  async #handleLogin(): Promise<void> {
    this.buttonAuthenticator.disabled = true;
    try {
      if (this.codeGrinder.getMe()) {
        this.codeGrinder.logout();
      } else {
        const response = await createPrompt("CodeGrinder login token");
        if (response === null) {
          return;
        }
        const token = response.trim().split(/\s+/).at(-1);
        await this.codeGrinder.login(token ?? "");
      }
      this.sessionHandler(this.codeGrinder.sessionKey);
      this.updateAuthenticationStatus();
    } catch (error: unknown) {
      this.errorHandler(error);
    } finally {
      this.buttonAuthenticator.disabled = false;
    }
  }

  async #showAssignments(): Promise<void> {
    this.buttonAssignments.disabled = true;
    try {
      const assignments = await this.codeGrinder.listAssignments();
      this.assignmentsList.replaceChildren();
      for (const item of assignments) {
        if (!item.assignment) {
          continue;
        }
        const assignment = item.assignment;
        const listItem = document.createElement("li");
        const button = document.createElement("button");
        button.innerText = `${item.courseName}: ${item.assignmentTitle}`;
        listItem.appendChild(button);
        this.assignmentsList.appendChild(listItem);
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            await this.assignmentHandler(await this.codeGrinder.loadAssignment(assignment));
          } catch (error: unknown) {
            this.errorHandler(error);
          } finally {
            button.disabled = false;
          }
        });
      }
      if (this.assignmentsList.children.length === 0) {
        const message = document.createElement("li");
        message.innerText = "Launch an assignment from Canvas before opening it here.";
        this.assignmentsList.appendChild(message);
      }
      this.assignmentsList.style.display = "block";
    } catch (error: unknown) {
      this.errorHandler(error);
    } finally {
      this.buttonAssignments.disabled = !this.codeGrinder.getMe();
    }
  }

  setActions(actions: Iterable<string>): void {
    this.actions = [...actions];
    const controls = availableActionControls(actions);
    this.buttonTest.parentElement!.hidden = !controls.test;
    this.buttonTest.disabled = !controls.test || !this.codeGrinder.getMe();
    this.buttonGrade.parentElement!.hidden = !controls.grade;
    for (const { item } of this.actionButtons.values()) {
      item.remove();
    }
    this.actionButtons.clear();
    for (const action of controls.actions) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.innerText = actionButtonLabel(action);
      button.disabled = !this.codeGrinder.getMe();
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await this.actionHandler(action);
        } catch (error: unknown) {
          this.errorHandler(error);
        } finally {
          button.disabled = !this.codeGrinder.getMe();
        }
      });
      item.appendChild(button);
      this.navBar.appendChild(item);
      this.actionButtons.set(action, { item, button });
    }
  }

  updateAuthenticationStatus(): void {
    const authenticated = Boolean(this.codeGrinder.getMe());
    this.buttonAuthenticator.innerText = authenticated ? "Logout" : "Login";
    this.buttonAssignments.disabled = !authenticated;
    this.buttonProblems.disabled = !authenticated;
    this.buttonTest.disabled = !authenticated || !this.actions.includes("test");
    this.buttonGrade.disabled = !authenticated;
    this.buttonSync.disabled = !authenticated;
    this.buttonReset.disabled = !authenticated;
    for (const { button } of this.actionButtons.values()) {
      button.disabled = !authenticated;
    }
  }
}

export {
  actionButtonLabel,
  availableActionControls,
  CodeGrinder,
  CodeGrinderUI,
  CommitSaveStatus,
  consumeDaycareResponses,
  formatAssignmentKey,
  normalizeRelativePath,
  parseAssignmentKey,
};

export type {
  GradeResult,
  LoadedAssignment,
  TextFiles,
  WorkspaceProblem,
  WorkspaceSaveResult,
};
