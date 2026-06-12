use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use crate::error::{CliError, Result, fail};

pub const PROBLEM_CONFIG_NAME: &str = "problem.cfg";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GcfgValue {
    pub key: String,
    pub value: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GcfgSection {
    pub name: String,
    pub subsection: Option<String>,
    pub items: Vec<GcfgValue>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AuthorStepConfig {
    pub note: String,
    pub problem_type: String,
    pub weight: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AuthorProblemConfig {
    pub problem_id: String,
    pub note: String,
    pub problem_type: String,
    pub tags: Vec<String>,
    pub options: Vec<String>,
    pub steps: Vec<AuthorStepConfig>,
    pub single_step_layout: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AuthorProblemSetProblemConfig {
    pub problem_id: String,
    pub weight: f64,
    pub first_step: i64,
    pub last_step: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AuthorProblemSetConfig {
    pub problem_set_id: String,
    pub note: String,
    pub tags: Vec<String>,
    pub continues_problem_set_id: String,
    pub problems: Vec<AuthorProblemSetProblemConfig>,
}

pub fn parse_gcfg(path: &Path) -> Result<Vec<GcfgSection>> {
    if !path.exists() {
        fail(format!(
            "failed to parse {}: file does not exist",
            path.display()
        ))?;
    }
    let mut sections = Vec::new();
    let mut current: Option<GcfgSection> = None;
    for (line_index, raw_line) in fs::read_to_string(path)?.lines().enumerate() {
        let line_no = line_index + 1;
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            if let Some(section) = current.take() {
                sections.push(section);
            }
            let inner = line[1..line.len() - 1].trim();
            if inner.is_empty() {
                fail(format!(
                    "failed to parse {}: empty section at line {line_no}",
                    path.display()
                ))?;
            }
            let (name, subsection) = if inner.contains('"') {
                let parts = inner.split('"').collect::<Vec<_>>();
                (
                    parts.first().unwrap_or(&"").trim().to_lowercase(),
                    parts.get(1).map(|value| (*value).to_string()),
                )
            } else {
                (inner.to_lowercase(), None)
            };
            current = Some(GcfgSection {
                name,
                subsection,
                items: Vec::new(),
            });
            continue;
        }
        let section = current.as_mut().ok_or_else(|| {
            CliError::Message(format!(
                "failed to parse {}: key outside section at line {line_no}",
                path.display()
            ))
        })?;
        let Some((key, value)) = line.split_once('=') else {
            return fail(format!(
                "failed to parse {}: invalid key/value at line {line_no}",
                path.display()
            ));
        };
        section.items.push(GcfgValue {
            key: key.trim().to_lowercase(),
            value: value.trim().to_string(),
        });
    }
    if let Some(section) = current.take() {
        sections.push(section);
    }
    Ok(sections)
}

pub fn parse_author_problem_config(path: &Path) -> Result<AuthorProblemConfig> {
    let sections = parse_gcfg(path)?;
    let problem = first_section(&sections, "problem").ok_or_else(|| {
        CliError::Message(format!(
            "failed to parse {}: missing [problem] section",
            path.display()
        ))
    })?;
    let problem_id = required_last_non_empty(problem, "unique", "problem.unique", path)?;
    let note = required_last_non_empty(problem, "note", "problem.note", path)?;
    let problem_type = last_value_or_empty(problem, "type");
    let tags = all_values(problem, "tag");
    let options = all_values(problem, "option");
    let step_sections = sections_named(&sections, "step");
    let mut steps = Vec::new();
    if step_sections.is_empty() {
        steps.push(AuthorStepConfig {
            note: note.clone(),
            problem_type: problem_type.clone(),
            weight: 1.0,
        });
    } else {
        let mut step_map = BTreeMap::new();
        for section in &step_sections {
            let subsection = section.subsection.as_deref().unwrap_or("");
            if subsection.parse::<i64>().is_err() {
                fail(format!(
                    "failed to parse {}: step sections must be [step \"N\"]",
                    path.display()
                ))?;
            }
            let index = subsection
                .parse::<i64>()
                .map_err(|error| CliError::Message(error.to_string()))?;
            let step_note =
                required_last_non_empty(section, "note", &format!("step {index}.note"), path)?;
            let section_type = last_value_or_empty(section, "type");
            if section_type.is_empty() == problem_type.is_empty() {
                fail(
                    "problem type must be specified for the problem as a whole or for each step, but not both",
                )?;
            }
            let weight_text = last_value_or_empty(section, "weight");
            let weight = if weight_text.is_empty() {
                1.0
            } else {
                weight_text
                    .parse::<f64>()
                    .map_err(|error| CliError::Message(error.to_string()))?
            };
            step_map.insert(
                index,
                AuthorStepConfig {
                    note: step_note,
                    problem_type: if section_type.is_empty() {
                        problem_type.clone()
                    } else {
                        section_type
                    },
                    weight,
                },
            );
        }
        for index in 1..=*step_map.keys().max().unwrap_or(&0) {
            let Some(step) = step_map.remove(&index) else {
                return fail(format!(
                    "expected to find {} steps, but only found {}",
                    step_sections.len(),
                    index - 1
                ));
            };
            steps.push(step);
        }
    }
    Ok(AuthorProblemConfig {
        problem_id,
        note,
        problem_type,
        tags,
        options,
        steps,
        single_step_layout: step_sections.is_empty(),
    })
}

pub fn parse_author_problem_set_config(path: &Path) -> Result<AuthorProblemSetConfig> {
    let sections = parse_gcfg(path)?;
    let pset = first_section(&sections, "problem")
        .filter(|section| section.subsection.is_none())
        .and_then(|_| first_section(&sections, "problemset"))
        .or_else(|| first_section(&sections, "problemset"))
        .ok_or_else(|| {
            CliError::Message(format!(
                "failed to parse {}: missing [problemset] section",
                path.display()
            ))
        })?;
    let problem_set_id = required_last_non_empty(pset, "unique", "problemset.unique", path)?;
    let note = required_last_non_empty(pset, "note", "problemset.note", path)?;
    let tags = all_values(pset, "tag");
    let continues_problem_set_id = last_value_or_empty(pset, "continues");
    let mut sliced = false;
    let mut problems = Vec::new();
    for section in sections_named(&sections, "problem") {
        let Some(problem_id) = &section.subsection else {
            continue;
        };
        let weight_text = last_value_or_empty(section, "weight");
        let weight = if weight_text.is_empty() {
            1.0
        } else {
            weight_text
                .parse::<f64>()
                .map_err(|error| CliError::Message(error.to_string()))?
        };
        let steps_text = last_value_or_empty(section, "steps");
        let (first_step, last_step) = if steps_text.is_empty() {
            (0, 0)
        } else {
            sliced = true;
            parse_step_range(&steps_text, path)?
        };
        problems.push(AuthorProblemSetProblemConfig {
            problem_id: problem_id.clone(),
            weight,
            first_step,
            last_step,
        });
    }
    if sliced && problems.len() != 1 {
        fail(format!(
            "failed to parse {}: step slicing is only supported for unary problem sets",
            path.display()
        ))?;
    }
    if !continues_problem_set_id.is_empty() && !sliced {
        fail(format!(
            "failed to parse {}: problemset.continues requires a sliced problem set",
            path.display()
        ))?;
    }
    Ok(AuthorProblemSetConfig {
        problem_set_id,
        note,
        tags,
        continues_problem_set_id,
        problems,
    })
}

fn sections_named<'a>(sections: &'a [GcfgSection], name: &str) -> Vec<&'a GcfgSection> {
    sections
        .iter()
        .filter(|section| section.name == name)
        .collect()
}

fn first_section<'a>(sections: &'a [GcfgSection], name: &str) -> Option<&'a GcfgSection> {
    sections.iter().find(|section| section.name == name)
}

fn all_values(section: &GcfgSection, key: &str) -> Vec<String> {
    section
        .items
        .iter()
        .filter(|item| item.key == key)
        .map(|item| item.value.clone())
        .collect()
}

fn last_value_or_empty(section: &GcfgSection, key: &str) -> String {
    section
        .items
        .iter()
        .rev()
        .find(|item| item.key == key)
        .map(|item| item.value.clone())
        .unwrap_or_default()
}

fn required_last_non_empty(
    section: &GcfgSection,
    key: &str,
    field: &str,
    path: &Path,
) -> Result<String> {
    let Some(value) = section
        .items
        .iter()
        .rev()
        .find(|item| item.key == key)
        .map(|item| item.value.as_str())
    else {
        return fail(format!(
            "failed to parse {}: missing {field}",
            path.display()
        ));
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fail(format!("failed to parse {}: empty {field}", path.display()))?;
    }
    Ok(trimmed.to_string())
}

fn parse_step_range(raw: &str, path: &Path) -> Result<(i64, i64)> {
    let Some((first, last)) = raw.split_once('-') else {
        return fail(format!(
            "failed to parse {}: problem steps must be FIRST-LAST",
            path.display()
        ));
    };
    let first_step = first.trim().parse::<i64>().map_err(|_| {
        CliError::Message(format!(
            "failed to parse {}: problem steps must be FIRST-LAST",
            path.display()
        ))
    })?;
    let last_step = last.trim().parse::<i64>().map_err(|_| {
        CliError::Message(format!(
            "failed to parse {}: problem steps must be FIRST-LAST",
            path.display()
        ))
    })?;
    if first_step <= 0 || last_step < first_step {
        fail(format!(
            "failed to parse {}: problem steps must be FIRST-LAST with positive ascending steps",
            path.display()
        ))?;
    }
    Ok((first_step, last_step))
}

#[cfg(test)]
mod tests {
    use super::{parse_author_problem_config, parse_author_problem_set_config};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn parse_problem_cfg_rejects_mixed_type_specification() {
        let dir = tempdir().expect("tempdir");
        let path = dir.path().join("problem.cfg");
        fs::write(
            &path,
            "[problem]\nunique = loops-2\nnote = Mixed\ntype = python\n\n[step \"1\"]\nnote = First\ntype = cpp\n",
        )
        .expect("write");

        assert!(parse_author_problem_config(&path).is_err());
    }

    #[test]
    fn parse_problem_set_cfg_reads_slice_continuation() {
        let dir = tempdir().expect("tempdir");
        let path = dir.path().join("set.cfg");
        fs::write(
            &path,
            "[problemset]\nunique = loops-part-2\nnote = Loops part 2\ncontinues = loops-part-1\n\n[problem \"loops\"]\nsteps = 3-5\n",
        )
        .expect("write");

        let parsed = parse_author_problem_set_config(&path).expect("parse");

        assert_eq!(parsed.continues_problem_set_id, "loops-part-1");
        assert_eq!(parsed.problems[0].first_step, 3);
        assert_eq!(parsed.problems[0].last_step, 5);
    }
}
