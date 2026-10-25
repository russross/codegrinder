use std::ffi::OsString;
use std::io::{self, Write};
use std::os::unix::ffi::OsStrExt;

use crate::transcript::{Action, Stream, Transcript};

pub fn color(out: &mut impl Write, style: &str, text: &[u8]) -> io::Result<()> {
    write!(out, "\x1b[{style}m")?;
    out.write_all(text)?;
    out.write_all(b"\x1b[0m\n")
}

fn octal(out: &mut impl Write, byte: u8) -> io::Result<()> {
    write!(out, "\\{byte:03o}")
}

// Render bytes rather than decoded text. Student controls cannot alter terminal
// formatting, while valid UTF-8 and arbitrary high bytes keep their original form.
pub fn render(out: &mut impl Write, bytes: &[u8], action: Action, inverse: bool) -> io::Result<()> {
    for line in bytes.split_inclusive(|&b| b == b'\n') {
        out.write_all(match action {
            Action::Input => b"\x1b[36m",
            Action::Output(Stream::Err) => b"\x1b[35m",
            Action::Output(Stream::Out) => b"",
        })?;
        if inverse {
            out.write_all(b"\x1b[7m")?;
        }
        let terminated = line.last() == Some(&b'\n');
        let content = if terminated { &line[..line.len() - 1] } else { line };
        for &byte in content {
            match byte {
                b'\t' => out.write_all(b"\\t")?,
                b'\r' => out.write_all(b"\\r")?,
                0..=31 | 127 => octal(out, byte)?,
                _ => out.write_all(&[byte])?,
            }
        }
        out.write_all(if terminated {
            "\x1b[2m⏎\x1b[0m\n".as_bytes()
        } else {
            b"\x1b[2m [no newline]\x1b[0m\n"
        })?;
    }
    Ok(())
}

// The byte limit is applied before the line limit. Cutting through a line must
// retain its unfinished marker instead of inventing a newline at the boundary.
pub fn context(out: &mut impl Write, bytes: &[u8], stream: Stream) -> io::Result<()> {
    let limited = &bytes[..bytes.len().min(20_000)];
    let end = limited
        .iter()
        .enumerate()
        .filter(|(_, b)| **b == b'\n')
        .nth(4)
        .map_or(limited.len(), |(i, _)| i + 1);
    render(out, &limited[..end], Action::Output(stream), true)?;
    if end < bytes.len() {
        color(out, "2", b"[output truncated]")?;
    }
    Ok(())
}

pub fn expected_context(
    out: &mut impl Write,
    transcript: &Transcript,
    stream: Stream,
    first: usize,
    end: usize,
) -> io::Result<()> {
    let indexes = &transcript.expected[stream.index()][first..end];
    let mut bytes = Vec::new();
    let mut truncated = indexes.len() > 5;
    for &record in indexes.iter().take(5) {
        let payload = transcript.payload(record);
        let count = payload.len().min(20_000 - bytes.len());
        bytes.extend_from_slice(&payload[..count]);
        truncated |= count < payload.len();
    }
    render(out, &bytes, Action::Output(stream), false)?;
    if truncated {
        color(out, "2", b"[expected output truncated]")?;
    }
    Ok(())
}

pub fn command(argv: &[OsString]) -> Vec<u8> {
    let mut bytes = vec![b'$'];
    for arg in argv {
        bytes.push(b' ');
        bytes.extend_from_slice(arg.as_bytes());
    }
    bytes.push(b'\n');
    bytes
}
