# General project rules

For Python server checks:

- The server is its own uv project under `server/`; run server pytest from that directory with `uv run pytest tests`.
- Do not run server tests from the repo root with `uv run --project server pytest`; pytest will collect unrelated repo paths such as `certs/` and CLI tests, and imports will not match the server test layout.

For protocol changes:

- Backware compatibility of the protocol is NOT a goal
- Always clean up/remove fields that are not actually used
- Favor flattening message data types where appropriate
- Client does not know/care about database layout—protocol should minimize leaking relational database structure
- Preserve `session_cookie` request fields where they help future web-gRPC integration, even if the current Python gRPC path authenticates through metadata instead


# CLI Config

- CLI config uses XDG conventions: `$XDG_CONFIG_HOME/codegrinder/config.toml`, defaulting to `~/.config/codegrinder/config.toml`.
- Do not use legacy `~/.codegrinderrc` or `~/.codegrinderinstructor` files.
- The config file is TOML and is created on login.
- Login updates only the auth cookie/token and server URL; preserve user-editable settings such as workspace root and instructor mode when the file already exists.
- The workspace root setting controls where per-course assignment directories are created. Default it to `$HOME` and explicitly write that default to the config file.
- Instructor mode is an optional TOML boolean line. Omit it for normal student configs; missing means `false`.


# Protocol Naming

- Use `Get` for single-item reads, `List` for plural reads, and `Search` for query-style discovery.
- Use `Prepare...` for TA requests that validate/package/sign artifacts without persisting anything.
- Use `Save...` for final persistence when create/update share one endpoint.


# Authoring Semantics

- Authoring requests are shaped around uploaded author source material, not around stored database rows or daycare package internals.
- The CLI uploads only:
  - problem/problem-set metadata from `.cfg`
  - ordered steps
  - per-step authored files from the main tree
  - per-step starter files from `_starter/`
  - explicit create/update intent
- The CLI does not attempt to identify solution files, system files, or cumulative student-owned files.
- The CLI does not attempt to stitch together step-to-step continuity.
- The server does all `.gitignore` processing.
- The CLI reports whitespace issues but must not normalize file contents.
- Whitespace normalization is removed completely. What the author supplies is what gets stored in the problem.
- The CLI should report one log line per affected text file for whitespace issues such as non-Unix line endings and trailing spaces, but continue processing.
- `.gitignore` handling is hierarchical and based on the effective overlaid step tree, not just the uploaded problem files.
- Problem type files are authoritative and trump uploaded author files.
- Server-side file processing order is:
  - start with the uploaded file set
  - overlay canonical problem type files on top
  - process hierarchical `.gitignore` rules on the resulting effective tree
- Uploaded files that collide with canonical problem type files must not be stored as problem step files.
- Instructions are a convention, not protocol schema. There is no special instructions field, no markdown rendering rule, and no required documentation path.
- Authoring layout is standardized:
  - authored files live in the main step directory tree
  - starter files live in `_starter/`
  - old alternate starter/solution layouts are not supported
- The server derives the cumulative student-owned file set as the union of starter-file paths introduced in the current and prior steps.
- The server infers solution files from the effective authored file set using that cumulative student-owned file set.
- The server validates continuity between steps: every cumulative student-owned file must have a solution file in each step.
- The server strips problem type files from persisted problem step files.
- Daycare-facing blobs for author validation use the same grading-commit shape as the student grading flow.
- Author save requests must carry explicit intent:
  - create request => error if problem/problem set already exists
  - update request => error if problem/problem set does not exist
- Do not add separate preflight existence checks purely to distinguish create from update. Catch that error at save time.
