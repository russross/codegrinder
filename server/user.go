package main

import (
	"bytes"
	"database/sql"
	"fmt"
	"html"
	"log"
	"math/rand"
	"sort"
	"strconv"
	"sync"
	"time"
	"unicode/utf8"

	. "github.com/russross/codegrinder/types"
	"github.com/russross/meddler"
)

const loginRecordTimeout = 5 * time.Minute

// getCourses returns a list of courses filtered by the given parameters.
// Authorization: currentUser must be logged in and sees only courses they are enrolled in.
func getCourses(tx *sql.Tx, currentUser *User, ltiLabel, name string) ([]*Course, error) {
	where := ""
	args := []interface{}{}

	if ltiLabel != "" {
		where, args = addWhereEq(where, args, "lti_label", ltiLabel)
	}

	if name != "" {
		where, args = addWhereLike(where, args, "name", name)
	}

	where, args = addWhereEq(where, args, "assignments.user_id", currentUser.ID)
	courses := []*Course{}
	err := meddler.QueryAll(tx, &courses, `SELECT DISTINCT courses.* `+
		`FROM courses JOIN assignments ON courses.id = assignments.course_id`+
		where+` ORDER BY lti_label`, args...)

	if err != nil {
		return nil, err
	}
	return courses, nil
}

// getCourse returns a single course by ID.
// Authorization: currentUser must be logged in and can only access courses they are enrolled in.
func getCourse(tx *sql.Tx, courseID int64, currentUser *User) (*Course, error) {
	course := new(Course)

	err := meddler.QueryRow(tx, course, `SELECT courses.* `+
		`FROM courses JOIN assignments ON courses.id = assignments.course_id `+
		`WHERE assignments.user_id = ? AND assignments.course_id = ?`,
		currentUser.ID, courseID)
	if err != nil {
		return nil, err
	}

	return course, nil
}

// getUsers returns a list of users filtered by the given parameters.
// Authorization: currentUser must be logged in and sees only users they have a relationship with.
func getUsers(tx *sql.Tx, currentUser *User, name, email, instructor, admin string) ([]*User, error) {
	// build search terms
	where := ""
	args := []interface{}{}

	if name != "" {
		where, args = addWhereLike(where, args, "name", name)
	}

	if email != "" {
		where, args = addWhereLike(where, args, "email", email)
	}

	if instructor != "" {
		val, err := strconv.ParseBool(instructor)
		if err != nil {
			return nil, fmt.Errorf("error parsing instructor value as boolean: %v", err)
		}
		where, args = addWhereEq(where, args, "instructor", val)
	}

	if admin != "" {
		val, err := strconv.ParseBool(admin)
		if err != nil {
			return nil, fmt.Errorf("error parsing admin value as boolean: %v", err)
		}
		where, args = addWhereEq(where, args, "admin", val)
	}

	where, args = addWhereEq(where, args, "user_users.user_id", currentUser.ID)
	users := []*User{}
	err := meddler.QueryAll(tx, &users, `SELECT users.* `+
		`FROM users JOIN user_users ON users.id = user_users.other_user_id`+
		where+` ORDER BY id`, args...)

	if err != nil {
		return nil, err
	}
	return users, nil
}

// getUserMe returns the current user.
// Authorization: currentUser must be logged in (returns their own data).
func getUserMe(tx *sql.Tx, currentUser *User) (*User, error) {
	return currentUser, nil
}

// getUserSession returns a user session given a key.
// getUserSession validates a session key and returns the associated session.
// Authorization: No authentication required (public endpoint for session validation).
func getUserSession(key string) (*CookieSession, error) {
	if key == "" {
		return nil, fmt.Errorf("missing key parameter")
	}

	userID, err := loginRecords.Get(key)
	if err != nil {
		return nil, err
	}
	if userID < 1 {
		return nil, fmt.Errorf("illegal user ID found: %d", userID)
	}
	session := NewSession(userID)
	return session, nil
}

// getUser returns a single user by ID.
// Authorization: currentUser must be logged in and can only access users they have a relationship with.
func getUser(tx *sql.Tx, userID int64, currentUser *User) (*User, error) {
	user := new(User)

	err := meddler.QueryRow(tx, user, `SELECT users.* `+
		`FROM users JOIN user_users ON users.id = user_users.other_user_id `+
		`WHERE user_users.user_id = ? AND user_users.other_user_id = ?`,
		currentUser.ID, userID)
	if err != nil {
		return nil, err
	}

	return user, nil
}

// getCourseUsers returns a list of users in the given course.
// Authorization: currentUser must be logged in and can only access courses they are enrolled in.
func getCourseUsers(tx *sql.Tx, courseID int64, currentUser *User) ([]*User, error) {
	users := []*User{}

	err := meddler.QueryAll(tx, &users, `SELECT DISTINCT users.* `+
		`FROM users JOIN assignments ON users.id = assignments.user_id `+
		`JOIN user_users ON assignments.user_id = user_users.other_user_id `+
		`WHERE assignments.course_id = ? AND user_users.user_id = ? `+
		`ORDER BY users.id`,
		courseID, currentUser.ID)
	if err != nil {
		return nil, err
	}

	if len(users) == 0 {
		return nil, fmt.Errorf("not found")
	}

	return users, nil
}

// getAssignments returns a list of assignments filtered by search terms.
// Authorization: currentUser must be logged in and sees only assignments from courses they are enrolled in.
func getAssignments(tx *sql.Tx, currentUser *User, searchTerms []string, ipAllowed bool) ([]*Assignment, error) {
	// build search terms
	where := ""
	args := []interface{}{}
	for _, term := range searchTerms {
		where, args = addWhereLike(where, args, "assignment_search_fields.search_text", term)
	}

	where, args = addWhereEq(where, args, "user_assignments.user_id", currentUser.ID)
	if where == "" {
		where = " WHERE"
	} else {
		where += " AND"
	}
	where += " (? OR NOT user_assignments.restricted)"
	args = append(args, ipAllowed)
	assignments := []*Assignment{}
	err := meddler.QueryAll(tx, &assignments, `SELECT assignments.* FROM assignments JOIN assignment_search_fields `+
		`ON assignments.id = assignment_search_fields.assignment_id `+
		`JOIN user_assignments ON user_assignments.assignment_id = assignments.id`+where+` ORDER BY assignments.id`, args...)

	if err != nil {
		return nil, err
	}
	return assignments, nil
}

// getUserAssignments returns a list of assignments for the given user.
// Authorization: currentUser must be logged in and can only access assignments for users they have a relationship with.
func getUserAssignments(tx *sql.Tx, userID int64, currentUser *User, ipAllowed bool) ([]*Assignment, error) {
	assignments := []*Assignment{}

	err := meddler.QueryAll(tx, &assignments, `SELECT assignments.* `+
		`FROM assignments JOIN user_assignments ON assignments.id = user_assignments.assignment_id `+
		`WHERE assignments.user_id = ? AND user_assignments.user_id = ? AND (? OR NOT user_assignments.restricted) `+
		`ORDER BY course_id, updated_at`,
		userID, currentUser.ID, ipAllowed)
	if err != nil {
		return nil, err
	}

	return assignments, nil
}

// getCourseUserAssignments returns a list of assignments for the given user in the given course.
// Authorization: currentUser must be logged in and can only access courses they are enrolled in.
func getCourseUserAssignments(tx *sql.Tx, courseID int64, userID int64, currentUser *User, ipAllowed bool) ([]*Assignment, error) {
	assignments := []*Assignment{}

	err := meddler.QueryAll(tx, &assignments, `SELECT assignments.* `+
		`FROM assignments JOIN user_assignments ON assignments.id = user_assignments.assignment_id `+
		`WHERE course_id = ? AND assignments.user_id = ? AND user_assignments.user_id = ? AND (? OR NOT user_assignments.restricted) `+
		`ORDER BY updated_at`,
		courseID, userID, currentUser.ID, ipAllowed)
	if err != nil {
		return nil, err
	}

	if len(assignments) == 0 {
		return nil, fmt.Errorf("not found")
	}

	return assignments, nil
}

// getAssignment returns the given assignment.
// Authorization: currentUser must be logged in and can only access assignments they are assigned to.
func getAssignment(tx *sql.Tx, assignmentID int64, currentUser *User, ipAllowed bool) (*Assignment, error) {
	assignment := new(Assignment)

	err := meddler.QueryRow(tx, assignment, `SELECT assignments.* `+
		`FROM assignments JOIN user_assignments ON assignments.id = user_assignments.assignment_id `+
		`WHERE assignments.id = ? AND user_assignments.user_id = ? AND (? OR NOT user_assignments.restricted)`,
		assignmentID, currentUser.ID, ipAllowed)
	if err != nil {
		return nil, err
	}

	return assignment, nil
}

// getAssignmentProblemCommitLast returns the most recent commit of the highest-numbered step for the given problem of the given assignment.
// Authorization: currentUser must be logged in and can only access assignments they are assigned to.
func getAssignmentProblemCommitLast(tx *sql.Tx, assignmentID int64, problemID int64, currentUser *User, ipAllowed bool) (*Commit, error) {
	commit := new(Commit)

	err := meddler.QueryRow(tx, commit, `SELECT commits.* `+
		`FROM commits JOIN user_assignments ON commits.assignment_id = user_assignments.assignment_id `+
		`WHERE commits.assignment_id = ? AND problem_id = ? AND user_assignments.user_id = ? AND (? OR NOT user_assignments.restricted) `+
		`ORDER BY step DESC, updated_at DESC LIMIT 1`, assignmentID, problemID, currentUser.ID, ipAllowed)
	if err != nil {
		return nil, err
	}

	// Load files for commit
	if err := loadCommitFiles(tx, commit); err != nil {
		return nil, fmt.Errorf("db error loading files: %v", err)
	}

	return commit, nil
}

// getAssignmentProblemStepCommitLast returns the most recent commit for the given step of the given problem of the given assignment.
// Authorization: currentUser must be logged in and can only access assignments they are assigned to.
func getAssignmentProblemStepCommitLast(tx *sql.Tx, assignmentID int64, problemID int64, step int64, currentUser *User, ipAllowed bool) (*Commit, error) {
	commit := new(Commit)

	err := meddler.QueryRow(tx, commit, `SELECT commits.* `+
		`FROM commits JOIN user_assignments ON commits.assignment_id = user_assignments.assignment_id `+
		`WHERE commits.assignment_id = ? AND problem_id = ? AND step = ? AND user_assignments.user_id = ? AND (? OR NOT user_assignments.restricted) `+
		`ORDER BY updated_at DESC LIMIT 1`,
		assignmentID, problemID, step, currentUser.ID, ipAllowed)
	if err != nil {
		return nil, err
	}

	// Load files for commit
	if err := loadCommitFiles(tx, commit); err != nil {
		return nil, fmt.Errorf("db error loading files: %v", err)
	}

	return commit, nil
}

func saveCommitBundleCommon(now time.Time, tx *sql.Tx, currentUser *User, bundle *CommitBundle, ipAllowed bool) (*CommitBundle, error) {
	if bundle.ProblemType != nil {
		return nil, fmt.Errorf("bundle must not include a problem type object")
	}
	if len(bundle.ProblemTypeSignature) != 0 {
		return nil, fmt.Errorf("bundle must not include a problem type signature")
	}
	if bundle.Problem != nil {
		return nil, fmt.Errorf("bundle must not include a problem object")
	}
	if len(bundle.ProblemSteps) != 0 {
		return nil, fmt.Errorf("bundle must not include problem step objects")
	}
	if len(bundle.ProblemSignature) != 0 {
		return nil, fmt.Errorf("bundle must not include problem signature")
	}
	if len(bundle.CommitSignature) != 0 && len(bundle.Hostname) == 0 {
		return nil, fmt.Errorf("bundle must include daycare hostname")
	}
	if bundle.UserID != currentUser.ID {
		return nil, fmt.Errorf("bundle must include user's ID")
	}
	commit := bundle.Commit

	// get the assignment and figure out if this is the student or the instructor
	isInstructor := false
	assignment := new(Assignment)
	err := meddler.QueryRow(tx, assignment, `SELECT * FROM assignments WHERE id = ? AND user_id = ? AND (? OR NOT restricted)`, commit.AssignmentID, currentUser.ID, ipAllowed)
	if err == sql.ErrNoRows {
		// try loading it as the instructor
		err = meddler.QueryRow(tx, assignment, `SELECT assignments.* FROM assignments JOIN user_assignments ON assignments.id = user_assignments.assignment_id `+
			`WHERE user_assignments.assignment_id = ? AND user_assignments.user_id = ? AND (? OR NOT user_assignments.restricted)`, commit.AssignmentID, currentUser.ID, ipAllowed)
		if err == nil {
			isInstructor = true
		}
	}
	if err != nil {
		return nil, err
	}

	// assignment cannot be past the lock date:
	// * a student's lock at deadline is normally honored if present
	// * however, if there is no course-wide lock at (attached to an instructor),
	//   the student lock at is ignored on the assumption that the deadline was lifted course wide
	// * if the student does not have an individual deadline but there is a course-wide deadline,
	//   it is observed on the assumption that a deadline was imposed after the student started work
	// to decide if a submission is past the deadline:
	// * if there is no course-wide lock at, accept
	// * else if the student has a lock at:
	//     * if it is in the past, reject
	//     * else accept
	// * else if the course-wide lock at has passed, reject
	// * else accept
	var courseWideLockAt time.Time
	err = tx.QueryRow(`SELECT lock_at FROM assignments WHERE instructor AND lti_id = ? AND lock_at IS NOT NULL ORDER BY lock_at DESC LIMIT 1`,
		assignment.LtiID).Scan(&courseWideLockAt)
	if err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("db error: %v", err)
	} else if err == nil {
		// there is a course-wide deadline, should we reject?
		if (assignment.LockAt != nil && now.After(*assignment.LockAt)) ||
			(assignment.LockAt == nil && now.After(courseWideLockAt)) {
			course := new(Course)
			err = meddler.Load(tx, "courses", course, assignment.CourseID)
			if err != nil {
				return nil, fmt.Errorf("db error: %v", err)
			}
			return nil, fmt.Errorf("A commit cannot be submitted after the assignment is locked.\n\n"+
				"If the assignment has been extended then you must click on the assignment\n"+
				"in Canvas before CodeGrinder will be updated. You can try this link:\n\n"+
				"  https://%s/courses/%d/assignments/%d\n", assignment.CanvasAPIDomain, course.CanvasID, assignment.CanvasID)
		}
	}

	// get the problem
	problem := new(Problem)
	if err = meddler.QueryRow(tx, problem, `SELECT * FROM problems WHERE id = ?`, commit.ProblemID); err != nil {
		return nil, fmt.Errorf("db error: %v", err)
	}

	// get the required step, but keep a slice with empty entries for the other steps
	// this is for backward compatibility: we used to pass around the full list of steps
	var stepCount int64
	if err = tx.QueryRow(`SELECT COUNT(1) FROM problem_steps WHERE problem_id = ?`, commit.ProblemID).Scan(&stepCount); err != nil {
		return nil, fmt.Errorf("db error: %v", err)
	}
	if stepCount < 1 {
		return nil, fmt.Errorf("no steps found for problem %d", commit.ProblemID)
	}
	if commit.Step < 1 {
		return nil, fmt.Errorf("commit has step number %d, which is invalid", commit.Step)
	}
	if commit.Step > stepCount {
		return nil, fmt.Errorf("commit has step number %d, but there are only %d steps in the problem", commit.Step, stepCount)
	}
	steps := make([]*ProblemStep, stepCount)
	var step ProblemStep
	steps[commit.Step-1] = &step
	if err = meddler.QueryRow(tx, &step, `SELECT * FROM problem_steps WHERE problem_id = ? AND step = ?`, commit.ProblemID, commit.Step); err != nil {
		return nil, fmt.Errorf("db error: %v", err)
	}

	// get step files, but not solution files
	if err = loadProblemStepFiles(tx, &step); err != nil {
		return nil, fmt.Errorf("db error: %v", err)
	}
	step.Solution = nil

	// get the problem type for this step
	problemType, err := getProblemType(tx, step.ProblemType)
	if err != nil {
		return nil, fmt.Errorf("error loading problem type: %v", err)
	}

	if assignment.RawScores == nil {
		assignment.RawScores = map[string][]float64{}
	}

	// reject commit if a previous step remains incomplete
	scores := assignment.RawScores[problem.Unique]
	for i := 0; i < int(commit.Step)-1; i++ {
		if i >= len(scores) || scores[i] != 1.0 {
			return nil, fmt.Errorf("commit is for step %d, but user has not passed step %d", commit.Step, i+1)
		}
	}

	// reject commit if user has started work on a later step
	var latestStep int64
	if err = tx.QueryRow(`SELECT step FROM commits WHERE assignment_id = ? AND problem_id = ? ORDER BY step DESC LIMIT 1`, commit.AssignmentID, commit.ProblemID).Scan(&latestStep); err != nil {
		if err != sql.ErrNoRows {
			return nil, fmt.Errorf("db error: %v", err)
		}
	} else if latestStep > commit.Step {
		return nil, fmt.Errorf("commit is for step %d, but user has already started work on step %d", commit.Step, latestStep)
	}

	// validate commit
	if err := commit.Normalize(now, step.Whitelist); err != nil {
		return nil, err
	}

	// update an existing commit if it exists
	// note: this used to include AND action IS NULL AND updated_at > now.Add(-OpenCommitTimeout)
	openCommit := new(Commit)
	if err := meddler.QueryRow(tx, openCommit, `SELECT * FROM commits WHERE assignment_id = ? AND problem_id = ? AND step = ? LIMIT 1`, commit.AssignmentID, commit.ProblemID, commit.Step); err != nil {
		if err == sql.ErrNoRows {
			commit.ID = 0
		} else {
			return nil, fmt.Errorf("db error: %v", err)
		}
	} else {
		commit.ID = openCommit.ID
		commit.CreatedAt = openCommit.CreatedAt
	}

	// sign the problem and the commit
	typeSig := problemType.ComputeSignature(Config.DaycareSecret)
	problemSig := problem.ComputeSignature(Config.DaycareSecret, steps)
	commitSig := commit.ComputeSignature(Config.DaycareSecret, typeSig, problemSig, bundle.Hostname, bundle.UserID)

	// verify signature
	if bundle.CommitSignature != "" {
		if bundle.CommitSignature != commitSig {
			return nil, fmt.Errorf("found commit signature of %s, but expected %s", bundle.CommitSignature, commitSig)
		}
		age := now.Sub(commit.UpdatedAt)
		if age < 0 {
			age = -age
		}
		if age > SignedCommitTimeout {
			return nil, fmt.Errorf("commit signature has expired")
		}
	}

	// save the commit
	action := commit.Action
	if bundle.CommitSignature == "" {
		// if unsigned, save it without the action
		commit.Action = ""
	}
	if isInstructor {
		log.Printf("instructor is testing student code, skipping save step")
	} else {
		if err := meddler.Save(tx, "commits", commit); err != nil {
			return nil, fmt.Errorf("db error: %v", err)
		}

		// save commit files separately
		if err := saveCommitFiles(tx, commit); err != nil {
			return nil, fmt.Errorf("db error saving commit files: %v", err)
		}

		// save an updated timestamp on the assignment if it would otherwise not be updated
		if commit.ReportCard == nil {
			assignment.UpdatedAt = now
			if err := meddler.Save(tx, "assignments", assignment); err != nil {
				return nil, fmt.Errorf("db error: %v", err)
			}
		}
	}
	commit.Action = action

	// assign a daycare host if needed
	if bundle.Hostname == "" {
		typeSet := map[string]bool{problemType.Name: true}

		host, err := daycareRegistrations.Assign(typeSet)
		if err != nil {
			log.Printf("error assigning a daycare for this commit: %v", err)
		} else {
			bundle.Hostname = host
		}
	}

	// recompute the signature as the ID may have changed when saving
	commitSig = commit.ComputeSignature(Config.DaycareSecret, typeSig, problemSig, bundle.Hostname, bundle.UserID)
	signed := &CommitBundle{
		ProblemType:          problemType,
		ProblemTypeSignature: typeSig,
		Problem:              problem,
		ProblemSteps:         steps,
		ProblemSignature:     problemSig,
		Hostname:             bundle.Hostname,
		UserID:               bundle.UserID,
		Commit:               commit,
		CommitSignature:      commitSig,
	}

	// save the grade update
	if !isInstructor && signed.Commit.ReportCard != nil {
		assignment.SetMinorScore(problem.Unique, int(signed.Commit.Step-1), signed.Commit.ReportCard.ComputeScore())

		// get the weight of each step in the problem and problem in the set
		majorWeights, minorWeights, err := GetProblemWeights(tx, assignment)
		if err != nil {
			return nil, err
		}

		// compute an overall score
		score, err := assignment.ComputeScore(majorWeights, minorWeights)
		if err != nil {
			return nil, err
		}
		assignment.Score = score

		// save the updates to the assignment
		assignment.UpdatedAt = now
		if err := meddler.Save(tx, "assignments", assignment); err != nil {
			return nil, err
		}

		// post grade to LMS using LTI
		var transcript bytes.Buffer
		if err := signed.Commit.DumpTranscript(&transcript); err != nil {
			return nil, fmt.Errorf("error writing transcript: %v", err)
		}

		// record the grading transcript
		var report bytes.Buffer
		if len(majorWeights) > 1 && len(signed.ProblemSteps) > 1 {
			fmt.Fprintf(&report, "<h1>Grading transcript for problem %s step %d</h1>\n", signed.Problem.Unique, signed.Commit.Step)
		} else if len(majorWeights) > 1 {
			fmt.Fprintf(&report, "<h1>Grading transcript for problem %s</h1>\n", signed.Problem.Unique)
		} else if len(signed.ProblemSteps) > 1 {
			fmt.Fprintf(&report, "<h1>Grading transcript for step %d</h1>\n", signed.Commit.Step)
		} else {
			fmt.Fprintf(&report, "<h1>Grading transcript</h1>\n")
		}
		fmt.Fprintf(&report, "%s\n", ANSIToHTMLPre(transcript.String()))

		// add all of the student files
		var names []string
		for name := range signed.Commit.Files {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			contents := signed.Commit.Files[name]
			if utf8.Valid(contents) {
				fmt.Fprintf(&report, "<h1>File: <code>%s</code></h1>\n<pre><code>%s</code></pre>\n",
					html.EscapeString(name), html.EscapeString(string(contents)))
			} else {
				fmt.Fprintf(&report, "<h1>File: <code>%s</code> (binary contents)</h1>\n", html.EscapeString(name))
			}
		}

		// send grade to the LMS in a goroutine
		// so we can wrap up the transaction and return to the user
		go func(asst *Assignment, msg string) {
			// try up to 10 times before giving up
			tries := 10
			minSleepTime := 10 * time.Second
			maxSleepTime := 5 * time.Minute
			sleepTime := minSleepTime
			for i := 0; i < tries; i++ {
				err := saveGrade(asst, msg)
				if err == nil {
					return
				}
				log.Printf("error posting grade back to LMS (attempt %d/%d): %v", i+1, tries, err)
				if i+1 < 10 {
					log.Printf("  will try again in %v", sleepTime)
					time.Sleep(sleepTime)
					sleepTime *= 2
					if sleepTime > maxSleepTime {
						sleepTime = maxSleepTime
					}
				} else {
					log.Printf("  giving up")
				}
			}
		}(assignment, report.String())
	}

	note := ""
	if bundle.Commit.Note != "" {
		note = " (" + bundle.Commit.Note + ")"
	}
	if bundle.Commit.Action == "" && bundle.CommitSignature == "" && bundle.Commit.Note != "web autosave" {
		log.Printf("sync request: user %s syncing %s step %d%s",
			currentUser.Name, problem.Note, bundle.Commit.Step, note)
	} else if bundle.Commit.Action != "" && bundle.CommitSignature == "" {
		log.Printf(" pre-daycare commit: user %s (%d) action %s for %s step %d%s",
			currentUser.Name, currentUser.ID, bundle.Commit.Action, problem.Note, bundle.Commit.Step, note)
	} else if bundle.Commit.Action != "" {
		log.Printf("post-daycare commit: user %s (%d) action %s for %s step %d%s",
			currentUser.Name, currentUser.ID, bundle.Commit.Action, problem.Note, bundle.Commit.Step, note)
	}

	return signed, nil
}

type StepWeight struct {
	MajorKey    string  `meddler:"major_key"`
	MajorWeight float64 `meddler:"major_weight"`
	MinorKey    int64   `meddler:"minor_key"`
	MinorWeight float64 `meddler:"minor_weight"`
}

func GetProblemWeights(tx *sql.Tx, assignment *Assignment) (majorWeights map[string]float64, minorWeights map[string][]float64, err error) {
	weights := []*StepWeight{}
	if err := meddler.QueryAll(tx, &weights, `SELECT problems.unique_id AS major_key, problem_set_problems.weight AS major_weight, problem_steps.step AS minor_key, problem_steps.weight AS minor_weight `+
		`FROM problem_set_problems JOIN problems ON problem_set_problems.problem_id = problems.id `+
		`JOIN problem_steps ON problem_steps.problem_id = problems.id `+
		`WHERE problem_set_problems.problem_set_id = ? `+
		`ORDER BY unique_id, step`, assignment.ProblemSetID); err != nil {
		return nil, nil, fmt.Errorf("db error: %v", err)
	}
	if len(weights) == 0 {
		return nil, nil, fmt.Errorf("no problem step weights found, unable to compute score")
	}
	majorWeights = make(map[string]float64)
	minorWeights = make(map[string][]float64)
	for _, elt := range weights {
		majorWeights[elt.MajorKey] = elt.MajorWeight
		minorWeights[elt.MajorKey] = append(minorWeights[elt.MajorKey], elt.MinorWeight)
		if len(minorWeights[elt.MajorKey]) != int(elt.MinorKey) {
			return nil, nil, fmt.Errorf("step weights do not line up when computing score")
		}
	}
	return majorWeights, minorWeights, nil
}

type loginRecord struct {
	userID int64
	time   time.Time
}

type logins struct {
	sync.Mutex
	logins map[string]*loginRecord
}

var loginRecords logins

func init() {
	loginRecords.logins = make(map[string]*loginRecord)
}

func (l *logins) expire() {
	now := time.Now()
	for key, elt := range l.logins {
		if now.Sub(elt.time) >= loginRecordTimeout {
			delete(l.logins, key)
		}
	}
}

func (l *logins) Insert(userID int64) string {
	l.Lock()
	defer l.Unlock()

	key := ""
	for {
		key = makeLoginKey()
		if _, exists := l.logins[key]; !exists {
			break
		}
	}

	elt := &loginRecord{
		userID: userID,
		time:   time.Now(),
	}

	l.logins[key] = elt
	l.expire()

	return key
}

func (l *logins) Get(key string) (int64, error) {
	l.Lock()
	defer l.Unlock()

	l.expire()

	elt, exists := l.logins[key]
	if !exists {
		return 0, fmt.Errorf("session %q not found: key expires after 5 minutes and can only be used once", key)
	}

	delete(l.logins, key)
	return elt.userID, nil
}

const keyCharSet string = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"

func makeLoginKey() string {
	var key string
	for i := 0; i < 8; i++ {
		n := rand.Intn(len(keyCharSet))
		key += keyCharSet[n : n+1]
	}
	return key
}

// loadCommitFiles loads all files for a commit from the commit_files table.
func loadCommitFiles(tx *sql.Tx, commit *Commit) error {
	commit.Files = make(map[string][]byte)
	rows, err := tx.Query(
		`SELECT path, content FROM commit_files WHERE commit_id = ?`,
		commit.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var path string
		var content []byte
		if err := rows.Scan(&path, &content); err != nil {
			return err
		}
		commit.Files[path] = content
	}
	return rows.Err()
}

// saveCommitFiles saves all files for a commit to the commit_files table.
// It first deletes any existing files for this commit, then inserts the new ones.
func saveCommitFiles(tx *sql.Tx, commit *Commit) error {
	// Delete existing files for this commit
	if _, err := tx.Exec(`DELETE FROM commit_files WHERE commit_id = ?`,
		commit.ID); err != nil {
		return err
	}

	// Insert new files
	for path, content := range commit.Files {
		if _, err := tx.Exec(
			`INSERT INTO commit_files (commit_id, path, content) VALUES (?, ?, ?)`,
			commit.ID, path, content); err != nil {
			return err
		}
	}

	return nil
}
