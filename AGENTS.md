# General project rules

- Current project is refactoring gRPC protocol to be clean, streamlined, and shaped around current usage
- Backware compatibility of the protocol is NOT a goal
- Always clean up/remove fields that are not actually used
- Favor flattening message data types where appropriate
- Client does not know/care about database layout—protocol should minimize leaking relational database structure
- Preserve `session_cookie` request fields where they help future web-gRPC integration, even if the current Python gRPC path authenticates through metadata instead


# Protocol Naming

- Use `Get` for single-item reads, `List` for plural reads, and `Search` for query-style discovery.
- Use `Prepare...` for TA requests that validate/package/sign artifacts without persisting anything.
- Use `Save...` for final persistence when create/update share one endpoint.
