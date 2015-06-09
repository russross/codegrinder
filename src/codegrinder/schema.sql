CREATE TABLE problems (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  unique_id text UNIQUE NOT NULL,
  description text,
  problem_type text NOT NULL,
  tags json NOT NULL,
  options json NOT NULL,
  steps json NOT NULL,
  confirmed boolean NOT NULL,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL
);

CREATE TABLE users (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  lti_id text UNIQUE NOT NULL,
  lti_image_url text,
  canvas_login text UNIQUE NOT NULL,
  canvas_id bigint UNIQUE NOT NULL,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL,
  last_signed_in_at timestamp with time zone NOT NULL
);

CREATE TABLE courses (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  lti_label text UNIQUE NOT NULL,
  lti_id text UNIQUE NOT NULL,
  canvas_id bigint UNIQUE NOT NULL,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL
);

CREATE TABLE assignments (
  id bigserial PRIMARY KEY,
  course_id bigint NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  problem_id bigint NOT NULL REFERENCES problems (id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  roles text NOT NULL,
  points numeric,
  survey json NOT NULL,
  grade_id text UNIQUE,
  lti_id text NOT NULL,
  canvas_title text NOT NULL,
  canvas_id bigint NOT NULL,
  canvas_api_domain text NOT NULL,
  outcome_url text NOT NULL,
  outcome_ext_url text NOT NULL,
  outcome_ext_accepted text NOT NULL,
  finished_url text NOT NULL,
  consumer_key text NOT NULL,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL
);
CREATE UNIQUE INDEX assignments_unique_user ON assignments (user_id, lti_id);

CREATE TABLE commits (
  id bigserial PRIMARY KEY,
  assignment_id bigint NOT NULL REFERENCES assignments (id) ON DELETE CASCADE,
  problem_step_number bigint NOT NULL,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  closed boolean NOT NULL,
  action text,
  comment text,
  files json NOT NULL,
  transcript json NOT NULL,
  report_card json NOT NULL,
  score numeric,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL
);
