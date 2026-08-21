use crate::proto::codegrinder::{Commit, EventMessage};

pub fn dump_event(event: &EventMessage) -> String {
    match event.event.as_str() {
        "exec" => format!("$ {}\r\n", event.exec_command.join(" ")),
        "exit" => {
            if event.exit_status == 0 {
                String::new()
            } else if let Some(name) = signal_name(event.exit_status - 128) {
                format!("exit status {} (killed by {name})\r\n", event.exit_status)
            } else {
                format!("exit status {}\r\n", event.exit_status)
            }
        }
        "stdin" | "stdout" | "stderr" => String::from_utf8_lossy(&event.stream_data).to_string(),
        "error" => format!("Error: {}\r\n", event.error),
        _ => String::new(),
    }
}

pub fn dump_transcript(commit: &Commit) -> String {
    commit.transcript.iter().map(dump_event).collect()
}

fn signal_name(signal: i32) -> Option<&'static str> {
    match signal {
        1 => Some("SIGHUP"),
        2 => Some("SIGINT"),
        3 => Some("SIGQUIT"),
        4 => Some("SIGILL"),
        5 => Some("SIGTRAP"),
        6 => Some("SIGABRT"),
        7 => Some("SIGBUS"),
        8 => Some("SIGFPE"),
        9 => Some("SIGKILL"),
        10 => Some("SIGUSR1"),
        11 => Some("SIGSEGV"),
        12 => Some("SIGUSR2"),
        13 => Some("SIGPIPE"),
        14 => Some("SIGALRM"),
        15 => Some("SIGTERM"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{dump_event, dump_transcript};
    use crate::proto::codegrinder::{Commit, EventMessage};

    #[test]
    fn dump_event_exit_signal_and_error_format() {
        assert!(
            dump_event(&EventMessage {
                event: "exit".to_string(),
                exit_status: 137,
                ..EventMessage::default()
            })
            .contains("SIGKILL")
        );
        assert_eq!(
            dump_event(&EventMessage {
                event: "error".to_string(),
                error: "boom".to_string(),
                ..EventMessage::default()
            }),
            "Error: boom\r\n"
        );
    }

    #[test]
    fn dump_transcript_preserves_order_and_raw_stream_bytes() {
        let commit = Commit {
            transcript: vec![
                EventMessage {
                    event: "exec".to_string(),
                    exec_command: vec!["python".to_string(), "main.py".to_string()],
                    ..EventMessage::default()
                },
                EventMessage {
                    event: "stdout".to_string(),
                    stream_data: b"hello\n".to_vec(),
                    ..EventMessage::default()
                },
            ],
            ..Commit::default()
        };
        let text = dump_transcript(&commit);
        assert!(text.starts_with("$ python main.py\r\n"));
        assert!(text.ends_with("hello\n"));
    }
}
