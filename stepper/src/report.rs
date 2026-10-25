use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use std::time::Duration;

use crate::{Error, sys};

// Remove only SGR sequences used by the shell's plain-log filter. Other escape
// sequences remain visible as octal bytes rather than disappearing from logs.
fn strip_ansi(bytes: &[u8]) -> Vec<u8> {
    let mut plain = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i..].starts_with(b"\x1b[") {
            let mut end = i + 2;
            while end < bytes.len() && (bytes[end].is_ascii_digit() || bytes[end] == b';') {
                end += 1;
            }
            if bytes.get(end) == Some(&b'm') {
                i = end + 1;
                continue;
            }
        }
        plain.push(bytes[i]);
        i += 1;
    }
    plain
}

fn xml_character(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\r' | '\u{20}'..='\u{d7ff}' | '\u{e000}'..='\u{fffd}' | '\u{10000}'..='\u{10ffff}')
}

// Escape invalid UTF-8 by original byte, and valid but XML-forbidden characters
// by their encoded bytes. This preserves evidence without replacement glyphs.
pub fn escape(bytes: &[u8], plain_log: bool) -> String {
    let stripped;
    let mut bytes = if plain_log {
        stripped = strip_ansi(bytes);
        stripped.as_slice()
    } else {
        bytes
    };
    let mut result = String::new();
    while !bytes.is_empty() {
        let (valid, invalid) = match std::str::from_utf8(bytes) {
            Ok(text) => (text, 0),
            Err(error) => (
                std::str::from_utf8(&bytes[..error.valid_up_to()]).expect("validated UTF-8 prefix"),
                error.error_len().unwrap_or(bytes.len() - error.valid_up_to()),
            ),
        };
        for c in valid.chars() {
            if !xml_character(c) || (plain_log && (c == '\r' || c == '\u{7f}')) {
                let mut encoded = [0; 4];
                for byte in c.encode_utf8(&mut encoded).as_bytes() {
                    result.push_str(&format!("\\{byte:03o}"));
                }
            } else {
                match c {
                    '&' => result.push_str("&amp;"),
                    '<' => result.push_str("&lt;"),
                    '>' => result.push_str("&gt;"),
                    '"' => result.push_str("&quot;"),
                    '\'' => result.push_str("&apos;"),
                    // Character references preserve whitespace in attributes.
                    '\t' if !plain_log => result.push_str("&#9;"),
                    '\n' if !plain_log => result.push_str("&#10;"),
                    '\r' if !plain_log => result.push_str("&#13;"),
                    _ => result.push(c),
                }
            }
        }
        let offset = valid.len();
        for byte in &bytes[offset..offset + invalid] {
            result.push_str(&format!("\\{byte:03o}"));
        }
        bytes = &bytes[offset + invalid..];
    }
    result
}

pub struct Report {
    pub tests: usize,
    pub failures: usize,
    pub elapsed: Duration,
    pub cases: String,
}

impl Report {
    pub fn new() -> Self {
        Self { tests: 0, failures: 0, elapsed: Duration::ZERO, cases: String::new() }
    }

    pub fn case(&mut self, name: &[u8], elapsed: Duration, failure: Option<&[u8]>, grade: bool) {
        self.tests += 1;
        self.failures += usize::from(failure.is_some());
        self.elapsed += elapsed;
        if !grade {
            return;
        }
        self.cases.push_str(&format!(
            "<testcase name=\"{}\" time=\"{:.3}\"{}>",
            escape(name, false),
            elapsed.as_secs_f64(),
            if failure.is_some() { " status=\"failed\"" } else { "" }
        ));
        if let Some(failure) = failure {
            self.cases.push_str("<failure type=\"failure\">");
            self.cases.push_str(&escape(failure, true));
            self.cases.push_str("</failure>");
        }
        self.cases.push_str("</testcase>\n");
    }

    fn write(&self, out: &mut impl Write) -> io::Result<()> {
        out.write_all(b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")?;
        for tag in ["testsuites", "testsuite"] {
            writeln!(
                out,
                "<{tag} tests=\"{}\" failures=\"{}\" time=\"{:.3}\" errors=\"0\" skipped=\"0\" disabled=\"0\">",
                self.tests,
                self.failures,
                self.elapsed.as_secs_f64()
            )?;
        }
        out.write_all(self.cases.as_bytes())?;
        out.write_all(b"</testsuite></testsuites>\n")
    }

    // Exclusive creation avoids following preexisting links. The guard removes
    // incomplete reports on every ordinary error and signal interruption path.
    pub fn publish(&self, signals: &sys::Signals) -> Result<(), Error> {
        for attempt in 0..100 {
            let path =
                PathBuf::from(format!("test_detail.xml.tmp.{}.{attempt}", std::process::id()));
            let file = OpenOptions::new().write(true).create_new(true).mode(0o600).open(&path);
            let mut file = match file {
                Ok(file) => file,
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(Error::message(format!("cannot write test_detail.xml: {error}")));
                }
            };
            let guard = TemporaryReport(path);
            self.write(&mut file)?;
            file.flush()?;
            drop(file);
            signals.check()?;
            fs::rename(&guard.0, "test_detail.xml").map_err(|error| {
                Error::message(format!("cannot publish test_detail.xml: {error}"))
            })?;
            return Ok(());
        }
        Err(Error::message("cannot create temporary XML report"))
    }
}

struct TemporaryReport(PathBuf);

impl Drop for TemporaryReport {
    fn drop(&mut self) {
        // Publication consumes the path through rename, so NotFound is normal.
        let _ = fs::remove_file(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::escape;

    #[test]
    fn invalid_bytes_and_forbidden_unicode_preserve_original_bytes() {
        assert_eq!(escape(b"\xff\xc0\x80\xe2\x82", false), "\\377\\300\\200\\342\\202");
        assert_eq!(
            escape("a\u{ffff}\u{fffe}\0é🙂".as_bytes(), false),
            "a\\357\\277\\277\\357\\277\\276\\000é🙂"
        );
    }

    #[test]
    fn escaping_and_plain_log_have_distinct_whitespace_rules() {
        assert_eq!(escape(b"<&>\"'\t\n\r", false), "&lt;&amp;&gt;&quot;&apos;&#9;&#10;&#13;");
        assert_eq!(
            escape(b"\x1b[1;31m<&\x1b[0m\r\x7f\t\n\x1b[?m", true),
            "&lt;&amp;\\015\\177\t\n\\033[?m"
        );
    }
}
