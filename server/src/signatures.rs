use std::collections::BTreeMap;
use std::fmt::Write as _;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use hmac::{Hmac, KeyInit, Mac};
use prost::Message;
use sha1::Sha1;
use sha2::Sha256;

use crate::error::{AppError, AppResult};
use crate::proto::{RuntimeBundle, SignedRuntimeBundle};
use crate::timeutil::db_time;

const RUNTIME_BUNDLE_HMAC_CONTEXT: &[u8] = b"codegrinder:runtime-bundle:v1\0";

type HmacSha256 = Hmac<Sha256>;
type HmacSha1 = Hmac<Sha1>;

pub fn escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char);
            }
            _ => {
                out.push('%');
                let _ = write!(&mut out, "{byte:02X}");
            }
        }
    }
    out
}

pub fn encode_params(values: &BTreeMap<String, Vec<String>>) -> Vec<u8> {
    let mut out = String::new();
    let mut first = true;
    for (key, vals) in values {
        let escaped_key = escape(key);
        for value in vals {
            if first {
                first = false;
            } else {
                out.push('&');
            }
            out.push_str(&escaped_key);
            out.push('=');
            out.push_str(&escape(value));
        }
    }
    out.into_bytes()
}

pub fn hmac_sha256_base64(secret: &str, payload: &[u8]) -> AppResult<String> {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|err| AppError::Internal(format!("invalid hmac key: {err}")))?;
    mac.update(payload);
    Ok(STANDARD.encode(mac.finalize().into_bytes()))
}

pub fn hmac_sha1_base64(secret: &str, payload: &[u8]) -> AppResult<String> {
    let mut mac = HmacSha1::new_from_slice(secret.as_bytes())
        .map_err(|err| AppError::Internal(format!("invalid hmac key: {err}")))?;
    mac.update(payload);
    Ok(STANDARD.encode(mac.finalize().into_bytes()))
}

pub fn compute_daycare_registration_signature(
    hostname: &str,
    problem_types: &[String],
    capacity: usize,
    time: chrono::DateTime<chrono::Utc>,
    version: &str,
    secret: &str,
) -> AppResult<String> {
    let mut values = BTreeMap::from([
        ("hostname".to_owned(), vec![hostname.to_owned()]),
        ("capacity".to_owned(), vec![capacity.to_string()]),
        ("time".to_owned(), vec![db_time(time)]),
        ("version".to_owned(), vec![version.to_owned()]),
    ]);
    let mut sorted_problem_types = problem_types.to_vec();
    sorted_problem_types.sort();
    for (index, problem_type) in sorted_problem_types.into_iter().enumerate() {
        values.insert(format!("problemType-{index}"), vec![problem_type]);
    }
    hmac_sha256_base64(secret, &encode_params(&values))
}

pub fn sign_runtime_bundle_blob(secret: &str, payload: &[u8]) -> AppResult<String> {
    let prefixed = [RUNTIME_BUNDLE_HMAC_CONTEXT, payload].concat();
    hmac_sha256_base64(secret, &prefixed)
}

pub fn encode_signed_runtime_bundle(
    bundle: &RuntimeBundle,
    secret: &str,
) -> AppResult<SignedRuntimeBundle> {
    let payload = bundle.encode_to_vec();
    Ok(SignedRuntimeBundle {
        signature: sign_runtime_bundle_blob(secret, &payload)?,
        bundle: payload,
    })
}

pub fn decode_signed_runtime_bundle(
    envelope: &SignedRuntimeBundle,
    secret: &str,
) -> AppResult<RuntimeBundle> {
    if envelope.bundle.is_empty() {
        return Err(AppError::BadRequest(
            "signed runtime bundle must include encoded bundle bytes".to_owned(),
        ));
    }
    if envelope.signature.is_empty() {
        return Err(AppError::BadRequest(
            "signed runtime bundle must include a signature".to_owned(),
        ));
    }
    let expected = sign_runtime_bundle_blob(secret, &envelope.bundle)?;
    if expected != envelope.signature {
        return Err(AppError::BadRequest("runtime bundle signature mismatch".to_owned()));
    }
    RuntimeBundle::decode(envelope.bundle.as_slice())
        .map_err(|err| AppError::BadRequest(format!("invalid runtime bundle: {err}")))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    #[test]
    fn oauth_encoding_is_sorted_and_percent_escaped() {
        let values = BTreeMap::from([
            ("b".to_owned(), vec!["two words".to_owned()]),
            ("a".to_owned(), vec!["~ok".to_owned()]),
        ]);
        assert_eq!(String::from_utf8(encode_params(&values)).unwrap(), "a=~ok&b=two%20words");
    }
}
