import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
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
import { CodeGrinderServiceClient } from "../generated/codegrinder.client.js";
import { Timestamp } from "../generated/google/protobuf/timestamp.js";
import { createPrompt } from "./prompt.js";

const textDecoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();

function parseAssignmentKey(value) {
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

function formatAssignmentKey(assignment) {
  return `${assignment.userId}:${assignment.courseId}:${assignment.problemSetId}`;
}

function normalizeRelativePath(path) {
  if (path === "" || path.startsWith("/") || path.includes("\\")) {
    throw new Error(`Invalid workspace path ${JSON.stringify(path)}`);
  }
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Invalid workspace path ${JSON.stringify(path)}`);
  }
  return parts.join("/");
}

function decodeFileMap(files) {
  const decoded = {};
  for (const [rawPath, content] of Object.entries(files)) {
    const path = normalizeRelativePath(rawPath);
    try {
      decoded[path] = textDecoder.decode(content);
    } catch (error) {
      throw new Error(`Workspace file ${JSON.stringify(path)} is not UTF-8 text`, { cause: error });
    }
  }
  return decoded;
}

function encodeFileMap(files) {
  return Object.fromEntries(
    Object.entries(files).map(([path, content]) => [normalizeRelativePath(path), textEncoder.encode(content)]),
  );
}

function workspaceState(workspace, completed = false) {
  const systemFiles = decodeFileMap(workspace.systemOwnedFiles);
  const studentFiles = decodeFileMap(workspace.studentOwnedFiles);
  return {
    assignment: workspace.assignment,
    problemId: workspace.problemId,
    problemNote: workspace.problemNote,
    stepNumber: workspace.stepNumber,
    firstStepNumber: workspace.firstStepNumber,
    lastStepNumber: workspace.lastStepNumber,
    problemType: workspace.problemType,
    stepNote: workspace.stepNote,
    actions: [...workspace.actions].sort((left, right) => left.localeCompare(right)),
    systemFiles,
    studentFiles,
    files: { ...systemFiles, ...studentFiles },
    studentPaths: new Set(Object.keys(studentFiles)),
    completed,
  };
}

function copyWorkspaceState(target, source) {
  Object.assign(target, source);
  return target;
}

function localStudentFiles(problem, localFiles) {
  const studentFiles = {};
  for (const path of problem.studentPaths) {
    studentFiles[path] = localFiles[path] ?? problem.studentFiles[path];
  }
  return studentFiles;
}

function buildCommit(problem, action, note) {
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
    files: encodeFileMap(problem.studentFiles),
    createdAt: now,
    updatedAt: now,
  });
}

function assignmentsEqual(left, right) {
  return left?.userId === right?.userId
    && left?.courseId === right?.courseId
    && left?.problemSetId === right?.problemSetId;
}

function timestampHasPassed(timestamp) {
  if (!timestamp) {
    return false;
  }
  const seconds = BigInt(timestamp.seconds);
  return seconds * 1000n + BigInt(Math.floor(timestamp.nanos / 1_000_000)) <= BigInt(Date.now());
}

function saveStatusMessage(status, operation) {
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

class CodeGrinder {
  constructor(sessionKey = "", baseUrl = window.location.origin) {
    this.sessionKey = sessionKey ?? "";
    this.user = null;
    this.client = this.#createClient(baseUrl, "same-origin");
  }

  #createClient(baseUrl, credentials) {
    return new CodeGrinderServiceClient(
      new GrpcWebFetchTransport({ baseUrl, fetchInit: { credentials } }),
    );
  }

  #authOptions() {
    if (this.sessionKey === "") {
      throw new Error("You are not logged in");
    }
    return { meta: { authorization: `Bearer ${this.sessionKey}` } };
  }

  #rememberHello(hello) {
    if (hello.sessionKey !== "") {
      this.sessionKey = hello.sessionKey;
    }
    if (hello.userId === "" || this.sessionKey === "") {
      throw new Error("Hello did not return an authenticated session");
    }
    this.user = {
      id: hello.userId,
      name: hello.userName,
      login: hello.userLogin,
    };
    return this.user;
  }

  async login(token) {
    if (token.trim() === "") {
      throw new Error("A login token is required");
    }
    const call = await this.client.hello(HelloRequest.create({ token }), {});
    return this.#rememberHello(call.response);
  }

  async restoreSession() {
    if (this.sessionKey === "") {
      return null;
    }
    try {
      const call = await this.client.hello(HelloRequest.create({ token: "" }), this.#authOptions());
      return this.#rememberHello(call.response);
    } catch (error) {
      this.logout();
      throw error;
    }
  }

  logout() {
    this.sessionKey = "";
    this.user = null;
  }

  getMe() {
    return this.user;
  }

  async listAssignments() {
    const call = await this.client.listAssignments(
      ListAssignmentsRequest.create({ search: [], includeStudentContext: false }),
      this.#authOptions(),
    );
    return [...call.response.items].sort((left, right) => {
      const courseOrder = left.courseName.localeCompare(right.courseName);
      return courseOrder || left.assignmentTitle.localeCompare(right.assignmentTitle);
    });
  }

  async #getWorkspace(assignment, problemId, stepNumber, fileState) {
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

  async loadAssignment(key) {
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
      assignment,
      assignmentKey: formatAssignmentKey(assignment),
      courseName: response.courseName,
      problemSetNote: response.problemSetNote,
      problems,
      lockedForLms: timestampHasPassed(listItem?.lockAt),
    };
  }

  async #refreshProblem(problem, localFiles, fileState = WorkspaceFileState.CURRENT) {
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

  async sync(problem, localFiles) {
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

  async reset(problem) {
    return this.#refreshProblem(problem, null, WorkspaceFileState.STEP_START);
  }

  async #prepareAction(problem, localFiles, action) {
    await this.#refreshProblem(problem, localFiles);
    if (!problem.actions.includes(action)) {
      throw new Error(`Action ${JSON.stringify(action)} is not available for this step`);
    }
    const call = await this.client.saveUngradedCommit(
      SaveUngradedCommitRequest.create({
        commit: GradingCommit.create({
          hostname: "",
          userId: this.user?.id ?? "",
          commit: buildCommit(problem, action, `web ${action}`),
        }),
      }),
      this.#authOptions(),
    );
    if (!call.response.bundle || call.response.bundle.bundle.length === 0) {
      throw new Error("The server could not prepare a daycare runtime");
    }
    return call.response;
  }

  async #runDaycare(signedBundle, stdoutCallback, stderrCallback, fileCallback) {
    const runtime = RuntimeBundle.fromBinary(signedBundle.bundle);
    if (runtime.hostname === "") {
      throw new Error("The runtime bundle does not name a daycare host");
    }
    const daycare = this.#createClient(`${window.location.protocol}//${runtime.hostname}`, "omit");
    const call = daycare.daycare(DaycareRequest.create({ bundle: signedBundle, args: [] }), {});
    for await (const response of call.responses) {
      switch (response.response.oneofKind) {
        case "error":
          throw new Error(response.response.error);
        case "bundle":
          return response.response.bundle;
        case "event": {
          const event = response.response.event;
          if (event.event === "stdout") {
            stdoutCallback(textDecoder.decode(event.streamData));
          } else if (event.event === "stderr") {
            stderrCallback(textDecoder.decode(event.streamData));
          } else if (event.event === "error") {
            stderrCallback(`${event.error}\n`);
          } else if (event.event === "files") {
            fileCallback(decodeFileMap(event.files));
          }
          break;
        }
        default:
          break;
      }
    }
    throw new Error("Daycare ended without returning a signed runtime bundle");
  }

  #applyReturnedFiles(problem, files) {
    for (const [path, content] of Object.entries(files)) {
      if (!problem.studentPaths.has(path)) {
        continue;
      }
      problem.studentFiles[path] = content;
      problem.files[path] = content;
    }
  }

  async grade(problem, localFiles, stdoutCallback, stderrCallback) {
    const prepared = await this.#prepareAction(problem, localFiles, "grade");
    const finalBundle = await this.#runDaycare(
      prepared.bundle,
      stdoutCallback,
      stderrCallback,
      (files) => this.#applyReturnedFiles(problem, files),
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

  async action(problem, localFiles, action, stdoutCallback, stderrCallback) {
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

class CodeGrinderUI {
  constructor(navBar, codeGrinder, sessionHandler, assignmentHandler, errorHandler) {
    this.codeGrinder = codeGrinder;
    this.sessionHandler = sessionHandler;
    this.assignmentHandler = assignmentHandler;
    this.errorHandler = errorHandler;
    this.actionHandler = () => {};

    const controls = [
      ["Assignments", "buttonAssignments"],
      ["Problems", "buttonProblems"],
      ["Grade", "buttonGrade"],
      ["Sync", "buttonSync"],
      ["Reset", "buttonReset"],
      ["Action", "buttonAction"],
      ["Login", "buttonAuthenticator"],
    ];
    for (const [label, property] of controls) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.innerText = label;
      item.appendChild(button);
      navBar.appendChild(item);
      this[property] = button;
    }

    this.assignmentsList = document.createElement("ol");
    this.assignmentsList.classList.add("dropdown");
    this.buttonAssignments.parentElement.appendChild(this.assignmentsList);
    this.problemsList = document.createElement("ol");
    this.problemsList.classList.add("dropdown");
    this.buttonProblems.parentElement.appendChild(this.problemsList);

    this.buttonAuthenticator.addEventListener("click", () => this.#handleLogin());
    this.buttonAssignments.addEventListener("click", () => this.#showAssignments());
    this.buttonProblems.addEventListener("click", () => {
      this.problemsList.style.display = "block";
    });
    this.buttonAction.addEventListener("click", async () => {
      try {
        const actions = this.actions.filter((action) => action !== "grade");
        const response = await createPrompt(`Available actions: ${actions.join(", ")}`);
        const action = response?.trim() ?? "";
        if (action !== "") {
          await this.actionHandler(action);
        }
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
    this.actions = [];
    this.updateAuthenticationStatus();
  }

  async #handleLogin() {
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
    } catch (error) {
      this.errorHandler(error);
    } finally {
      this.buttonAuthenticator.disabled = false;
    }
  }

  async #showAssignments() {
    this.buttonAssignments.disabled = true;
    try {
      const assignments = await this.codeGrinder.listAssignments();
      this.assignmentsList.replaceChildren();
      for (const item of assignments) {
        if (!item.assignment) {
          continue;
        }
        const listItem = document.createElement("li");
        const button = document.createElement("button");
        button.innerText = `${item.courseName}: ${item.assignmentTitle}`;
        listItem.appendChild(button);
        this.assignmentsList.appendChild(listItem);
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            await this.assignmentHandler(await this.codeGrinder.loadAssignment(item.assignment));
          } catch (error) {
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
    } catch (error) {
      this.errorHandler(error);
    } finally {
      this.buttonAssignments.disabled = !this.codeGrinder.getMe();
    }
  }

  setActions(actions) {
    this.actions = [...actions];
    const hasInteractiveAction = actions.some((action) => action !== "grade");
    this.buttonAction.parentElement.hidden = !hasInteractiveAction;
    this.buttonAction.disabled = !hasInteractiveAction;
    this.buttonGrade.parentElement.hidden = !actions.includes("grade");
  }

  updateAuthenticationStatus() {
    const authenticated = Boolean(this.codeGrinder.getMe());
    this.buttonAuthenticator.innerText = authenticated ? "Logout" : "Login";
    this.buttonAssignments.disabled = !authenticated;
    this.buttonProblems.disabled = !authenticated;
    this.buttonGrade.disabled = !authenticated;
    this.buttonSync.disabled = !authenticated;
    this.buttonReset.disabled = !authenticated;
    this.buttonAction.disabled = !authenticated || !this.actions.some((action) => action !== "grade");
  }
}

export {
  CodeGrinder,
  CodeGrinderUI,
  CommitSaveStatus,
  formatAssignmentKey,
  normalizeRelativePath,
  parseAssignmentKey,
};
