CREATE TABLE problem_types (
    name                    text NOT NULL,
    image                   text NOT NULL,

    PRIMARY KEY (name)
);

CREATE TABLE problem_type_actions (
    problem_type            text NOT NULL,
    action                  text NOT NULL,
    button                  text NOT NULL,
    message                 text NOT NULL,
    interactive             boolean NOT NULL,
    max_cpu                 bigint NOT NULL,
    max_session             bigint NOT NULL,
    max_timeout             bigint NOT NULL,
    max_fd                  bigint NOT NULL,
    max_file_size           bigint NOT NULL,
    max_memory              bigint NOT NULL,
    max_threads             bigint NOT NULL,

    PRIMARY KEY (problem_type, action),
    FOREIGN KEY (problem_type) REFERENCES problem_types (name) ON DELETE CASCADE
);

CREATE TABLE problems (
    id                      bigserial NOT NULL,
    unique_id               text NOT NULL,
    note                    text NOT NULL,
    problem_type            text NOT NULL,
    tags                    jsonb NOT NULL,
    options                 jsonb NOT NULL,
    created_at              timestamp with time zone NOT NULL,
    updated_at              timestamp with time zone NOT NULL,

    PRIMARY KEY (id),
    FOREIGN KEY (problem_type) REFERENCES problem_types (name) ON DELETE CASCADE
);
CREATE UNIQUE INDEX problems_unique_id ON problems (unique_id);

CREATE TABLE problem_steps (
    problem_id              bigint NOT NULL,
    step                    bigint NOT NULL,
    note                    text NOT NULL,
    instructions            text NOT NULL,
    weight                  double precision NOT NULL,
    files                   json NOT NULL,

    PRIMARY KEY (problem_id, step),
    FOREIGN KEY (problem_id) REFERENCES problems (id) ON DELETE CASCADE
);

CREATE TABLE problem_sets (
    id                      bigserial NOT NULL,
    unique_id               text NOT NULL,
    note                    text NOT NULL,
    tags                    jsonb NOT NULL,
    created_at              timestamp with time zone NOT NULL,
    updated_at              timestamp with time zone NOT NULL,

    PRIMARY KEY (id)
);
CREATE UNIQUE INDEX problem_sets_unique_id ON problem_sets (unique_id);

CREATE TABLE problem_set_problems (
    problem_set_id          bigint NOT NULL,
    problem_id              bigint NOT NULL,
    weight                  double precision NOT NULL,

    PRIMARY KEY (problem_set_id, problem_id),
    FOREIGN KEY (problem_set_id) REFERENCES problem_sets (id) ON DELETE CASCADE,
    FOREIGN KEY (problem_id) REFERENCES problems (id) ON DELETE CASCADE
);

CREATE TABLE courses (
    id                      bigserial NOT NULL,
    name                    text NOT NULL,
    lti_label               text NOT NULL,
    lti_id                  text NOT NULL,
    canvas_id               bigint NOT NULL,
    created_at              timestamp with time zone NOT NULL,
    updated_at              timestamp with time zone NOT NULL,

    PRIMARY KEY (id)
);
CREATE UNIQUE INDEX courses_lti_id ON courses (lti_id);
CREATE UNIQUE INDEX courses_canvas_id ON courses (canvas_id);

CREATE TABLE users (
    id                      bigserial NOT NULL,
    name                    text NOT NULL,
    email                   text NOT NULL,
    lti_id                  text NOT NULL,
    lti_image_url           text,
    canvas_login            text NOT NULL,
    canvas_id               bigint NOT NULL,
    author                  boolean NOT NULL,
    admin                   boolean NOT NULL,
    created_at              timestamp with time zone NOT NULL,
    updated_at              timestamp with time zone NOT NULL,
    last_signed_in_at       timestamp with time zone NOT NULL,

    PRIMARY KEY (id)
);
CREATE UNIQUE INDEX users_lti_id ON users (lti_id);
CREATE UNIQUE INDEX users_canvas_login ON users (canvas_login);
CREATE UNIQUE INDEX users_canvas_id ON users (canvas_id);

CREATE TABLE assignments (
    id                      bigserial NOT NULL,
    course_id               bigint NOT NULL,
    problem_set_id          bigint,
    user_id                 bigint NOT NULL,
    roles                   text NOT NULL,
    instructor              boolean NOT NULL,
    raw_scores              jsonb NOT NULL,
    score                   double precision,
    grade_id                text,
    lti_id                  text NOT NULL,
    canvas_title            text NOT NULL,
    canvas_id               bigint NOT NULL,
    canvas_api_domain       text NOT NULL,
    outcome_url             text NOT NULL,
    outcome_ext_url         text NOT NULL,
    outcome_ext_accepted    text NOT NULL,
    finished_url            text NOT NULL,
    consumer_key            text NOT NULL,
    unlock_at               timestamp with time zone,
    due_at                  timestamp with time zone,
    lock_at                 timestamp with time zone,
    created_at              timestamp with time zone NOT NULL,
    updated_at              timestamp with time zone NOT NULL,

    PRIMARY KEY (id),
    FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
    FOREIGN KEY (problem_set_id) REFERENCES problem_sets (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX assignments_unique_user ON assignments (user_id, lti_id);
CREATE UNIQUE INDEX assignments_grade_id ON assignments (grade_id);
CREATE INDEX assignments_instructor_lti_id ON assignments (instructor, lti_id);

CREATE TABLE commits (
    id                      bigserial NOT NULL,
    assignment_id           bigint NOT NULL,
    problem_id              bigint NOT NULL,
    step                    bigint NOT NULL,
    action                  text,
    note                    text,
    files                   json NOT NULL,
    transcript              json NOT NULL,
    report_card             json NOT NULL,
    score                   double precision,
    created_at              timestamp with time zone NOT NULL,
    updated_at              timestamp with time zone NOT NULL,

    PRIMARY KEY (id),
    FOREIGN KEY (assignment_id) REFERENCES assignments (id) ON DELETE CASCADE,
    FOREIGN KEY (problem_id, step) REFERENCES problem_steps (problem_id, step) ON DELETE CASCADE
);
CREATE UNIQUE INDEX commits_unique_assignment_problem_step ON commits (assignment_id, problem_id, step);

CREATE VIEW user_problem_sets AS
    (SELECT DISTINCT assignments.user_id, problem_sets.id AS problem_set_id FROM
    assignments JOIN problem_sets ON assignments.problem_set_id = problem_sets.id
    WHERE assignments.problem_set_id IS NOT NULL)
    UNION
    (SELECT DISTINCT instructors.id AS user_id, assignments.problem_set_id AS problem_set_id FROM
    users AS instructors JOIN assignments AS instructors_assignments ON instructors.id = instructors_assignments.user_id
    JOIN courses ON instructors_assignments.course_id = courses.id
    JOIN assignments ON courses.id = assignments.course_id
    WHERE instructors_assignments.instructor
    AND assignments.problem_set_id IS NOT NULL
    AND instructors_assignments.problem_set_id IS NOT NULL);

CREATE VIEW user_problems AS
    (SELECT DISTINCT assignments.user_id, problem_set_problems.problem_id FROM
    assignments JOIN problem_sets ON assignments.problem_set_id = problem_sets.id
    JOIN problem_set_problems ON problem_sets.id = problem_set_problems.problem_set_id
    WHERE assignments.problem_set_id IS NOT NULL)
    UNION
    (SELECT DISTINCT instructors.id AS user_id, problem_set_problems.problem_id FROM
    users AS instructors JOIN assignments AS instructors_assignments ON instructors.id = instructors_assignments.user_id
    JOIN courses ON instructors_assignments.course_id = courses.id
    JOIN assignments ON courses.id = assignments.course_id
    JOIN problem_sets ON assignments.problem_set_id = problem_sets.id
    JOIN problem_set_problems ON problem_sets.id = problem_set_problems.problem_id
    WHERE instructors_assignments.instructor
    AND assignments.problem_set_id IS NOT NULL
    AND instructors_assignments.problem_set_id IS NOT NULL);

CREATE VIEW user_users AS
    (SELECT DISTINCT instructors.id AS user_id, users.id AS other_user_id FROM
    users AS instructors JOIN assignments AS instructors_assignments ON instructors.id = instructors_assignments.user_id
    JOIN courses ON instructors_assignments.course_id = courses.id
    JOIN assignments ON courses.id = assignments.course_id
    JOIN users ON assignments.user_id = users.id
    WHERE instructors_assignments.instructor)
    UNION
    (SELECT id as user_id, id AS other_user_id FROM users);

CREATE VIEW user_assignments AS
    (SELECT DISTINCT instructors.id AS user_id, assignments.id AS assignment_id FROM
    users AS instructors JOIN assignments AS instructors_assignments ON instructors.id = instructors_assignments.user_id
    JOIN courses ON instructors_assignments.course_id = courses.id
    JOIN assignments ON courses.id = assignments.course_id
    WHERE instructors_assignments.instructor)
    UNION
    (SELECT user_id, id as assignment_id FROM assignments);

CREATE VIEW assignment_search_fields AS
    (SELECT assignments.id AS assignment_id,
        assignments.canvas_title || ',' ||
        courses.name || ',' ||
        users.name || ',' || users.email || ',' ||
        problem_sets.unique_id || ',' || problem_sets.note || ',' || problem_sets.tags::text AS search_text
    FROM assignments JOIN courses ON assignments.course_id = courses.id
    JOIN users ON assignments.user_id = users.id
    JOIN problem_sets ON assignments.problem_set_id = problem_sets.id
    WHERE assignments.problem_set_id IS NOT NULL);

CREATE VIEW problem_set_search_fields AS
    (SELECT problem_sets.id AS problem_set_id,
        problem_sets.unique_id || ',' ||
        problem_sets.note || ',' ||
        problem_sets.tags::text || ',' ||
        string_agg(problems.unique_id, ',') || ',' ||
        string_agg(problems.note, ',') || ',' ||
        string_agg(problems.tags::text, ',') AS search_text
    FROM problem_sets JOIN problem_set_problems ON problem_sets.id = problem_set_problems.problem_set_id
    JOIN problems ON problem_set_problems.problem_id = problems.id
    GROUP BY problem_sets.id);

CREATE TABLE quizzes (
    id                      bigserial NOT NULL,
    assignment_id           bigint NOT NULL,
    lti_id                  text NOT NULL,
    note                    text NOT NULL,
    weight                  double precision NOT NULL,
    participation_threshold double precision NOT NULL,
    participation_percent   double precision NOT NULL,
    is_graded               boolean NOT NULL,
    created_at              timestamp with time zone NOT NULL,
    updated_at              timestamp with time zone NOT NULL,

    PRIMARY KEY (id),
    FOREIGN KEY (assignment_id) REFERENCES assignments (id) ON DELETE CASCADE
);

CREATE TABLE questions (
    id                      bigserial NOT NULL,
    quiz_id                 bigint NOT NULL,
    question_number         bigint NOT NULL,
    note                    text NOT NULL,
    weight                  double precision NOT NULL,
    points_for_attempt      double precision NOT NULL,
    is_multiple_choice      boolean NOT NULL,
    answers                 jsonb NOT NULL,
    closed_at               timestamp with time zone,
    created_at              timestamp with time zone NOT NULL,
    updated_at              timestamp with time zone NOT NULL,

    PRIMARY KEY (id),
    FOREIGN KEY (quiz_id) REFERENCES quizzes (id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX questions_quiz_id_index_number ON questions (quiz_id, question_number);

CREATE TABLE responses (
    id                      bigserial NOT NULL,
    assignment_id           bigint NOT NULL,
    question_id             bigint NOT NULL,
    response                text NOT NULL,
    created_at              timestamp with time zone NOT NULL,
    updated_at              timestamp with time zone NOT NULL,

    PRIMARY KEY (id),
    FOREIGN KEY (assignment_id) REFERENCES assignments (id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions (id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX responses_assignment_id_question_id ON responses (assignment_id, question_id);
