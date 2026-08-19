from __future__ import annotations

from dataclasses import fields, is_dataclass
from enum import Enum
from typing import Any

from specter.core.results import DiagnosticsResult, IperfResult, IpConfigResult


def to_jsonable(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if is_dataclass(value) and not isinstance(value, type):
        data = {field.name: to_jsonable(getattr(value, field.name)) for field in fields(value)}
        if isinstance(value, DiagnosticsResult):
            data["severity"] = value.severity.value
        if isinstance(value, IperfResult):
            data["mbps"] = value.mbps
        if isinstance(value, IpConfigResult):
            data["primary_ipv4"] = value.primary_ipv4
        return to_jsonable(data)
    if isinstance(value, dict):
        return {key: to_jsonable(item) for key, item in value.items()}
    if isinstance(value, tuple | list):
        return [to_jsonable(item) for item in value]
    return value
