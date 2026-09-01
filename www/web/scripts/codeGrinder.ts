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
  AssignmentProblemProgress,
  Commit as CommitMessage,
  GetAssignmentResponse,
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
  consumeGradingDaycareResponses,
  consumeInteractiveDaycareResponses,
  formatAssignmentKey,
  localStudentFiles,
  normalizeRelativePath,
  parseAssignmentKey,
  workspaceState,
} from "./protocol.js";
import type {
  DaycareResponses,
  WorkspaceFiles,
  WorkspaceProblem,
  WorkspaceResponse,
} from "./protocol.js";

type AssignmentListEntry = AssignmentListItem & { assignment: AssignmentKey };
type OutputCallback = (value: string) => void;

type AssignmentResponse = GetAssignmentResponse & { assignment: AssignmentKey };

interface LoadedAssignment {
  readonly lockedForLms: boolean;
  readonly response: AssignmentResponse;
}

interface WorkspaceSaveResult {
  problem: WorkspaceProblem;
  saveStatus: CommitSaveStatus;
  message: string;
}

interface GradeResult extends WorkspaceSaveResult {
  completed: boolean;
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

type SessionState =
  | { readonly kind: "anonymous" }
  | { readonly kind: "authenticated"; readonly hello: HelloResponse; readonly sessionKey: string }
  | { readonly kind: "stored"; readonly sessionKey: string };

function buildCommit(problem: WorkspaceProblem, action: string, note: string): CommitMessage {
  const workspace = problem.workspace;
  const now = Timestamp.fromDate(new Date());
  return Commit.create({
    assignment: workspace.assignment,
    problemId: workspace.problemId,
    step: workspace.stepNumber,
    action,
    note,
    files: Object.fromEntries(Object.entries(workspace.studentOwnedFiles).map(([path, content]) => [
      normalizeRelativePath(path),
      content,
    ])),
    createdAt: now,
    updatedAt: now,
  });
}

function assignmentsEqual(left: AssignmentKey, right: AssignmentKey): boolean {
  return left.userId === right.userId
    && left.courseId === right.courseId
    && left.problemSetId === right.problemSetId;
}

function requireAssignmentKey<T extends { assignment?: AssignmentKey }>(
  message: T,
): asserts message is T & { assignment: AssignmentKey } {
  if (!message.assignment) {
    throw new Error("Server response did not include its assignment key");
  }
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
  private readonly client: CodeGrinderServiceClient;
  private session: SessionState;

  constructor(
    sessionKey = "",
    baseUrl = window.location.origin,
  ) {
    this.session = sessionKey === ""
      ? { kind: "anonymous" }
      : { kind: "stored", sessionKey };
    this.client = this.#createClient(baseUrl, "same-origin");
  }

  get authenticated(): boolean {
    return this.session.kind === "authenticated";
  }

  get sessionKey(): string {
    return this.session.kind === "anonymous" ? "" : this.session.sessionKey;
  }

  #createClient(baseUrl: string, credentials: RequestCredentials): CodeGrinderServiceClient {
    return new CodeGrinderServiceClient(
      new GrpcWebFetchTransport({ baseUrl, fetchInit: { credentials } }),
    );
  }

  #authOptions(): RpcOptions {
    if (this.session.kind !== "authenticated") {
      throw new Error("You are not logged in");
    }
    return { meta: { authorization: `Bearer ${this.session.sessionKey}` } };
  }

  #storedSessionOptions(): RpcOptions {
    if (this.session.kind === "anonymous") {
      throw new Error("There is no stored session to restore");
    }
    return { meta: { authorization: `Bearer ${this.session.sessionKey}` } };
  }

  #rememberHello(hello: HelloResponse): HelloResponse {
    const sessionKey = hello.sessionKey === "" ? this.sessionKey : hello.sessionKey;
    if (hello.userId === "" || sessionKey === "") {
      throw new Error("Hello did not return an authenticated session");
    }
    this.session = { hello, kind: "authenticated", sessionKey };
    return hello;
  }

  async login(token: string): Promise<HelloResponse> {
    if (token.trim() === "") {
      throw new Error("A login token is required");
    }
    const call = await this.client.hello(HelloRequest.create({ token }), {});
    return this.#rememberHello(call.response);
  }

  async restoreSession(): Promise<HelloResponse> {
    try {
      const call = await this.client.hello(
        HelloRequest.create({ token: "" }),
        this.#storedSessionOptions(),
      );
      return this.#rememberHello(call.response);
    } catch (error: unknown) {
      this.logout();
      throw error;
    }
  }

  logout(): void {
    this.session = { kind: "anonymous" };
  }

  getMe(): HelloResponse {
    if (this.session.kind !== "authenticated") {
      throw new Error("You are not logged in");
    }
    return this.session.hello;
  }

  async listAssignments(): Promise<AssignmentListEntry[]> {
    const call = await this.client.listAssignments(
      ListAssignmentsRequest.create({ search: [], includeStudentContext: false }),
      this.#authOptions(),
    );
    const items = call.response.items.map((item) => {
      requireAssignmentKey(item);
      return item;
    });
    return items.sort((left, right) => {
      const courseOrder = left.courseName.localeCompare(right.courseName);
      return courseOrder || left.assignmentTitle.localeCompare(right.assignmentTitle);
    });
  }

  async #getWorkspace(
    assignment: AssignmentKey,
    problemId: string,
    stepNumber: string,
    fileState: WorkspaceFileState,
  ): Promise<WorkspaceResponse> {
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
    return workspaceState(call.response);
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
    requireAssignmentKey(response);
    if (!assignmentsEqual(response.assignment, assignment)) {
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
    if (response.problems.length === 0) {
      throw new Error("This assignment has no problems");
    }
    const listItem = items.find((item) => assignmentsEqual(item.assignment, assignment));
    return {
      lockedForLms: timestampHasPassed(listItem?.lockAt),
      response,
    };
  }

  async loadProblem(
    assignment: LoadedAssignment,
    progress: AssignmentProblemProgress,
  ): Promise<WorkspaceProblem> {
    const workspace = await this.#getWorkspace(
      assignment.response.assignment,
      progress.problemId,
      "0",
      WorkspaceFileState.CURRENT,
    );
    if (workspace.problemId !== progress.problemId) {
      throw new Error("GetWorkspace returned the wrong problem");
    }
    return { progress, workspace };
  }

  async #refreshProblem(
    problem: WorkspaceProblem,
    localFiles: Readonly<WorkspaceFiles>,
  ): Promise<WorkspaceProblem> {
    const workspace = problem.workspace;
    const refreshed = await this.#getWorkspace(
      workspace.assignment,
      workspace.problemId,
      workspace.stepNumber,
      WorkspaceFileState.CURRENT,
    );
    refreshed.studentOwnedFiles = localStudentFiles(problem, localFiles);
    problem.workspace = refreshed;
    return problem;
  }

  async sync(
    problem: WorkspaceProblem,
    localFiles: Readonly<WorkspaceFiles>,
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
    const workspace = problem.workspace;
    problem.workspace = await this.#getWorkspace(
      workspace.assignment,
      workspace.problemId,
      workspace.stepNumber,
      WorkspaceFileState.STEP_START,
    );
    return problem;
  }

  async #prepareAction(
    problem: WorkspaceProblem,
    localFiles: Readonly<WorkspaceFiles>,
    action: string,
  ): Promise<PreparedAction> {
    await this.#refreshProblem(problem, localFiles);
    if (!problem.workspace.actions.includes(action)) {
      throw new Error(`Action ${JSON.stringify(action)} is not available for this step`);
    }
    const call = await this.client.saveUngradedCommit(
      SaveUngradedCommitRequest.create({
        commit: GradingCommit.create({
          hostname: "",
          userId: this.getMe().userId,
          commit: buildCommit(problem, action, `web ${action}`),
        }),
      }),
      this.#authOptions(),
    );
    const response = call.response;
    requirePreparedAction(response);
    return response;
  }

  #startDaycare(
    signedBundle: SignedRuntimeBundle,
  ): DaycareResponses {
    const runtime = RuntimeBundle.fromBinary(signedBundle.bundle);
    if (runtime.hostname === "") {
      throw new Error("The runtime bundle does not name a daycare host");
    }
    const daycare = this.#createClient(`${window.location.protocol}//${runtime.hostname}`, "omit");
    const call = daycare.daycare(DaycareRequest.create({ bundle: signedBundle, args: [] }), {});
    return call.responses;
  }

  #applyReturnedFiles(problem: WorkspaceProblem, files: Readonly<WorkspaceFiles>): void {
    const studentFiles = problem.workspace.studentOwnedFiles;
    for (const [path, content] of Object.entries(files)) {
      if (!Object.hasOwn(studentFiles, path)) {
        continue;
      }
      studentFiles[path] = content;
    }
  }

  async grade(
    problem: WorkspaceProblem,
    localFiles: Readonly<WorkspaceFiles>,
    stdoutCallback: OutputCallback,
    stderrCallback: OutputCallback,
  ): Promise<GradeResult> {
    const prepared = await this.#prepareAction(problem, localFiles, "grade");
    const finalBundle = await consumeGradingDaycareResponses(
      this.#startDaycare(prepared.bundle),
      {
        files: (files) => this.#applyReturnedFiles(problem, files),
        stderr: stderrCallback,
        stdout: stdoutCallback,
      },
    );
    const runtime = RuntimeBundle.fromBinary(finalBundle.bundle);
    if (!runtime.commit) {
      throw new Error("Daycare returned no graded commit");
    }
    const saved = await this.client.saveGradedCommit(
      SaveGradedCommitRequest.create({ bundle: finalBundle }),
      this.#authOptions(),
    );
    const passed = runtime.commit.reportCard?.passed === true && runtime.commit.score === 1;
    let completed = problem.progress.completed;
    if (passed && saved.response.saveStatus === CommitSaveStatus.SAVED) {
      const workspace = problem.workspace;
      if (BigInt(workspace.stepNumber) < BigInt(workspace.lastStepNumber)) {
        const next = await this.#getWorkspace(
          workspace.assignment,
          workspace.problemId,
          (BigInt(workspace.stepNumber) + 1n).toString(),
          WorkspaceFileState.CURRENT,
        );
        problem.workspace = next;
      } else {
        completed = true;
      }
    }
    return {
      problem,
      completed,
      passed,
      commit: runtime.commit,
      saveStatus: saved.response.saveStatus,
      message: saveStatusMessage(saved.response.saveStatus, "grade"),
    };
  }

  async action(
    problem: WorkspaceProblem,
    localFiles: Readonly<WorkspaceFiles>,
    action: string,
    stdoutCallback: OutputCallback,
    stderrCallback: OutputCallback,
  ): Promise<WorkspaceSaveResult> {
    if (action === "grade") {
      throw new Error("Use Grade to submit work for grading");
    }
    const prepared = await this.#prepareAction(problem, localFiles, action);
    await consumeInteractiveDaycareResponses(
      this.#startDaycare(prepared.bundle),
      {
        files: (files) => this.#applyReturnedFiles(problem, files),
        stderr: stderrCallback,
        stdout: stdoutCallback,
      },
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

function requireParent(element: HTMLElement): HTMLElement {
  const parent = element.parentElement;
  if (parent === null) {
    throw new Error("Navigation control is not attached to its list item");
  }
  return parent;
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
      if (this.codeGrinder.authenticated) {
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
      this.buttonAssignments.disabled = !this.codeGrinder.authenticated;
    }
  }

  setActions(actions: Iterable<string>): void {
    this.actions = [...actions];
    const controls = availableActionControls(actions);
    requireParent(this.buttonTest).hidden = !controls.test;
    this.buttonTest.disabled = !controls.test || !this.codeGrinder.authenticated;
    requireParent(this.buttonGrade).hidden = !controls.grade;
    for (const { item } of this.actionButtons.values()) {
      item.remove();
    }
    this.actionButtons.clear();
    for (const action of controls.actions) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.innerText = actionButtonLabel(action);
      button.disabled = !this.codeGrinder.authenticated;
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await this.actionHandler(action);
        } catch (error: unknown) {
          this.errorHandler(error);
        } finally {
          button.disabled = !this.codeGrinder.authenticated;
        }
      });
      item.appendChild(button);
      this.navBar.appendChild(item);
      this.actionButtons.set(action, { item, button });
    }
  }

  updateAuthenticationStatus(): void {
    const authenticated = this.codeGrinder.authenticated;
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
  consumeGradingDaycareResponses,
  consumeInteractiveDaycareResponses,
  formatAssignmentKey,
  localStudentFiles,
  normalizeRelativePath,
  parseAssignmentKey,
  workspaceState,
};

export type {
  GradeResult,
  LoadedAssignment,
  WorkspaceProblem,
  WorkspaceFiles,
  WorkspaceSaveResult,
};
