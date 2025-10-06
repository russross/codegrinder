gRPC message sequences
======================

See `codegrinder.proto`, which defines the gRPC protocol. This
document uses the protocol definition names; you must translate
naming conventions to what JavaScript gRPC-web expects to use these.

Most requests have a `session_cookie`. This is always filled in with
the main session cookie loaded from the initial request, and must
include the `codegrinder=` prefix. The following will omit mention
of the cookie.

All messages are encoded with binary encoding but without
compression.

These are the messages flows used in this app.


Initial assignment load ("loadAssignment" operation)
----------------------------------------------------

This sequence happens at app load time and these objects are kept
around for the duration of the session.

The app centers around a single student assignment, which links the
student to the problem set that the student must work on.

A problem set is composed of one or more problems, but loading them
is part of a different sequence.

1.  `GetUserMe`: responds with a `User` object in the field `user`

2.  `GetAssignment`: request requires `assignment_id`, which comes
    from the `assignment=` URL paramater of the initial page load.
    responds with an `Assignment` object in the field `assignment`

    *   `user_id` from the `Assignment` must match `id` from the
        `User` object or it is a fatal error.

3.  `GetProblemSetProblems`: request requires `problem_set_id`,
    which comes from the `problem_set_id` field in the `Assignment`.
    responds with a list field of `ProblemSetProblem`
    objects in the repeated field `problem_set_problems`.

4.  Create a catalog of `ProblemType` objects to be filled in
    lazily. This is a map where The key is the `name` field of the
    `ProblemType` object and the value is the `ProblemType` object
    itself.

Next, each `ProblemSetProblem` object has a `problem_id` field,
which we use in the "Loading a single problem" sequence below to get
problem data


Loading a single problem ("loadProblem" operation)
--------------------------------------------------

This sequence is repeated for each problem identified as part of the
problem set in the "Initial assignment load" sequence.

A problem can have one or more `ProblemStep`s, which are numbered
using 1-based numbering.

If the student has already made progress on the problem there will
be a `Commit` object that holds the student's work and an indication
of their current progress.

1.  `GetProblem`: request requires `problem_id`, which comes from
    the `ProblemSetProblem` object. response has a `Problem` object
    in the field `problem`.

2.  `GetAssignmentProblemCommitLast`: request requires the same
    `assignment_id` that was used to fetch the `Assignment` and the
    `problem_id` used to fetch the `Problem`. responds with a
    `Commit` called `commit`, but it is normal and acceptable for
    the request to fail because no such commit exists.

3.  `GetProblemStep`: request requires the same `problem_id` that
    was used to fetch the `Problem` and also a `step`. If a `Commit`
    was found for the problem then `step` comes from the `step`
    field in the `Commit`, but if no `Commit` was found then `step`
    defaults to 1. responds with a `ProblemStep` object in the field
    `problem_step`.

4.  If the `ProblemStep` field `problem_type` (a string) is missing
    as a key in the `ProblemType` catalog, fetch the `ProblemType`
    using `GetProblemType` and then add it to the catalog. request
    requires `name`, which comes from the `problem_type` field in
    the `ProblemStep`. responds with a `ProblemType` object to be
    added to the catalog.

5.  Build a merged set of files as a map of strings (file paths) to
    files (blob of file data).

    * Start with the `files` field of the `ProblemStep` which is a
      `map<string, bytes>`
    * If there was a `Commit` object, merge its `files` field, which
      is also a `map<string, bytes>`. If there is a duplicate file
      path, the one from the `Commit` replaces the one from the
      `ProblemStep`.

6.  If all of the following are true, execute the "Advance to next
    step" sequence detailed below:

    * A `Commit` object was found
    * The `Commit` object's `report_card` field (a `ReportCard`
      object) has a `passed` field that is true
    * The `Commit` object has a `score` field (a double) that is
      exactly 1.0

    If all three conditions are true, execute the "Advance to next
    step" sequence and then the "Loading a single problem" sequence
    is complete. Otherwise the sequence is complete without further
    steps.


Advance to next step ("nextStep" operation)
-------------------------------------------

This sequence executes at the end of the "Loading a single problem"
sequence if a student's most recent commit indicates that they
already finished the step that was loaded.

This sequence tries to find the next step for a single problem and
advances the problem state if it finds another step. There may not
be another step (when the student has finished the entire problem).

This also executes when a student successfully passes a step through
the grading action.

In this sequence we call the existing step oldStep and the new
step (if it exists) newStep.

1.  Print the string "step {step} passed" to the terminal, where
    {step} is the `step` field of oldStep

2.  Try loading newStep using `GetProblemStep`. request requires
    the `problem_id` and the `step`, which is the `step` of oldStep
    plus 1. If this fails, mark the problem as fully complete and
    end the sequence.

3.  If newStep was found and fetched, merge its files into the set
    of files for the problem. Here is the sequence that must be
    followed:

    * Each file path in newStep either replaces one in the main
      file set for thr problem (if it is a duplicate) or adds to
      the set.
    * The file sets from oldStep and newStep are compared (note: NOT
      the merged file set). Any file path that appears in oldStep
      but is missing from newStep is REMOVED from the merged file
      set.
    * Print the string "moving to step {step}" to the terminal,
      where {step} is the `step` field of newStep

4.  If there was no next step found, print the string
    "you have completed all steps for this problem" to the terminal.


Perform an action ("doAction" operation)
----------------------------------------

This sequence is initiated when the user clicks on an action button
in the button bar, or when a save action is triggered and there are
unsaved changes (the save action is a no-op when there are no
changes).

The action to be performed is passed in as a string:

*   For a click on an action button, the `action` field of the
    `ProblemTypeAction` is passed in
*   For a save operation, an empty string is passed in

Here is the sequence:

1.  Re-load the current `ProblemStep` using `GetProblemStep`.
    request requires the `problem_id` and the `step`, both available
    in the old `ProblemStep` object.

    This new version of the `ProblemStep` replaces the old one in
    the active problem data.

2.  Identify the files named in the `ProblemStep` `whitelist` field
    (a map from strings to booleans that are always true. The
    presence of a file path name in the map means the file is "in
    the whitelist".

    *   For files in the whitelist, collect the current active
        version of the file (NOT from the ProblemStep) into a map of
        "student files".

    *   For files that are NOT in the whitelist, replace the version
        in the active file set with the version from the
        newly-loaded `ProblemStep`.

3.  Create a `Commit` object with the following fields populated:

    *   `id`: 0
    *   `assignment_id`: the `id` field from the active `Assignment`
        object
    *   `problem_id`: the `id` field from the active `Problem`
    *   `step`: the `step` field from the active `ProblemStep`
    *   `files`: a map of `strings` to `bytes` populated from the
        set of student files (the files from the active file set
        that are named in the whitelist).
    *   `created_at` and `updated_at`: the current time stamp (both
        fields should have the same value).

    In addition, the action input parameter drives a few more
    fields:

    *   If the action parameter is the empty string (indicating a
        save request):
        *   The `action` field of the `Commit` is set to the empty
            string
        *   The `note` field of the `Commit` is set to the string
            "exam interface: save"
    *   Else:
        *   The `action` field of the `Commit` is set to the action
            parameter string
        *   The `note` field of the `Commit` is set to the string
            "exam interface: {action}" where {action} is the action
            parameter string

4.  Create a `CommitBundle` object called `bundle` with the
    following fields populated:

    *   `user_id`: the user ID taken from the `id` field of the
        `User` object loaded during the loadAssignment operation.
    *   `commit`: the `Commit` object created above.

5.  Call `PostCommitBundlesUnsignedRequest`. request requires the
    `bundle` field created above. responds with a `CommitBundle`
    field called `bundle` that replaces the old one for the
    remaining steps. When this arrives the active problem is
    marked as having been saved (no unsaved changes), possibly
    de-activating the save button.

    *   If the action parameter string was the empty string, this is
        the end of the doAction operation.

    For all other cases continue.

6.  Print the `message` field from the `ProblemStepAction`
    corresponding to the action parameter string to the terminal.

7.  Run the handleDaycare sequence giving it the response bundle as
    input. If the action parameter string was anything other than
    "grade", this is the end of the sequence.

    For "grade" actions continue with the remaining steps.

8.  On success handleDaycare returns a new `CommitBundle` called
    `bundle`. We will refer to it as `graded`.

    Construct a new `CommitBundle` called `toSave` by copying some
    fields from `graded`:

    *   `hostname`
    *   `user_id`
    *   `commit`
    *   `commit_signature`

    Call `PostCommitBundlesSigned`. request requires `bundle` which
    is filled in with the `toSave` commit bundle. response
    returns a new `bundle` with a `commit` field that is used in the
    remaining steps.

9.  If the commit has a `report_card` field with a `passed` field
    that is true and the commit has a `score` field that is equal to
    1.0:

    *   Run the nextStep operation

10. Else:

    *   Print the string "solution for step {step} failed" to the
        terminal, where {step} is the `step` field of the current
        problem step.
    *   The `Commit` has a `transcript` field that is a repeated
        `EventMessage`. Iterate over each event in the transcript and
        do the following:
        *   If the `event` field is "exec" then print the string
            "$ {cmd}" to the terminal where {cmd} is all the strings
            in the `exec_command` repeated field of the event joined
            with spaces.
        *   If the `event` field is "exit" then:
            *   If the `exit_status` field is non-zero, then print
                the string "exit status {exit_status}" where
                {exit_status} comes from the `exit_status` field of
                the `event`.
        *   If the `event` field is "stdin", "stdout", or "stderr",
            print the raw bytes from the event's `stream_data` field
            to the terminal.
        *   If the `event` field is "error", print the string
            "Error: {err}" where {err} is the `error` field of the
            event.


Daycare interaction (the "handleDaycare" operation)
---------------------------------------------------

This sequence sends a request to a daycare server, which may or may
not be the same as the main gRPC server, and then streams values
back from it.

This is where student code is run in a container environment and
assessed monitored.

This operation takes a `CommitBundle` called `bundle` as input, and
on successful completion returns a new `CommitBundle`.

1.  The server hostname is found in the `hostname` field of the
    bundle. It may or may not be the same as the main gRPC server
    and is used just for this request. This request unusual in that
    it does not take a session cookie.

2.  Call `Daycare`. request requires `commit_bundle` (the bundle
    parameter), `problem_type` (the `name` field from the
    `ProblemType` of the current problem step), `action` (the
    `action` field from the bundle, and `args` (and empty list of
    strings). response is a stream of `response` values.

3.  Iterate over the `response` values and process them:

    *   If the response is the `EventMessage` field called `event`:
        *   If the action is `grade`, ignore the event and continue
        *   Else if the `EventMessage` has event field with value
            `files`, take the `files` field of the `EventMessage` (a
            map of `strings` to `bytes`). For any file with a file
            path in the current problem step whitelist, replace the
            active file set version of that file with the one
            returned by the EventMessage and print the string
            "downloading file {path}" where {path} is the file path
            name to the terminal.
        *   Else print it to the terminal using the same rules as
            when the transcript of `EventMessage`s is printed in the
            nextStep operation.
    *   If the response is the string field called `error`, print
        the string "server return an error: {error}" where {error}
        is the string from the response to the terminal, then end
        the handleDaycare operation as an error.
    *   If the response is a `CommitBundle` field called
        `commit_bundle`, end the operation and return the bundle as
        the successful return value.
