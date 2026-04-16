from __future__ import annotations

import logging
from pathlib import Path

import codegrinder_pb2 as pb

from errors import CliError
from helpers import clean_error, dump_message, grpc_metadata
from rpc_client import CodeGrinderClient
from protocol import dump_event


def handle_daycare_stream(
    client: CodeGrinderClient,
    bundle: pb.SignedRuntimeBundle,
    args: list[str],
    directory: Path,
    process_events: bool,
) -> pb.SignedRuntimeBundle | None:
    request = pb.DaycareRequest(bundle=bundle, args=args)
    dump_message(client.config, "Daycare", True, request)
    try:
        stream = client.session.stub.Daycare(request, metadata=grpc_metadata(client.config.cookie))
    except Exception as exc:
        raise CliError(f"error starting Daycare session: {clean_error(exc)}") from exc
    dump_message(client.config, "Daycare", False, None)

    for reply in stream:
        if reply.error:
            dump_message(client.config, "Daycare Error", False, reply.error)
            raise CliError(f"server returned an error: {reply.error}")
        if reply.HasField("bundle"):
            dump_message(client.config, "Daycare Bundle", False, reply.bundle)
            return reply.bundle
        if reply.HasField("event"):
            event = reply.event
            dump_message(client.config, "Daycare Event", False, event)
            if event.event in {"exec", "stdin", "stdout", "exit", "error", "stderr"}:
                if process_events:
                    print(dump_event(event), end="")
            elif event.event == "files" and process_events and event.files and str(directory):
                for name, contents in event.files.items():
                    logging.error("downloading file %s", name)
                    path = directory / Path(name)
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(contents)
            continue
        raise CliError("unexpected reply from server")

    logging.error("session closed by server")
    return None
