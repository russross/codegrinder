from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from typing import Iterable


@dataclass(slots=True)
class IPFilter:
    networks: list[ipaddress._BaseNetwork]

    @classmethod
    def from_entries(cls, entries: Iterable[str] | None) -> "IPFilter":
        nets: list[ipaddress._BaseNetwork] = []
        if entries is None:
            return cls(networks=[])
        for raw in entries:
            entry = raw.strip()
            if entry == "":
                continue
            if entry.endswith(".*"):
                entry = entry[:-2] + ".0/24"
            try:
                nets.append(ipaddress.ip_network(entry, strict=False))
                continue
            except ValueError:
                pass
            try:
                ip = ipaddress.ip_address(entry)
                if isinstance(ip, ipaddress.IPv4Address):
                    nets.append(ipaddress.ip_network(f"{ip}/32", strict=False))
                else:
                    nets.append(ipaddress.ip_network(f"{ip}/128", strict=False))
            except ValueError:
                continue
        return cls(networks=nets)

    def enabled(self) -> bool:
        return len(self.networks) > 0

    def allows_ip(self, ip_text: str) -> bool:
        if not self.enabled():
            return True
        try:
            ip = ipaddress.ip_address(ip_text)
        except ValueError:
            return False
        return any(ip in net for net in self.networks)


def extract_ip_from_peer(peer: str) -> str | None:
    # grpc peer samples: ipv4:127.0.0.1:12345, ipv6:[::1]:12345
    if peer.startswith("ipv4:"):
        rest = peer.removeprefix("ipv4:")
        if ":" not in rest:
            return rest
        return rest.rsplit(":", 1)[0]
    if peer.startswith("ipv6:"):
        rest = peer.removeprefix("ipv6:")
        if rest.startswith("[") and "]" in rest:
            return rest[1 : rest.index("]")]
        return rest.rsplit(":", 1)[0]
    return None

