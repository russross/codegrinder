@codegrinder.proto defines the gRPC protocol. To work around a bug
in grpc-web I had to eliminate all "map" types in the protocol,
replacing them with repeated types instead. Here was the spec for
the conversion that gives important clues about how the new types
relate to the old:

*   `Assignment.raw_scores`: make a helper type called `ScoreEntry` with `string
    key` and `repeated double` fields and then change `raw_scores` to be
    `repeated ScoreEntry`.                                         
*   `ProblemType.files`: make a helper type `File` with `string path` and `bytes
    contents` fields and change `files` to be `repeated File`.          
*   `ProblemType.actions`: just change this to `repeated ProblemTypeAction` as
    the key was just a copy of `ProblemTypeAction.action` anyway and can be
    recreated.
*   `ProblemStep.files`: re-use the `File` helper type and change this to
    `repeated File`.
*   `ProblemStep.whitelist`: just change this to `repeated string` as it is
    really just a set of names and the boolean value is never used.
*   `ProblemStep.solution`: make this `repeated File`
*   `EventMessage.files`: make this `repeated File`
*   `Commit.files`: make this `repeated File`
*   `ProblemBundle.problem_types`: make this `repeated ProblemType`; the key is
    just the `ProblemType.name` field and can be recreated.
*   `ProblemBundle.problem_type_signatures`: make a helper type `Signature` that
    has `problem_type string` (the map key) and `signature string` (the map
    value) and change `problem_type_signatures` to be `repeated Signature`.

Update @index.js to use the new types, using conversion strategies
based on the spec given above.

This will involve a bunch of little changes through index.js. It is
not a big file, so read the entire file, plan the changes out, and
write the changes in bulk rather than with lots of litle edits.
