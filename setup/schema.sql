CREATE TYPE problem_types AS ENUM (
    'python27inout',
    'python27unittest',
    'cppgtest',
    'cppinout',
    'gotest',
    'nand2tetrishardware',
    'nand2tetrisassembly',
    'nasmgtest',
    'ocamlounit',
    'prologunittest',
    'standardmlunittest'
);

CREATE TABLE problems (
    id                      bigserial NOT NULL,
    unique_id               text NOT NULL,
    note                    text NOT NULL,
    problem_type            problem_types NOT NULL,
    tags                    jsonb NOT NULL,
    options                 jsonb NOT NULL,
    created_at              timestamp with time zone NOT NULL,
    updated_at              timestamp with time zone NOT NULL,

    PRIMARY KEY (id)
);
CREATE UNIQUE INDEX problems_unique_id ON problems (unique_id);

CREATE TABLE problem_steps (
    problem_id              bigint NOT NULL,
    step                    bigint NOT NULL,
    note                    text NOT NULL,
    instructions            text NOT NULL,
    weight                  double precision NOT NULL,
    files                   jsonb NOT NULL,

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
CREATE UNIQUE INDEX courses_lti_label ON courses (lti_label);
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
    problem_set_id          bigint NOT NULL,
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
    created_at              timestamp with time zone NOT NULL,
    updated_at              timestamp with time zone NOT NULL,

    PRIMARY KEY (id),
    FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
    FOREIGN KEY (problem_set_id) REFERENCES problem_sets (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX assignments_unique_user ON assignments (user_id, lti_id);
CREATE UNIQUE INDEX assignments_grade_id ON assignments (grade_id);

CREATE TABLE commits (
    id                      bigserial NOT NULL,
    assignment_id           bigint NOT NULL,
    problem_id              bigint NOT NULL,
    step                    bigint NOT NULL,
    action                  text,
    note                    text,
    files                   jsonb NOT NULL,
    transcript              jsonb NOT NULL,
    report_card             jsonb NOT NULL,
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
    assignments JOIN problem_sets ON assignments.problem_set_id = problem_sets.id)
    UNION
    (SELECT DISTINCT instructors.id AS user_id, assignments.problem_set_id AS problem_set_id FROM
    users AS instructors JOIN assignments AS instructors_assignments ON instructors.id = instructors_assignments.user_id
    JOIN courses ON instructors_assignments.course_id = courses.id
    JOIN assignments ON courses.id = assignments.id
    WHERE instructors_assignments.instructor);

CREATE VIEW user_problems AS
    (SELECT DISTINCT assignments.user_id, problem_set_problems.problem_id FROM
    assignments JOIN problem_sets ON assignments.problem_set_id = problem_sets.id
    JOIN problem_set_problems ON problem_sets.id = problem_set_problems.problem_set_id)
    UNION
    (SELECT DISTINCT instructors.id AS user_id, problem_set_problems.problem_id FROM
    users AS instructors JOIN assignments AS instructors_assignments ON instructors.id = instructors_assignments.user_id
    JOIN courses ON instructors_assignments.course_id = courses.id
    JOIN assignments ON courses.id = assignments.id
    JOIN problem_sets ON assignments.problem_set_id = problem_sets.id
    JOIN problem_set_problems ON problem_sets.id = problem_set_problems.problem_id
    WHERE instructors_assignments.instructor);

CREATE VIEW user_users AS
    (SELECT DISTINCT instructors.id AS user_id, users.id AS other_user_id FROM
    users AS instructors JOIN assignments AS instructors_assignments ON instructors.id = instructors_assignments.user_id
    JOIN courses ON instructors_assignments.course_id = courses.id
    JOIN assignments ON courses.id = assignments.id
    JOIN users ON assignments.user_id = users.id
    WHERE instructors_assignments.instructor)
    UNION
    (SELECT id as user_id, id AS other_user_id FROM users);

CREATE VIEW user_assignments AS
    (SELECT DISTINCT instructors.id AS user_id, assignments.id AS assignment_id FROM
    users AS instructors JOIN assignments AS instructors_assignments ON instructors.id = instructors_assignments.user_id
    JOIN courses ON instructors_assignments.course_id = courses.id
    JOIN assignments ON courses.id = assignments.id
    WHERE instructors_assignments.instructor)
    UNION
	(SELECT user_id, id as assignment_id FROM assignments);
