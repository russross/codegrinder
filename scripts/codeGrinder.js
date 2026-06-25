import { decodeBase64ToUTF8OrLatin1 } from "./encodingHelpers.js";
import { createPrompt } from "./prompt.js";
// Hacky trampoline to get around cors in testing environment
function trampoline(url, options) {
  return fetch("/trampoline", {
    method: "POST",
    body: JSON.stringify({ url, options }),
    headers: {
      'Content-Type': "application/json"
    },
  })
}
class CodeGrinder {
  constructor(cookie, host = "codegrinder.russross.com") {
    this.host = host;
    this.cookie = cookie;
    this.urlPrefix = "";
  }
  #cookied(url, options) {
    if (!options) {
      options = {};
    }
    if (!options.headers) {
      options.headers = {};
    }
    options.headers.Cookie = this.cookie;
    if (location.hostname === this.host) {
      return fetch(url, options);
    } else {
      return trampoline(url, options);
    }
  }
  async #getObject(path) {
    const response = await this.#cookied("https://" + this.host + this.urlPrefix + path);
    if (response.status !== 200) {
      const text = await response.text();
      return null;
    } else {
      const json = await response.json();
      return json;
    }
  }
  async #postObject(path, data) {
    const response = await this.#cookied("https://" + this.host + this.urlPrefix + path, {
      method: "POST",
      body: JSON.stringify(data)
    });
    if (response.status !== 200) {
      const text = await response.text();
      return null;
    } else {
      const json = await response.json();
      return json;
    }
  }
  async login(key) {
    const json = await this.#getObject("/users/session?key=" + key);
    if (json) {
      this.cookie = json.cookie
    }
    return json;
  }
  // Use this to determine if the user is logged in.
  getMe() {
    return this.#getObject("/users/me");
  }
  getUserAssignments(id) {
    return this.#getObject("/users/" + id + "/assignments");
  }
  getAssignment(id) {
    return this.#getObject("/assignments/" + id);
  }
  getProblemSets() {
    return this.#getObject("/problem_sets");
  }
  getProblemSet(id) {
    return this.#getObject("/problem_sets/" + id);
  }
  getProblemTypes() {
    return this.#getObject("/problem_types");
  }
  getProblemType(typeName) {
    return this.#getObject("/problem_types/" + typeName);
  }
  getProblemSetProblems(id) {
    return this.#getObject("/problem_sets/" + id + "/problems");
  }
  getProblemSetProblem(problemSetId, id) {
    return this.#getObject("/problem_sets/" + problemSetId + "/problems/" + id);
  }
  getProblemSteps(id) {
    return this.#getObject("/problems/" + id + "/steps");
  }
  getProblemStep(problemId, step) {
    return this.#getObject("/problems/" + problemId + '/steps/' + step);
  }
  getProblem(id) {
    return this.#getObject("/problems/" + id);
  }
  getCourse(id) {
    return this.#getObject("/courses/" + id);
  }
  getLastCommit(assignmentId, problemId) {
    return this.#getObject("/assignments/" + assignmentId + "/problems/" + problemId + "/commits/last");
  }
  async nextStep(info, problem, commit, types) {
    // advance to the next step
    const newStep = await this.getProblemStep(problem.id, commit.step + 1);
    if (!newStep) {
      return null;
    }

    // gather all the files for the new step
    const files = {};
    if (commit) {
      for (const [name, contents] of Object.entries(commit.files)) {
        files[name] = decodeBase64ToUTF8OrLatin1(contents);
      }
    }

    // commit files may be overwritten by new step files
    for (const [name, contents] of Object.entries(newStep.files)) {
      files[name] = decodeBase64ToUTF8OrLatin1(contents);
    }
    files["doc/index.html"] = newStep.instructions;
    for (const [name, contents] of Object.entries(types[newStep.problemType].files)) {
      if (files[name] !== undefined) {
        console.log(`warning: problem type file is overwriting problem file: ${name}`);
      }
      files[name] = decodeBase64ToUTF8OrLatin1(contents);
    }
    info.step++;
    return files;
  }
  async gatherStudent(files, dotfile, problem_unique) {
    const now = new Date();
    // get the assignment
    //const assignment = await this.getAssignment(dotfile.assignmentID);
    const info = dotfile.problems[problem_unique];
    const step = await this.getProblemStep(info.id, info.step);
    //const problemType = await this.getProblemType(step.problemType);
    // gather the commit files from the file system
    const filtered_files = {};
    for (const name in step.whitelist) {
      filtered_files[name] = files[name];
    }

    // form a commit object
    const commit = {
      id: 0,
      assignmentID: dotfile.assignmentID,
      problemID: info.id,
      step: info.step,
      files: filtered_files,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    return commit;
  }
  mustConfirmCommitBundle(bundle, stdoutCallback, stderrCallback) {
    const url = `wss://${bundle.hostname}${this.urlPrefix}/sockets/${bundle.problemType.name}/${bundle.commit.action}`;
    const socket = new WebSocket(url);

    socket.onopen = () => {
      const req = {
        commitBundle: bundle
      };
      socket.send(JSON.stringify(req));
    };

    return new Promise((resolve, reject) => {
      socket.onmessage = (event) => {
        const reply = JSON.parse(event.data);
        console.log(reply);
        if (reply.error) {
          console.log("Server returned an error:");
          console.log(reply.error);
          reject(new Error(reply.error));
        } else if (reply.commitBundle) {
          resolve(reply.commitBundle);
        } else if (reply.event) {
          if (reply.event.event == "stdout") {
            stdoutCallback(decodeBase64ToUTF8OrLatin1(reply.event.streamData));
          } else if (reply.event.event == "stderr") {
            stderrCallback(decodeBase64ToUTF8OrLatin1(reply.event.streamData));
          } else if (reply.event.event == "exit") {
            // console.log("Exit Code: ", reply.event.event.exitStatus);
          } else {
            // exec events
            // console.log(reply.event);
          }
        } else {
          reject(new Error("Unexpected reply from server"));
        }
      };

      socket.onerror = (event) => {
        console.log("Socket error:", event);
        reject(new Error("Socket error"));
      };
    });
  }
  // See https://github.com/russross/codegrinder/blob/70d9a02cc8e3cf2868f19bb26e5b0b17304ccbc1/cli/get.go#L48C54-L48C54
  async commandGet(assignmentId) {
    const assignment = await this.getAssignment(assignmentId);
    // Codegrinder CMD called these functions but we don't use them
    // const course = await this.getCourse(assignment.courseID);
    // const problemSet = await this.getProblemSet(assignment.problemSetID);
    const problemSetProblems = await this.getProblemSetProblems(assignment.problemSetID);
    const commits = {};
    const infos = {};
    const problems = {};
    const steps = {};
    const types = {};
    for (let elt of problemSetProblems) {
      const problem = await this.getProblem(elt.problemID);
      problems[problem.unique] = problem;
      const info = {};
      const commit = await this.getLastCommit(assignment.id, problem.id);
      info.id = problem.id;
      if (commit) {
        info.step = commit.step;
      } else {
        info.step = 1;
      }
      const step = await this.getProblemStep(problem.id, info.step);
      infos[problem.unique] = info;
      commits[problem.unique] = commit;
      steps[problem.unique] = step;
      if (step.problemType !== "javascript") {
        console.warning("This only supports javascript problems not ", step.problemType)
      }
      if (!(step.problemType in types)) {
        types[step.problemType] = await this.getProblemType(step.problemType);
      }
    }
    const problemsFiles = {};
    const problemsWhitelist = {};
    const completed = new Set();
    for (let unique in steps) {
      const commit = commits[unique];
      const problem = problems[unique];
      const step = steps[unique];
      problemsFiles[unique] = {};
      problemsWhitelist[unique] = step.whitelist;
      const files = problemsFiles[unique];
      for (let name in step.files) {
        files[name] = decodeBase64ToUTF8OrLatin1(step.files[name]);
      }
      files["doc/index.html"] = step.instructions;

      if (commit !== null) {
        for (let name in commit.files) {
          files[name] = decodeBase64ToUTF8OrLatin1(commit.files[name]);
        }
      }

      for (let name in types[step.problemType].files) {
        if (files[name] !== undefined) {
          console.log("warning: problem type file is overwriting problem file: " + name);
        }
        files[name] = decodeBase64ToUTF8OrLatin1(types[step.problemType].files[name]);
      }
      if (commit?.reportCard?.passed && commit.score === 1.0) {
        const nextStepFiles = await this.nextStep(infos[unique], problem, commit, types);
        if (nextStepFiles) {
          problemsFiles[unique] = nextStepFiles;
        } else {
          completed.add(unique);
        }
      }
    }

    const dotFile = {
      assignmentID: assignment.id,
      problems: infos,
      completed,
    };
    return { problemsFiles, dotFile, problemsWhitelist };
  }
  async commandSync(user, files, dotfile, problem_unique) {
    const commit = await this.gatherStudent(files, dotfile, problem_unique);
    commit.action = "";
    commit.note = "web autosave";
    const unsigned = {
      userID: user.id,
      commit: commit,
    }

    // send the commit to the server
    const signed = await this.#postObject("/commit_bundles/unsigned", unsigned);
    // TODO: fix the server
    // this returns too much information: it returns the solution files
    // under problemSteps[0].solution with base64 encoding as usual
    // This was tested on a Testing Student canvas account. This be bad!
  }
  async commandReset(dotfile, problem_unique) {
    // gather all the files that make up this step
    const files = {};
    const currentStep = dotfile.problems[problem_unique].step;
    const assignmentID = dotfile.assignmentID;
    const problemID = dotfile.problems[problem_unique].id;
    const step = await this.getProblemStep(problemID, currentStep);
    // get the commit from the previous step if applicable
    if (currentStep > 1) {
      const commit = await this.#getObject(`/assignments/${assignmentID}/problems/${problemID}/steps/${currentStep - 1}/commits/last`);
      for (const name in commit.files) {
        files[name] = decodeBase64ToUTF8OrLatin1(commit.files[name]);
      }
    }

    // commit files may be overwritten by new step files
    for (const name in step.files) {
      files[name] = decodeBase64ToUTF8OrLatin1(step.files[name]);
    }
    files["doc/index.html"] = step.instructions;
    const problemType = await this.getProblemType(step.problemType);
    for (const name in problemType.files) {
      files[name] = decodeBase64ToUTF8OrLatin1(problemType.files[name]);
    }
    return files;
  }
  async commandGrade(user, files, dotfile, problem_unique, stdoutCallback, stderrCallback) {
    const commit = await this.gatherStudent(files, dotfile, problem_unique);
    commit.action = "grade";
    commit.note = "grind grade";
    const unsigned = {
      userID: user.id,
      commit: commit,
    }
    const signed = await this.#postObject("/commit_bundles/unsigned", unsigned);
    const graded = await this.mustConfirmCommitBundle(signed, stdoutCallback, stderrCallback);
    const toSave = {
      hostname: graded.hostname,
      userID: graded.userID,
      commit: graded.commit,
      commitSignature: graded.commitSignature
    }
    const saved = await this.#postObject("/commit_bundles/signed", toSave);
    const savedCommit = saved.commit;
    stdoutCallback(savedCommit.reportCard.note);
  }
}
class CodeGrinderUI {
  constructor(navBar, codeGrinder = new CodeGrinder("codegrinder=notloggedin"),
    authenticatorHandler = (cookie) => { },
    problemSetHandler = ({ problemsFiles, dotFile }) => { }) {
    this.codeGrinder = codeGrinder;
    const liAssignments = document.createElement("li");
    const liProblems = document.createElement("li");
    const liRunTests = document.createElement("li");
    const liGrade = document.createElement("li");
    const liSync = document.createElement("li");
    const liReset = document.createElement("li");
    const liAuthenticator = document.createElement("li");
    const liAction = document.createElement("li");
    navBar.appendChild(liAssignments);
    navBar.appendChild(liProblems);
    navBar.appendChild(liRunTests);
    navBar.appendChild(liGrade);
    navBar.appendChild(liSync);
    navBar.appendChild(liReset);
    navBar.appendChild(liAuthenticator);
    navBar.appendChild(liAction);
    this.buttonAssignments = document.createElement("button");
    this.buttonProblems = document.createElement("button");
    this.buttonRunTests = document.createElement("button");
    this.buttonGrade = document.createElement("button");
    this.buttonSync = document.createElement("button");
    this.buttonReset = document.createElement("button");
    this.buttonAuthenticator = document.createElement("button");
    this.buttonAction = document.createElement("button");
    liAssignments.appendChild(this.buttonAssignments);
    liProblems.appendChild(this.buttonProblems);
    liRunTests.appendChild(this.buttonRunTests);
    liGrade.appendChild(this.buttonGrade);
    liSync.appendChild(this.buttonSync);
    liReset.appendChild(this.buttonReset);
    liAuthenticator.appendChild(this.buttonAuthenticator);
    liAction.appendChild(this.buttonAction);
    this.buttonAssignments.innerText = "Assignments";
    this.buttonProblems.innerText = "Problems";
    this.buttonRunTests.innerText = "Test";
    this.buttonGrade.innerText = "Grade";
    this.buttonSync.innerText = "Sync";
    this.buttonReset.innerText = "Reset";
    this.buttonAction.innerText = "Action";

    this.authenticatorHandler = authenticatorHandler;
    this.problemSetHandler = problemSetHandler;
    this.me = this.codeGrinder.getMe();

    this.assignmentsList = document.createElement("ol");
    this.assignmentsList.classList.add("dropdown");
    liAssignments.appendChild(this.assignmentsList);

    this.problemsList = document.createElement("ol");
    this.problemsList.classList.add("dropdown");
    liProblems.appendChild(this.problemsList);

    this.buttonAuthenticator.addEventListener("click", async () => {
      let user = await this.me;
      if (user) {
        this.codeGrinder.cookie = undefined;
      } else {
        const parts = (await createPrompt("CodeGrinder login key")).trim().split(" ");
        this.buttonAuthenticator.disabled = true;
        await this.codeGrinder.login(parts[parts.length - 1]);
        this.buttonAuthenticator.disabled = false;
      }
      this.authenticatorHandler(this.codeGrinder.cookie);
      this.me = this.codeGrinder.getMe();
      await this.updateAuthenticationStatus();
    })
    this.buttonAssignments.addEventListener("click", async () => {
      const user = await this.me;
      if (!user) return;
      const assignments = await this.codeGrinder.getUserAssignments(user.id);
      this.assignmentsList.style.display = "block";
      this.assignmentsList.innerText = "";
      for (let assignment of assignments) {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.innerText = assignment.canvasTitle;
        li.appendChild(button);
        this.assignmentsList.appendChild(li);
        button.addEventListener("click", async () => {
          const info = await this.codeGrinder.commandGet(assignment.id);
          this.problemSetHandler(info);
        })
      }
    })
    this.buttonProblems.addEventListener("click", () => {
      this.problemsList.style.display = "block";
    })
    document.addEventListener("click", event => {
      if (event.target !== this.buttonProblems) {
        this.problemsList.style.display = "none";
      }
      if (event.target !== this.buttonAssignments) {
        this.assignmentsList.style.display = "none";
      }
    })
    this.updateAuthenticationStatus();
  }
  async updateAuthenticationStatus() {
    const user = await this.me;
    if (!user) {
      this.buttonAuthenticator.innerText = "Login";
    } else {
      this.buttonAuthenticator.innerText = "Logout";
    }
    this.buttonAssignments.disabled = !Boolean(user);
    this.buttonProblems.disabled = !Boolean(user);
    this.buttonRunTests.disabled = !Boolean(user);
    this.buttonGrade.disabled = !Boolean(user);
    this.buttonSync.disabled = !Boolean(user);
  }
}
export { CodeGrinder, CodeGrinderUI }
