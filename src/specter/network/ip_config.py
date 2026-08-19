from __future__ import annotations

from specter.core.results import Address, IpConfigResult
from specter.network.interface import dhcp_likely, get_addresses, get_dns_servers, get_gateway


def read_ip_config(interface: str) -> IpConfigResult:
    addresses = tuple(Address(family=family, address=address) for family, address in get_addresses(interface))
    return IpConfigResult(
        interface=interface,
        addresses=addresses,
        gateway=get_gateway(interface),
        dns_servers=get_dns_servers(),
        dhcp_likely=dhcp_likely(interface),
    )
