use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;

use chrono::{DateTime, Duration, Utc};
use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::signatures::compute_daycare_registration_signature;

const DAYCARE_REGISTRATION_TTL: Duration = Duration::seconds(20);
const DAYCARE_MAX_TIME_DRIFT: Duration = Duration::minutes(1);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaycareRegistration {
    pub hostname: String,
    pub problem_types: Vec<String>,
    pub capacity: usize,
    pub time: DateTime<Utc>,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub version: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub signature: String,
}

#[derive(Debug)]
pub struct DaycareRegistry {
    secret: String,
    version: String,
    local: Option<DaycareRegistration>,
    entries: Mutex<BTreeMap<String, DaycareRegistration>>,
}

impl DaycareRegistry {
    pub fn new(secret: String, version: String) -> Self {
        Self {
            secret,
            version,
            local: None,
            entries: Mutex::new(BTreeMap::new()),
        }
    }

    pub fn with_local(mut self, hostname: &str, problem_types: &[String], capacity: usize) -> Self {
        self.local = Some(DaycareRegistration {
            hostname: hostname.to_owned(),
            problem_types: problem_types.to_vec(),
            capacity,
            time: Utc::now(),
            version: self.version.clone(),
            signature: String::new(),
        });
        self
    }

    pub fn insert(&self, reg: DaycareRegistration) -> AppResult<()> {
        if reg.hostname.trim().is_empty() || reg.capacity == 0 {
            return Err(AppError::BadRequest("bad daycare registration".to_owned()));
        }
        let expected = compute_daycare_registration_signature(
            &reg.hostname,
            &reg.problem_types,
            reg.capacity,
            reg.time,
            &reg.version,
            &self.secret,
        )?;
        if expected != reg.signature {
            return Err(AppError::BadRequest(
                "daycare signature mismatch".to_owned(),
            ));
        }
        if reg.version != self.version {
            return Err(AppError::BadRequest(format!(
                "daycare version mismatch: daycare is {}, ta is {}",
                reg.version, self.version
            )));
        }
        let now = Utc::now();
        if (now - reg.time).abs() > DAYCARE_MAX_TIME_DRIFT {
            return Err(AppError::BadRequest(
                "daycare registration time drift is too great".to_owned(),
            ));
        }
        let mut clean = reg;
        clean.problem_types.sort();
        clean.time = now;
        clean.version.clear();
        clean.signature.clear();
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| AppError::Internal("registry lock poisoned".to_owned()))?;
        entries.insert(clean.hostname.clone(), clean);
        expire_entries(&mut entries);
        Ok(())
    }

    pub fn snapshot(&self) -> AppResult<BTreeMap<String, DaycareRegistration>> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| AppError::Internal("registry lock poisoned".to_owned()))?;
        expire_entries(&mut entries);
        let mut snapshot = entries.clone();
        if let Some(local) = &self.local {
            let mut local = local.clone();
            local.version.clear();
            local.signature.clear();
            snapshot.insert(local.hostname.clone(), local);
        }
        Ok(snapshot)
    }

    pub fn assign(&self, problem_types: &BTreeSet<String>) -> AppResult<String> {
        let snapshot = self.snapshot()?;
        let eligible = snapshot
            .values()
            .filter(|reg| {
                problem_types
                    .iter()
                    .all(|name| reg.problem_types.contains(name))
            })
            .collect::<Vec<_>>();
        let total_capacity = eligible.iter().map(|reg| reg.capacity).sum::<usize>();
        if total_capacity == 0 {
            return Err(AppError::Internal(
                "no eligible daycare found for problem types".to_owned(),
            ));
        }
        let mut point = rand::rng().random_range(0..total_capacity);
        for reg in eligible {
            if point < reg.capacity {
                return Ok(reg.hostname.clone());
            }
            point -= reg.capacity;
        }
        Err(AppError::Internal(
            "failed to select daycare registration".to_owned(),
        ))
    }
}

fn expire_entries(entries: &mut BTreeMap<String, DaycareRegistration>) {
    let now = Utc::now();
    entries.retain(|_, reg| now - reg.time <= DAYCARE_REGISTRATION_TTL);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsigned_stale_or_wrong_version_remote_registrations() {
        let registry = DaycareRegistry::new("secret".to_owned(), "2.8.0".to_owned());
        let now = Utc::now();
        let mut reg = DaycareRegistration {
            hostname: "dc-1".to_owned(),
            problem_types: vec!["python".to_owned()],
            capacity: 1,
            time: now,
            version: "2.8.0".to_owned(),
            signature: "bad".to_owned(),
        };
        assert!(registry.insert(reg.clone()).is_err());

        reg.signature = compute_daycare_registration_signature(
            &reg.hostname,
            &reg.problem_types,
            reg.capacity,
            reg.time,
            &reg.version,
            "secret",
        )
        .unwrap();
        assert!(registry.insert(reg.clone()).is_ok());

        reg.version = "2.7.0".to_owned();
        reg.signature = compute_daycare_registration_signature(
            &reg.hostname,
            &reg.problem_types,
            reg.capacity,
            reg.time,
            &reg.version,
            "secret",
        )
        .unwrap();
        assert!(registry.insert(reg.clone()).is_err());

        reg.version = "2.8.0".to_owned();
        reg.time = now - Duration::minutes(2);
        reg.signature = compute_daycare_registration_signature(
            &reg.hostname,
            &reg.problem_types,
            reg.capacity,
            reg.time,
            &reg.version,
            "secret",
        )
        .unwrap();
        assert!(registry.insert(reg).is_err());
    }

    #[test]
    fn assign_requires_eligible_problem_types() {
        let registry = DaycareRegistry::new("secret".to_owned(), "2.8.0".to_owned()).with_local(
            "local",
            &["python".to_owned()],
            1,
        );

        assert_eq!(
            registry
                .assign(&BTreeSet::from(["python".to_owned()]))
                .unwrap(),
            "local"
        );
        assert!(
            registry
                .assign(&BTreeSet::from(["rust".to_owned()]))
                .is_err()
        );
    }
}
