use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

#[derive(Clone, Debug, Default)]
pub struct IpFilter {
    entries: Vec<Cidr>,
}

impl IpFilter {
    pub fn from_entries(entries: &[String]) -> Self {
        Self {
            entries: entries
                .iter()
                .filter_map(|entry| Cidr::parse(entry))
                .collect(),
        }
    }

    pub fn enabled(&self) -> bool {
        !self.entries.is_empty()
    }

    pub fn allows(&self, raw: &str) -> bool {
        raw.parse::<IpAddr>()
            .ok()
            .is_some_and(|addr| self.entries.iter().any(|entry| entry.contains(addr)))
    }
}

#[derive(Clone, Copy, Debug)]
enum Cidr {
    V4(u32, u8),
    V6(u128, u8),
}

impl Cidr {
    fn parse(raw: &str) -> Option<Self> {
        let (ip_raw, prefix_raw) = raw.split_once('/').unwrap_or((raw, ""));
        let ip = ip_raw.parse::<IpAddr>().ok()?;
        match ip {
            IpAddr::V4(ip) => {
                let prefix = if prefix_raw.is_empty() {
                    32
                } else {
                    prefix_raw.parse::<u8>().ok()?
                };
                (prefix <= 32).then_some(Self::V4(u32::from(ip), prefix))
            }
            IpAddr::V6(ip) => {
                let prefix = if prefix_raw.is_empty() {
                    128
                } else {
                    prefix_raw.parse::<u8>().ok()?
                };
                (prefix <= 128).then_some(Self::V6(u128::from(ip), prefix))
            }
        }
    }

    fn contains(self, ip: IpAddr) -> bool {
        match (self, ip) {
            (Self::V4(base, prefix), IpAddr::V4(ip)) => masked_eq(base, u32::from(ip), prefix),
            (Self::V6(base, prefix), IpAddr::V6(ip)) => masked_eq128(base, u128::from(ip), prefix),
            _ => false,
        }
    }
}

fn masked_eq(base: u32, ip: u32, prefix: u8) -> bool {
    let mask = if prefix == 0 {
        0
    } else {
        u32::MAX << (32 - prefix)
    };
    base & mask == ip & mask
}

fn masked_eq128(base: u128, ip: u128, prefix: u8) -> bool {
    let mask = if prefix == 0 {
        0
    } else {
        u128::MAX << (128 - prefix)
    };
    base & mask == ip & mask
}

pub fn extract_ip(headers: &http::HeaderMap, peer: Option<std::net::SocketAddr>) -> Option<String> {
    headers
        .get("x-real-ip")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().to_owned())
        .or_else(|| {
            headers
                .get("x-forwarded-for")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.split(',').next())
                .filter(|value| !value.trim().is_empty())
                .map(|value| value.trim().to_owned())
        })
        .or_else(|| peer.map(|addr| addr.ip().to_string()))
}

#[allow(dead_code)]
fn _ip_types_used(_: Ipv4Addr, _: Ipv6Addr) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supports_single_ips_and_cidr_blocks() {
        let filter =
            IpFilter::from_entries(&["192.0.2.0/24".to_owned(), "2001:db8::/32".to_owned()]);
        assert!(filter.allows("192.0.2.55"));
        assert!(!filter.allows("192.0.3.55"));
        assert!(filter.allows("2001:db8::1"));
    }
}
