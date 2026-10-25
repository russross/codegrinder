use std::ops::Range;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stream {
    Out,
    Err,
}

impl Stream {
    pub fn index(self) -> usize {
        match self {
            Self::Out => 0,
            Self::Err => 1,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Out => "stdout",
            Self::Err => "stderr",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Input,
    Output(Stream),
}

pub struct Record {
    pub action: Action,
    pub payload: Range<usize>,
}

pub struct Phase {
    pub ends: [usize; 2],
    pub bytes: [usize; 2],
    pub input: Option<usize>,
}

pub struct Transcript {
    bytes: Vec<u8>,
    pub records: Vec<Record>,
    pub expected: [Vec<usize>; 2],
    pub phases: Vec<Phase>,
    pub last_input: Option<usize>,
}

impl Transcript {
    pub fn payload(&self, record: usize) -> &[u8] {
        &self.bytes[self.records[record].payload.clone()]
    }

    // Records borrow their bytes from the original transcript. Phase limits are
    // cumulative, so input boundaries never require copying expected output.
    pub fn parse(bytes: Vec<u8>) -> Result<Self, String> {
        if bytes.contains(&0) {
            return Err("Transcript contains NUL bytes".into());
        }
        let mut result = Self {
            bytes,
            records: Vec::new(),
            expected: [Vec::new(), Vec::new()],
            phases: Vec::new(),
            last_input: None,
        };
        let mut start = 0;
        let mut totals = [0; 2];
        while start < result.bytes.len() {
            let end = result.bytes[start..]
                .iter()
                .position(|&b| b == b'\n')
                .map_or(result.bytes.len(), |offset| start + offset + 1);
            let line = &result.bytes[start..end];
            let action = match line.get(..2) {
                Some(b"< ") => Action::Input,
                Some(b"> ") => Action::Output(Stream::Out),
                Some(b"! ") => Action::Output(Stream::Err),
                _ => {
                    return Err(format!(
                        "Invalid transcript record on line {}",
                        result.records.len() + 1
                    ));
                }
            };
            let record = result.records.len();
            result.records.push(Record { action, payload: start + 2..end });
            match action {
                Action::Input => {
                    result.last_input = Some(record);
                    result.phases.push(Phase {
                        ends: result.expected.each_ref().map(Vec::len),
                        bytes: totals,
                        input: Some(record),
                    });
                }
                Action::Output(stream) => {
                    let index = stream.index();
                    result.expected[index].push(record);
                    totals[index] += end - start - 2;
                }
            }
            start = end;
        }

        // Validate the ending after record prefixes, matching the shell's
        // diagnostic precedence when an unterminated record is also malformed.
        if !result.bytes.is_empty() && result.bytes.last() != Some(&b'\n') {
            return Err("Transcript must end with a newline".into());
        }
        result.phases.push(Phase {
            ends: result.expected.each_ref().map(Vec::len),
            bytes: totals,
            input: None,
        });
        Ok(result)
    }
}
