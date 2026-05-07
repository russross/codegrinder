CREATE TABLE problem_types (
    problem_type            text NOT NULL,
    container               text NOT NULL,

    PRIMARY KEY (problem_type),
    CHECK (trim(problem_type) = problem_type AND length(problem_type) > 0),
    CHECK (trim(container) = container AND length(container) > 0)
) WITHOUT ROWID;

CREATE TABLE problem_type_actions (
    problem_type            text NOT NULL,
    action                  text NOT NULL,
    command                 text NOT NULL,
    parser                  text CHECK(parser IS NULL OR parser IN ('xunit', 'check')),

    max_cpu                 integer NOT NULL,
    max_fd                  integer NOT NULL,
    max_file_size           integer NOT NULL,
    max_memory              integer NOT NULL,
    max_threads             integer NOT NULL,

    PRIMARY KEY (problem_type, action),
    FOREIGN KEY (problem_type) REFERENCES problem_types (problem_type) ON DELETE CASCADE ON UPDATE CASCADE,
    CHECK (trim(problem_type) = problem_type AND length(problem_type) > 0),
    CHECK (trim(action) = action AND length(action) > 0),
    CHECK (trim(command) = command AND length(command) > 0),
    CHECK (parser IS NULL OR trim(parser) = parser),
    CHECK (max_cpu > 0),
    CHECK (max_fd > 0),
    CHECK (max_file_size > 0),
    CHECK (max_memory >= 0),
    CHECK (max_threads > 0)
) WITHOUT ROWID;

CREATE TABLE problem_type_files (
    problem_type            text NOT NULL,
    path                    text NOT NULL,
    content                 blob NOT NULL,

    PRIMARY KEY (problem_type, path),
    FOREIGN KEY (problem_type) REFERENCES problem_types (problem_type) ON DELETE CASCADE ON UPDATE CASCADE,
    CHECK (trim(problem_type) = problem_type AND length(problem_type) > 0),
    CHECK (trim(path) = path AND length(path) > 0),
    CHECK (
        path NOT GLOB '/*'
        AND path NOT GLOB './*'
        AND path NOT GLOB '../*'
        AND path NOT GLOB '*//*'
        AND path NOT GLOB '*/./*'
        AND path NOT GLOB '*/../*'
        AND path NOT GLOB '*/.'
        AND path NOT GLOB '*/..'
        AND path NOT GLOB '*\*'
        AND path NOT IN ('.', '..')
    )
) WITHOUT ROWID;

CREATE TABLE problems (
    problem_id              text NOT NULL,
    problem_note            text NOT NULL,
    problem_tags            text NOT NULL,
    problem_options         text NOT NULL,

    problem_created_at      datetime NOT NULL,
    problem_updated_at      datetime NOT NULL,

    PRIMARY KEY (problem_id),
    CHECK (trim(problem_id) = problem_id AND length(problem_id) > 0),
    CHECK (trim(problem_note) = problem_note),
    CHECK (json_valid(problem_tags) AND json_type(problem_tags) = 'array'),
    CHECK (json_valid(problem_options) AND json_type(problem_options) = 'array'),
    CHECK (problem_created_at <= problem_updated_at)
) WITHOUT ROWID;

CREATE TABLE problem_steps (
    problem_id              text NOT NULL,
    step_number             integer NOT NULL,
    problem_type            text NOT NULL,
    step_note               text NOT NULL,
    step_weight             integer NOT NULL,

    PRIMARY KEY (problem_id, step_number),
    FOREIGN KEY (problem_id) REFERENCES problems (problem_id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (problem_type) REFERENCES problem_types (problem_type) ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK (trim(problem_type) = problem_type AND length(problem_type) > 0),
    CHECK (trim(step_note) = step_note),
    CHECK (step_number >= 1),
    CHECK (step_weight > 0),
    CHECK (typeof(step_weight) = 'integer')
) WITHOUT ROWID;
CREATE INDEX problem_steps_problem_type ON problem_steps (problem_type);

CREATE TABLE problem_step_files (
    problem_id              text NOT NULL,
    step_number             integer NOT NULL,
    file_type               text NOT NULL,
    path                    text NOT NULL,
    content                 blob NOT NULL,

    PRIMARY KEY (problem_id, step_number, file_type, path),
    FOREIGN KEY (problem_id, step_number) REFERENCES problem_steps (problem_id, step_number) ON DELETE CASCADE ON UPDATE CASCADE,
    CHECK (step_number >= 1),
    CHECK (trim(file_type) = file_type AND file_type IN ('regular', 'starter', 'solution')),
    CHECK (trim(path) = path AND length(path) > 0),
    CHECK (
        path NOT GLOB '/*'
        AND path NOT GLOB './*'
        AND path NOT GLOB '../*'
        AND path NOT GLOB '*//*'
        AND path NOT GLOB '*/./*'
        AND path NOT GLOB '*/../*'
        AND path NOT GLOB '*/.'
        AND path NOT GLOB '*/..'
        AND path NOT IN ('.', '..')
    )
) WITHOUT ROWID;

CREATE TABLE problem_sets (
    problem_set_id          text NOT NULL,
    problem_set_note        text NOT NULL,
    problem_set_tags        text NOT NULL,
    continues_problem_set_id text,

    problem_set_created_at  datetime NOT NULL,
    problem_set_updated_at  datetime NOT NULL,

    PRIMARY KEY (problem_set_id),
    FOREIGN KEY (continues_problem_set_id) REFERENCES problem_sets (problem_set_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK (trim(problem_set_id) = problem_set_id AND length(problem_set_id) > 0),
    CHECK (trim(problem_set_note) = problem_set_note),
    CHECK (continues_problem_set_id IS NULL OR (trim(continues_problem_set_id) = continues_problem_set_id AND length(continues_problem_set_id) > 0)),
    CHECK (json_valid(problem_set_tags) AND json_type(problem_set_tags) = 'array'),
    CHECK (continues_problem_set_id IS NULL OR continues_problem_set_id <> problem_set_id),
    CHECK (problem_set_created_at <= problem_set_updated_at)
) WITHOUT ROWID;

CREATE TABLE problem_set_problems (
    problem_set_id          text NOT NULL,
    problem_id              text NOT NULL,
    problem_weight          integer NOT NULL,
    first_step              integer,
    last_step               integer,

    PRIMARY KEY (problem_set_id, problem_id),
    FOREIGN KEY (problem_set_id) REFERENCES problem_sets (problem_set_id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (problem_id) REFERENCES problems (problem_id) ON DELETE CASCADE ON UPDATE CASCADE,
    CHECK (problem_weight > 0),
    CHECK (typeof(problem_weight) = 'integer'),
    CHECK ((first_step IS NULL AND last_step IS NULL) OR (first_step IS NOT NULL AND last_step IS NOT NULL)),
    CHECK (first_step IS NULL OR (first_step >= 1 AND typeof(first_step) = 'integer')),
    CHECK (last_step IS NULL OR (last_step >= first_step AND typeof(last_step) = 'integer'))
) WITHOUT ROWID;
CREATE INDEX problem_set_problems_problem_id ON problem_set_problems (problem_id);

CREATE TABLE users (
    user_id                 text NOT NULL,
    user_name               text NOT NULL,
    user_login              text NOT NULL,
    admin                   boolean NOT NULL DEFAULT 0,

    PRIMARY KEY (user_id),
    UNIQUE (user_login),
    CHECK (trim(user_id) = user_id AND length(user_id) > 0),
    CHECK (trim(user_name) = user_name AND length(user_name) > 0),
    CHECK (trim(user_login) = user_login AND length(user_login) > 0),
    CHECK (admin IN (0, 1))
) WITHOUT ROWID;

CREATE TABLE user_sessions (
    session_key_hash        text NOT NULL,
    user_id                 text NOT NULL,
    session_created_at      datetime NOT NULL,
    session_expires_at      datetime NOT NULL,
    session_last_used_at    datetime NOT NULL,
    session_revoked_at      datetime,

    PRIMARY KEY (session_key_hash),
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE ON UPDATE CASCADE,
    CHECK (trim(session_key_hash) = session_key_hash AND length(session_key_hash) > 0),
    CHECK (trim(user_id) = user_id AND length(user_id) > 0),
    CHECK (session_created_at <= session_expires_at),
    CHECK (session_created_at <= session_last_used_at),
    CHECK (session_revoked_at IS NULL OR session_created_at <= session_revoked_at)
) WITHOUT ROWID;
CREATE INDEX user_sessions_user_id ON user_sessions (user_id);
CREATE INDEX user_sessions_expires_at ON user_sessions (session_expires_at);

CREATE TABLE authors (
    user_id                 text NOT NULL,

    PRIMARY KEY (user_id),
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE ON UPDATE CASCADE,
    CHECK (trim(user_id) = user_id AND length(user_id) > 0)
) WITHOUT ROWID;

CREATE TABLE courses (
    course_id               text NOT NULL,
    course_name             text NOT NULL,

    PRIMARY KEY (course_id),
    CHECK (trim(course_id) = course_id AND length(course_id) > 0),
    CHECK (trim(course_name) = course_name AND length(course_name) > 0)
) WITHOUT ROWID;

CREATE TABLE user_courses (
    user_id                 text NOT NULL,
    course_id               text NOT NULL,
    course_roles            text NOT NULL,
    is_instructor           boolean GENERATED ALWAYS AS (
        CASE
            WHEN instr(',' || replace(course_roles, ' ', '') || ',', ',Instructor,') > 0
                OR instr(',' || replace(course_roles, ' ', '') || ',', ',urn:lti:role:ims/lis/TeachingAssistant,') > 0
            THEN 1
            ELSE 0
        END
    ) STORED,

    PRIMARY KEY (user_id, course_id),
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses (course_id) ON DELETE CASCADE ON UPDATE CASCADE,
    CHECK (trim(course_roles) = course_roles AND length(course_roles) > 0)
) WITHOUT ROWID;

CREATE TABLE assignments (
    user_id                 text NOT NULL,
    course_id               text NOT NULL,
    problem_set_id          text NOT NULL,

    restricted              boolean NOT NULL,
    grade_id                text,
    outcome_url             text NOT NULL,
    outcome_ext_accepted    text NOT NULL,
    consumer_key            text NOT NULL,

    unlock_at               datetime,
    due_at                  datetime,
    lock_at                 datetime,

    PRIMARY KEY (user_id, course_id, problem_set_id),
    FOREIGN KEY (user_id, course_id) REFERENCES user_courses (user_id, course_id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (problem_set_id) REFERENCES problem_sets (problem_set_id) ON DELETE CASCADE ON UPDATE CASCADE,
    UNIQUE (grade_id),
    CHECK (restricted IN (0, 1)),
    CHECK (grade_id IS NULL OR (trim(grade_id) = grade_id AND length(grade_id) > 0)),
    CHECK (trim(outcome_url) = outcome_url AND length(outcome_url) > 0),
    CHECK (trim(outcome_ext_accepted) = outcome_ext_accepted AND length(outcome_ext_accepted) > 0),
    CHECK (trim(consumer_key) = consumer_key AND length(consumer_key) > 0),
    CHECK (unlock_at IS NULL OR due_at IS NULL OR unlock_at <= due_at),
    CHECK (due_at IS NULL OR lock_at IS NULL OR due_at <= lock_at)
) WITHOUT ROWID;

CREATE INDEX assignments_course_problem_set ON assignments (course_id, problem_set_id);
CREATE INDEX assignments_user_problem_set ON assignments (user_id, problem_set_id);
CREATE INDEX assignments_problem_set ON assignments (problem_set_id);

CREATE TABLE commits (
    user_id                 text NOT NULL,
    course_id               text NOT NULL,
    problem_set_id          text NOT NULL,
    problem_id              text NOT NULL,
    step_number             integer NOT NULL,
    action                  text NOT NULL,
    note                    text NOT NULL,
    transcript              text NOT NULL,
    report_card             text NOT NULL,
    score                   real,

    commit_created_at       datetime NOT NULL,
    commit_updated_at       datetime NOT NULL,

    PRIMARY KEY (user_id, course_id, problem_set_id, problem_id, step_number),
    FOREIGN KEY (user_id, course_id, problem_set_id) REFERENCES assignments (user_id, course_id, problem_set_id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (problem_id, step_number) REFERENCES problem_steps (problem_id, step_number) ON DELETE CASCADE ON UPDATE CASCADE,
    CHECK (step_number >= 1),
    CHECK (trim(action) = action),
    CHECK (trim(note) = note),
    CHECK (json_valid(transcript) AND json_type(transcript) = 'array'),
    CHECK (json_valid(report_card) AND json_type(report_card) IN ('object', 'null')),
    CHECK (score IS NULL OR (score >= 0.0 AND score <= 1.0)),
    CHECK (commit_created_at <= commit_updated_at)
) WITHOUT ROWID;
CREATE INDEX commits_problem_step ON commits (problem_id, step_number);

CREATE TABLE commit_files (
    user_id                 text NOT NULL,
    course_id               text NOT NULL,
    problem_set_id          text NOT NULL,
    problem_id              text NOT NULL,
    step_number             integer NOT NULL,
    path                    text NOT NULL,
    content                 blob NOT NULL,

    PRIMARY KEY (user_id, course_id, problem_set_id, problem_id, step_number, path),
    FOREIGN KEY (user_id, course_id, problem_set_id, problem_id, step_number)
        REFERENCES commits (user_id, course_id, problem_set_id, problem_id, step_number)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CHECK (trim(path) = path AND length(path) > 0),
    CHECK (
        path NOT GLOB '/*'
        AND path NOT GLOB './*'
        AND path NOT GLOB '../*'
        AND path NOT GLOB '*//*'
        AND path NOT GLOB '*/./*'
        AND path NOT GLOB '*/../*'
        AND path NOT GLOB '*/.'
        AND path NOT GLOB '*/..'
        AND path NOT IN ('.', '..')
    )
) WITHOUT ROWID;

CREATE VIEW user_role_flags AS
    SELECT
        users.*,
        EXISTS(SELECT 1 FROM authors WHERE authors.user_id = users.user_id) AS author,
        EXISTS(SELECT 1 FROM user_courses WHERE user_courses.user_id = users.user_id AND user_courses.is_instructor) AS instructor
    FROM users;

CREATE VIEW accessible_assignments AS
    SELECT
        viewer_user_id,
        assignment_user_id,
        course_id,
        problem_set_id,
        MAX(is_owner) AS is_owner,
        MAX(is_course_instructor) AS is_course_instructor,
        MIN(restricted) AS restricted
    FROM (
        SELECT
            assignments.user_id AS viewer_user_id,
            assignments.user_id AS assignment_user_id,
            assignments.course_id,
            assignments.problem_set_id,
            1 AS is_owner,
            0 AS is_course_instructor,
            assignments.restricted
        FROM assignments
        UNION ALL
        SELECT
            instructors.user_id AS viewer_user_id,
            assignments.user_id AS assignment_user_id,
            assignments.course_id,
            assignments.problem_set_id,
            0 AS is_owner,
            1 AS is_course_instructor,
            0 AS restricted
        FROM assignments
        JOIN user_courses AS instructors
            ON instructors.course_id = assignments.course_id
            AND instructors.is_instructor
    )
    GROUP BY viewer_user_id, assignment_user_id, course_id, problem_set_id;

CREATE VIEW accessible_problem_sets AS
    SELECT DISTINCT viewer_user_id, problem_set_id
    FROM accessible_assignments;

CREATE VIEW accessible_problems AS
    SELECT DISTINCT accessible_problem_sets.viewer_user_id, problem_set_problems.problem_id
    FROM accessible_problem_sets
    NATURAL JOIN problem_set_problems;

CREATE VIEW problem_set_continuations AS
    SELECT
        current_slice.problem_set_id,
        current_slice.problem_id,
        current_slice.first_step,
        current_slice.last_step,
        previous_slice.problem_set_id AS prerequisite_problem_set_id,
        previous_slice.first_step AS prerequisite_first_step,
        previous_slice.last_step AS prerequisite_step_number
    FROM problem_sets
    NATURAL JOIN problem_set_problems AS current_slice
    JOIN problem_set_problems AS previous_slice
        ON previous_slice.problem_set_id = problem_sets.continues_problem_set_id
        AND previous_slice.problem_id = current_slice.problem_id
        AND current_slice.first_step IS NOT NULL
        AND previous_slice.last_step = current_slice.first_step - 1;

CREATE VIEW problem_set_step_scope AS
    SELECT
        problem_set_problems.problem_set_id,
        problem_set_problems.problem_id,
        problem_set_problems.problem_weight,
        problem_set_problems.first_step,
        problem_set_problems.last_step,
        problem_steps.step_number,
        problem_steps.problem_type,
        problem_steps.step_note,
        problem_steps.step_weight
    FROM problem_set_problems
    NATURAL JOIN problem_steps
    WHERE (problem_set_problems.first_step IS NULL OR problem_steps.step_number >= problem_set_problems.first_step)
        AND (problem_set_problems.last_step IS NULL OR problem_steps.step_number <= problem_set_problems.last_step);

CREATE VIEW passed_commit_steps AS
    SELECT user_id, course_id, problem_set_id, problem_id, step_number
    FROM commits
    WHERE json_extract(report_card, '$.passed') = 1
        AND score = 1.0
    GROUP BY user_id, course_id, problem_set_id, problem_id, step_number;

CREATE VIEW assignment_list_fields AS
    SELECT
        assignments.user_id,
        assignments.course_id,
        assignments.problem_set_id,
        assignments.unlock_at,
        assignments.due_at,
        assignments.lock_at,
        CASE
            WHEN assignments.unlock_at IS NOT NULL AND datetime(assignments.unlock_at) > CURRENT_TIMESTAMP THEN 0
            ELSE 1
        END AS download_open,
        CASE
            WHEN problem_sets.continues_problem_set_id IS NULL THEN 1
            WHEN EXISTS (
                SELECT 1
                FROM problem_set_continuations
                JOIN passed_commit_steps
                    ON passed_commit_steps.user_id = assignments.user_id
                    AND passed_commit_steps.course_id = assignments.course_id
                    AND passed_commit_steps.problem_set_id = problem_set_continuations.prerequisite_problem_set_id
                    AND passed_commit_steps.problem_id = problem_set_continuations.problem_id
                    AND passed_commit_steps.step_number = problem_set_continuations.prerequisite_step_number
                WHERE problem_set_continuations.problem_set_id = assignments.problem_set_id
            ) THEN 1
            ELSE 0
        END AS prereq_ready,
        problem_sets.problem_set_note,
        courses.course_name,
        users.user_name,
        users.user_login,
        courses.course_name || ',' ||
        users.user_name || ',' || users.user_login || ',' ||
        problem_sets.problem_set_id || ',' || problem_sets.problem_set_note || ',' || problem_sets.problem_set_tags AS search_text
    FROM assignments
    NATURAL JOIN courses
    NATURAL JOIN users
    NATURAL JOIN problem_sets;

CREATE VIEW accessible_assignment_fields AS
    SELECT
        accessible_assignments.viewer_user_id,
        accessible_assignments.assignment_user_id,
        accessible_assignments.course_id,
        accessible_assignments.problem_set_id,
        accessible_assignments.is_owner,
        accessible_assignments.is_course_instructor,
        accessible_assignments.restricted,
        assignment_list_fields.unlock_at,
        assignment_list_fields.due_at,
        assignment_list_fields.lock_at,
        CASE
            WHEN accessible_assignments.is_course_instructor THEN 0
            WHEN NOT assignment_list_fields.download_open THEN 1
            WHEN NOT assignment_list_fields.prereq_ready THEN 2
            ELSE 0
        END AS download_status,
        CASE
            WHEN accessible_assignments.is_course_instructor THEN 1
            WHEN assignment_list_fields.download_open AND assignment_list_fields.prereq_ready THEN 1
            ELSE 0
        END AS download_available,
        assignment_list_fields.problem_set_note,
        assignment_list_fields.course_name,
        assignment_list_fields.user_name,
        assignment_list_fields.user_login,
        assignment_list_fields.search_text
    FROM accessible_assignments
    JOIN assignment_list_fields
        ON assignment_list_fields.user_id = accessible_assignments.assignment_user_id
        AND assignment_list_fields.course_id = accessible_assignments.course_id
        AND assignment_list_fields.problem_set_id = accessible_assignments.problem_set_id;

CREATE VIEW accessible_assignment_rows AS
    SELECT
        assignments.*,
        accessible_assignment_fields.viewer_user_id,
        accessible_assignment_fields.is_owner,
        accessible_assignment_fields.is_course_instructor,
        accessible_assignment_fields.restricted AS viewer_restricted,
        accessible_assignment_fields.download_status,
        accessible_assignment_fields.download_available
    FROM accessible_assignment_fields
    JOIN assignments
        ON assignments.user_id = accessible_assignment_fields.assignment_user_id
        AND assignments.course_id = accessible_assignment_fields.course_id
        AND assignments.problem_set_id = accessible_assignment_fields.problem_set_id;

CREATE VIEW accessible_assignment_commit_policy AS
    SELECT
        viewer_user_id,
        assignment_user_id,
        course_id,
        problem_set_id,
        is_owner,
        restricted,
        CASE
            WHEN lock_at IS NOT NULL AND datetime(lock_at) <= CURRENT_TIMESTAMP THEN 1
            ELSE 0
        END AS locked,
        CASE
            WHEN is_owner
                AND NOT (lock_at IS NOT NULL AND datetime(lock_at) <= CURRENT_TIMESTAMP)
            THEN 1
            ELSE 0
        END AS can_save_commit,
        CASE
            WHEN is_owner
                AND lock_at IS NOT NULL
                AND datetime(lock_at) <= CURRENT_TIMESTAMP
            THEN 1
            ELSE 0
        END AS not_saved_locked,
        CASE
            WHEN NOT is_owner THEN 1
            ELSE 0
        END AS not_saved_not_owner
    FROM accessible_assignment_fields;

CREATE VIEW assignment_scores AS
WITH problem_step_scores AS (
    SELECT
        assignments.user_id,
        assignments.course_id,
        assignments.problem_set_id,
        problem_set_step_scope.problem_id,
        CAST(problem_set_step_scope.problem_weight AS REAL) AS problem_weight,
        problem_set_step_scope.step_number,
        CAST(problem_set_step_scope.step_weight AS REAL) AS step_weight,
        commits.score AS commit_score
    FROM assignments
    NATURAL JOIN problem_set_step_scope
    NATURAL LEFT JOIN commits
),
problem_scores AS (
    SELECT
        user_id,
        course_id,
        problem_set_id,
        problem_id,
        problem_weight,
        CASE
            WHEN SUM(step_weight) <= 0 THEN 0.0
            ELSE SUM(COALESCE(commit_score, 0.0) * step_weight) / CAST(SUM(step_weight) AS REAL)
        END AS problem_score
    FROM problem_step_scores
    GROUP BY user_id, course_id, problem_set_id, problem_id, problem_weight
)
SELECT
    user_id,
    course_id,
    problem_set_id,
    CASE
        WHEN SUM(problem_weight) <= 0 THEN 0.0
        ELSE SUM(problem_score * problem_weight) / CAST(SUM(problem_weight) AS REAL)
    END AS assignment_score
FROM problem_scores
GROUP BY user_id, course_id, problem_set_id;

CREATE VIEW problem_total_steps AS
    SELECT problem_id, MAX(step_number) AS total_steps
    FROM problem_steps
    GROUP BY problem_id;

CREATE VIEW assignment_problem_progress AS
    SELECT
        assignments.user_id,
        assignments.course_id,
        assignments.problem_set_id,
        problem_set_step_scope.problem_id,
        problems.problem_note,
        MIN(problem_set_step_scope.step_number) AS first_step_number,
        MAX(problem_set_step_scope.step_number) AS last_step_number,
        COALESCE(
            MIN(
                CASE
                    WHEN problem_set_step_scope.step_number IS NOT NULL
                        AND passed_commit_steps.step_number IS NULL
                    THEN problem_set_step_scope.step_number
                END
            ),
            MAX(problem_set_step_scope.step_number)
        ) AS current_step_number
    FROM assignments
    NATURAL JOIN problem_set_step_scope
    NATURAL JOIN problems
    NATURAL LEFT JOIN passed_commit_steps
    GROUP BY
        assignments.user_id,
        assignments.course_id,
        assignments.problem_set_id,
        problem_set_step_scope.problem_id,
        problems.problem_note;

CREATE VIEW problem_step_whitelist AS
SELECT
    problem_steps.problem_id,
    problem_steps.step_number,
    COALESCE(
        (
            SELECT json_group_object(paths.path, 1)
            FROM (
                SELECT DISTINCT problem_step_files.path
                FROM problem_step_files
                WHERE problem_step_files.problem_id = problem_steps.problem_id
                    AND problem_step_files.step_number = problem_steps.step_number
                    AND problem_step_files.file_type = 'solution'
                ORDER BY problem_step_files.path
            ) AS paths
        ),
        '{}'
    ) AS whitelist
FROM problem_steps;

CREATE VIEW workspace_step_context AS
    SELECT
        assignment_problem_progress.user_id,
        assignment_problem_progress.course_id,
        assignment_problem_progress.problem_set_id,
        assignment_problem_progress.problem_id,
        assignment_problem_progress.problem_note,
        assignment_problem_progress.current_step_number,
        assignment_problem_progress.first_step_number,
        assignment_problem_progress.last_step_number,
        problem_set_step_scope.step_number,
        problem_set_step_scope.problem_type,
        problem_set_step_scope.step_note,
        problem_set_step_scope.step_weight,
        problem_step_whitelist.whitelist
    FROM assignment_problem_progress
    NATURAL JOIN problem_set_step_scope
    NATURAL JOIN problem_step_whitelist;

CREATE VIEW grading_step_context AS
    SELECT
        problem_set_step_scope.problem_set_id,
        problem_set_step_scope.problem_id,
        problem_set_step_scope.step_number,
        problems.problem_note,
        problems.problem_options,
        problem_set_step_scope.problem_type,
        problem_types.container,
        COALESCE(problem_total_steps.total_steps, 1) AS total_steps,
        problem_step_whitelist.whitelist
    FROM problem_set_step_scope
    NATURAL JOIN problems
    NATURAL JOIN problem_types
    NATURAL LEFT JOIN problem_total_steps
    NATURAL JOIN problem_step_whitelist;

CREATE VIEW problem_set_search_fields AS
    SELECT problem_sets.problem_set_id,
        problem_sets.problem_set_id || ',' ||
        problem_sets.problem_set_note || ',' ||
        problem_sets.problem_set_tags || ',' ||
        group_concat(problems.problem_id, ',') || ',' ||
        group_concat(problems.problem_note, ',') || ',' ||
        group_concat(problems.problem_tags, ',') AS search_text
    FROM problem_sets
    NATURAL JOIN problem_set_problems
    NATURAL JOIN problems
    GROUP BY problem_sets.problem_set_id;

CREATE VIEW problem_catalog_sets AS
    SELECT
        problem_sets.problem_set_id,
        problem_sets.problem_set_note,
        problem_sets.problem_set_tags,
        problem_set_search_fields.search_text
    FROM problem_sets
    NATURAL JOIN problem_set_search_fields;

CREATE VIEW accessible_problem_catalog_sets AS
    SELECT
        accessible_problem_sets.viewer_user_id,
        problem_catalog_sets.problem_set_id,
        problem_catalog_sets.problem_set_note,
        problem_catalog_sets.problem_set_tags,
        problem_catalog_sets.search_text
    FROM accessible_problem_sets
    NATURAL JOIN problem_catalog_sets;

CREATE VIEW problem_catalog_rows AS
    SELECT
        problem_sets.problem_set_id,
        problem_sets.problem_set_note,
        problem_sets.problem_set_tags,
        problem_set_step_scope.problem_id,
        problem_set_step_scope.problem_weight,
        problems.problem_note,
        problem_set_step_scope.step_number,
        problem_set_step_scope.step_note,
        problem_set_step_scope.step_weight
    FROM problem_sets
    NATURAL JOIN problem_set_step_scope
    NATURAL JOIN problems
    GROUP BY
        problem_sets.problem_set_id,
        problem_sets.problem_set_note,
        problem_sets.problem_set_tags,
        problem_set_step_scope.problem_id,
        problem_set_step_scope.problem_weight,
        problems.problem_note,
        problem_set_step_scope.step_number,
        problem_set_step_scope.step_note,
        problem_set_step_scope.step_weight;
