from __future__ import annotations

import codegrinder_pb2 as pb
from protocol import dump_event, dump_transcript


def test_dump_event_exit_signal_and_error_format() -> None:
    killed = pb.EventMessage(event="exit", exit_status=137)
    assert "SIGKILL" in dump_event(killed)

    errored = pb.EventMessage(event="error", error="boom")
    assert dump_event(errored) == "Error: boom\r\n"


def test_dump_transcript_preserves_order_and_raw_stream_bytes() -> None:
    commit = pb.Commit(
        transcript=[
            pb.EventMessage(event="exec", exec_command=["python", "main.py"]),
            pb.EventMessage(event="stdout", stream_data=b"hello\n"),
            pb.EventMessage(event="exit", exit_status=0),
        ]
    )
    text = dump_transcript(commit)
    assert text.startswith("$ python main.py\r\n")
    assert text.endswith("hello\n")
