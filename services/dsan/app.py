#!/usr/bin/env python3
"""Local D'San Limitimer and PerfectCue web monitor."""

from __future__ import annotations

import base64
import errno
import hashlib
import hmac
import json
import os
import re
import secrets
import socket
import sys
import threading
import time
import webbrowser
from urllib.parse import urlsplit
from copy import deepcopy
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from discovery import scan_network


ROOT = Path(__file__).resolve().parent
INDEX_PATH = ROOT / "index.html"
LOCAL_PORT = int(os.environ.get("TECH_HUB_BACKEND_PORT", "53971"))
SERVER_BIND_HOST = os.environ.get("TECH_HUB_BACKEND_HOST", "0.0.0.0")
if os.environ.get("TECH_HUB_DATA_DIR"):
    DATA_DIR = Path(os.environ["TECH_HUB_DATA_DIR"])
    DATA_DIR.mkdir(parents=True, exist_ok=True)
elif getattr(sys, "frozen", False):
    DATA_DIR = Path(os.environ.get("APPDATA", Path.home())) / "DSan Master View"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
else:
    DATA_DIR = ROOT
CONFIG_PATH = DATA_DIR / "viewer-config.json"
DEFAULT_CONFIG = {
    "limitimer": {"host": "", "port": 6120, "enabled": False},
    "perfectcue": {"host": "", "port": 6120, "enabled": False},
    "display": {"overtime": "continue", "font": "mono", "show_lights": True, "clock_color": "#f5f8fb", "green_color": "#35d07f", "yellow_color": "#ffd166", "red_color": "#ff5263", "fixed_color": True},
    "access": {
        "require_auth": False,
        "username": "admin",
        "password_salt": "",
        "password_hash": "",
    },
}
NETWORK_REFRESH_SECONDS = 30


def local_ipv4_addresses() -> list[str]:
    candidates: set[str] = set()
    try:
        hostname = socket.gethostname()
        for result in socket.getaddrinfo(hostname, None, family=socket.AF_INET):
            address = result[4][0]
            if address and address != "127.0.0.1":
                candidates.add(address)
    except OSError:
        pass

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.settimeout(0.25)
            probe.connect(("1.1.1.1", 53))
            address = probe.getsockname()[0]
            if address and address != "127.0.0.1":
                candidates.add(address)
    except OSError:
        pass

    if not candidates:
        candidates.add("127.0.0.1")
    return sorted(candidates, key=lambda item: [int(part) for part in item.split(".")])


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def crc16_modbus(data: bytes) -> int:
    crc = 0xFFFF
    for value in data:
        crc ^= value
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def base128_time(data: bytes, offset: int) -> int:
    return data[offset] * 16384 + data[offset + 1] * 128 + data[offset + 2]


def format_duration(seconds: int) -> str:
    sign = "−" if seconds < 0 else ""
    seconds = abs(seconds)
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{sign}{hours}:{minutes:02d}:{secs:02d}"
    return f"{sign}{minutes}:{secs:02d}"


def parse_limitimer_frame(frame: bytes) -> dict[str, Any]:
    if len(frame) != 55 or frame[:2] != b"\x81\x00" or frame[51] != 0x83 or frame[54] != 0xFF:
        raise ValueError("invalid Limitimer frame")
    expected = (frame[52] << 8) | frame[53]
    actual = crc16_modbus(frame[:52])
    if expected not in (0, actual):
        raise ValueError("Limitimer checksum mismatch")

    high, low = frame[2], frame[3]
    countdown = bool(low & 0x08)
    selected = min(frame[5], 3)
    timers = []
    for index in range(4):
        offset = 6 + index * 11
        flags = frame[offset]
        total = base128_time(frame, offset + 2)
        sumup = base128_time(frame, offset + 5)
        elapsed = base128_time(frame, offset + 8)
        remaining = total - elapsed if countdown else elapsed
        expired = countdown and remaining <= 0
        signal = "red" if expired else "yellow" if countdown and remaining <= sumup else "green"
        timers.append(
            {
                "program": index + 1,
                "selected": index == selected,
                "running": bool(flags & 0x01),
                "blink": bool(flags & 0x02),
                "beep": bool(flags & 0x04),
                "seconds_adjust": bool(flags & 0x08),
                "total_seconds": total,
                "sumup_seconds": sumup,
                "elapsed_seconds": elapsed,
                "remaining_seconds": remaining,
                "total": format_duration(total),
                "sumup": format_duration(sumup),
                "elapsed": format_duration(elapsed),
                "remaining": format_duration(remaining),
                "signal": signal,
            }
        )

    beep_type = ((high & 0x01) << 1) | ((low & 0x40) >> 6)
    return {
        "updated_at": iso_now(),
        "sequence": frame[4],
        "selected_program": selected + 1,
        "countdown": countdown,
        "continue_after_zero": bool(low & 0x10),
        "program_minutes": bool(low & 0x04),
        "session_minutes": bool(low & 0x02),
        "permit_changes": bool(high & 0x20),
        "beep_loud": bool(low & 0x20),
        "beep_type": ["None", "Buzz", "Ring", "Chime"][beep_type],
        "timers": timers,
        "active": timers[selected],
    }


class SharedState:
    def __init__(self) -> None:
        self.server_port = LOCAL_PORT
        self.lock = threading.RLock()
        self.config = self._load_config()
        self.config_version = 0
        self.network_cache_at = 0.0
        self.network_cache: dict[str, Any] = {
            "server": {
                "port": int(os.environ.get("TECH_HUB_PUBLIC_PORT", self.server_port)),
                "ip_addresses": local_ipv4_addresses(),
            }
        }
        self.data: dict[str, Any] = {
            "message": {"text": "", "color": "#ffffff", "flash": False},
            "limitimer": {
                "status": "waiting",
                "error": None,
                "updated_at": None,
                "packet_count": 0,
                "heartbeat_count": 0,
                "data": None,
            },
            "perfectcue": {
                "status": "disabled" if not self.config["perfectcue"]["enabled"] else "waiting",
                "error": None,
                "updated_at": None,
                "event_count": 0,
                "last_event": None,
                "history": [],
            },
        }

    def _load_config(self) -> dict[str, Any]:
        if not CONFIG_PATH.exists():
            return deepcopy(DEFAULT_CONFIG)
        try:
            saved = json.loads(CONFIG_PATH.read_text())
            merged = deepcopy(DEFAULT_CONFIG)
            for name in ("limitimer", "perfectcue"):
                if isinstance(saved.get(name), dict):
                    merged[name].update(saved[name])
            if isinstance(saved.get("display"), dict):
                merged["display"].update(saved["display"])
            if isinstance(saved.get("access"), dict):
                merged["access"].update(saved["access"])
            return validate_config(merged)
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            return deepcopy(DEFAULT_CONFIG)

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {"config": public_config(self.config), "network": self.network_status(), **deepcopy(self.data)}

    def network_status(self) -> dict[str, Any]:
        now = time.time()
        with self.lock:
            if now - self.network_cache_at > NETWORK_REFRESH_SECONDS:
                self.network_cache = {
                    "server": {
                        "port": int(os.environ.get("TECH_HUB_PUBLIC_PORT", self.server_port)),
                        "ip_addresses": local_ipv4_addresses(),
                    }
                }
                self.network_cache_at = now
            return deepcopy(self.network_cache)

    def set_config(self, config: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            config = validate_config(config, existing=self.config)
            self.config = config
            self.config_version += 1
            for name in ("limitimer", "perfectcue"):
                self.data[name]["status"] = "waiting" if config[name]["enabled"] else "disabled"
                self.data[name]["error"] = None
            temp_path = CONFIG_PATH.with_suffix(".json.tmp")
            temp_path.write_text(json.dumps(config, indent=2) + "\n")
            os.replace(temp_path, CONFIG_PATH)
            return public_config(config)

    def connection(self, name: str, status: str, error: str | None = None) -> None:
        with self.lock:
            self.data[name]["status"] = status
            self.data[name]["error"] = error

    def limitimer_frame(self, parsed: dict[str, Any]) -> None:
        with self.lock:
            target = self.data["limitimer"]
            target["status"] = "connected"
            target["error"] = None
            target["updated_at"] = parsed["updated_at"]
            target["packet_count"] += 1
            target["data"] = parsed

    def heartbeat(self) -> None:
        with self.lock:
            self.data["limitimer"]["heartbeat_count"] += 1

    def perfectcue_event(self, code: int) -> None:
        labels = {
            0x0F: ("next", "Next", "Right arrow"),
            0x1F: ("previous", "Previous", "Left arrow"),
            0x2F: ("blank_off", "Blank", "Yellow indicator off"),
            0x3F: ("blank_on", "Blank", "Yellow indicator on"),
        }
        if code not in labels:
            return
        kind, label, detail = labels[code]
        event = {"kind": kind, "label": label, "detail": detail, "code": f"0x{code:02X}", "at": iso_now()}
        with self.lock:
            target = self.data["perfectcue"]
            target["status"] = "connected"
            target["error"] = None
            target["updated_at"] = event["at"]
            target["event_count"] += 1
            target["last_event"] = event
            target["history"] = [event, *target["history"]][:20]


def password_digest(password: str, salt_hex: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), 200_000).hex()


def verify_password(config: dict[str, Any], username: str, password: str) -> bool:
    access = config.get("access", {})
    salt = str(access.get("password_salt", ""))
    expected = str(access.get("password_hash", ""))
    if not salt or not expected or not hmac.compare_digest(str(access.get("username", "")), username):
        return False
    try:
        actual = password_digest(password, salt)
    except (TypeError, ValueError):
        return False
    return hmac.compare_digest(expected, actual)


def public_config(config: dict[str, Any]) -> dict[str, Any]:
    clean = deepcopy(config)
    access = clean.get("access", {})
    clean["access"] = {
        "require_auth": bool(access.get("require_auth", False)),
        "username": str(access.get("username", "admin")),
        "password_set": bool(access.get("password_hash")),
    }
    return clean


def validate_config(config: dict[str, Any], existing: dict[str, Any] | None = None) -> dict[str, Any]:
    clean = {}
    for name in ("limitimer", "perfectcue"):
        value = config.get(name)
        if not isinstance(value, dict):
            raise ValueError(f"missing {name} settings")
        host = str(value.get("host", "")).strip()
        try:
            port = int(value.get("port", 6120))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{name} port must be a number") from exc
        if not 1 <= port <= 65535:
            raise ValueError(f"{name} port must be between 1 and 65535")
        enabled = bool(value.get("enabled", bool(host)))
        if enabled and not host:
            raise ValueError(f"{name} IP address or hostname is required")
        clean[name] = {"host": host, "port": port, "enabled": enabled}
    display = config.get("display", {})
    overtime = str(display.get("overtime", "continue")) if isinstance(display, dict) else "continue"
    if overtime not in ("continue", "stop"):
        raise ValueError("overtime display must continue or stop at zero")
    font = str(display.get("font", "mono")) if isinstance(display, dict) else "mono"
    if font not in ("mono", "sans", "condensed", "serif", "helvetica", "verdana", "georgia", "comic_sans", "trebuchet", "arial_black", "impact"):
        raise ValueError("clock font is not supported")
    show_lights = bool(display.get("show_lights", True)) if isinstance(display, dict) else True
    clean["display"] = {"overtime": overtime, "font": font, "show_lights": show_lights}
    for key in ("clock_color", "green_color", "yellow_color", "red_color"):
        value = display.get(key, DEFAULT_CONFIG["display"][key]) if isinstance(display, dict) else DEFAULT_CONFIG["display"][key]
        if not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
            raise ValueError("display colors must be six-digit hex colors")
        clean["display"][key] = value
    for key, default in (("fixed_color", True),):
        clean["display"][key] = bool(display.get(key, default)) if isinstance(display, dict) else default

    access = config.get("access", {})
    if not isinstance(access, dict):
        raise ValueError("network access settings are invalid")
    require_auth = bool(access.get("require_auth", False))
    username = str(access.get("username", "admin")).strip()
    if require_auth and not username:
        raise ValueError("an authentication username is required")
    password = str(access.get("password", ""))
    salt = str(access.get("password_salt", ""))
    digest = str(access.get("password_hash", ""))
    if not password and existing:
        old_access = existing.get("access", {})
        salt = str(old_access.get("password_salt", salt))
        digest = str(old_access.get("password_hash", digest))
    if password:
        if len(password) < 8:
            raise ValueError("authentication password must be at least 8 characters")
        salt = secrets.token_hex(16)
        digest = password_digest(password, salt)
    if require_auth and (not salt or not digest):
        raise ValueError("set a password before requiring authentication")
    clean["access"] = {
        "require_auth": require_auth,
        "username": username or "admin",
        "password_salt": salt,
        "password_hash": digest,
    }
    return clean


class DeviceWorker(threading.Thread):
    def __init__(self, shared: SharedState, name: str) -> None:
        super().__init__(name=f"{name}-reader", daemon=True)
        self.shared = shared
        self.device_name = name

    def run(self) -> None:
        while True:
            with self.shared.lock:
                config = deepcopy(self.shared.config[self.device_name])
                version = self.shared.config_version
            if not config["enabled"]:
                self.shared.connection(self.device_name, "disabled")
                time.sleep(0.5)
                continue
            self.shared.connection(self.device_name, "connecting")
            try:
                with socket.create_connection((config["host"], config["port"]), timeout=4) as connection:
                    connection.settimeout(1)
                    self.shared.connection(self.device_name, "connected")
                    self.read_connection(connection, version)
            except (OSError, ValueError) as exc:
                self.shared.connection(self.device_name, "disconnected", str(exc))
            time.sleep(1.5)

    def config_changed(self, version: int) -> bool:
        with self.shared.lock:
            return version != self.shared.config_version

    def read_connection(self, connection: socket.socket, version: int) -> None:
        raise NotImplementedError


class LimitimerWorker(DeviceWorker):
    def __init__(self, shared: SharedState) -> None:
        super().__init__(shared, "limitimer")

    def read_connection(self, connection: socket.socket, version: int) -> None:
        buffer = bytearray()
        while not self.config_changed(version):
            try:
                chunk = connection.recv(4096)
            except socket.timeout:
                continue
            if not chunk:
                raise ConnectionError("connection closed")
            buffer.extend(chunk)
            while buffer:
                try:
                    start = buffer.index(0x81)
                except ValueError:
                    buffer.clear()
                    break
                if start:
                    del buffer[:start]
                if len(buffer) < 2:
                    break
                frame_length = 6 if buffer[1] == 0x10 else 55 if buffer[1] == 0x00 else 0
                if not frame_length:
                    del buffer[0]
                    continue
                if len(buffer) < frame_length:
                    break
                frame = bytes(buffer[:frame_length])
                del buffer[:frame_length]
                if frame_length == 6:
                    if frame[2] == 0x83 and frame[-1] == 0xFF:
                        self.shared.heartbeat()
                    continue
                try:
                    self.shared.limitimer_frame(parse_limitimer_frame(frame))
                except ValueError:
                    continue


class PerfectCueWorker(DeviceWorker):
    def __init__(self, shared: SharedState) -> None:
        super().__init__(shared, "perfectcue")

    def read_connection(self, connection: socket.socket, version: int) -> None:
        while not self.config_changed(version):
            try:
                chunk = connection.recv(4096)
            except socket.timeout:
                continue
            if not chunk:
                raise ConnectionError("connection closed")
            for code in chunk:
                self.shared.perfectcue_event(code)


SHARED = SharedState()


class Handler(BaseHTTPRequestHandler):
    server_version = "DSanMonitor/1.0"

    def do_GET(self) -> None:
        if not self.authorized():
            self.request_authentication()
            return
        if urlsplit(self.path).path in ("/", "/index.html", "/full", "/full/"):
            self.send_bytes(INDEX_PATH.read_bytes(), "text/html; charset=utf-8")
        elif self.path == "/api/state":
            self.send_json(SHARED.snapshot())
        else:
            self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        if not self.authorized():
            self.request_authentication()
            return
        if self.path not in ("/api/config", "/api/message", "/api/discover"):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size > 16_384:
                raise ValueError("settings payload is too large")
            payload = json.loads(self.rfile.read(size))
            if self.path == "/api/discover":
                with SHARED.lock:
                    connected = [(SHARED.config[name]['host'], SHARED.config[name]['port']) for name in ('limitimer', 'perfectcue') if SHARED.data[name]['status'] == 'connected']
                self.send_json({"ok": True, "devices": scan_network(payload, connected)})
                return
            if self.path == "/api/message":
                message = validate_message(payload)
                with SHARED.lock:
                    SHARED.data["message"] = message
                self.send_json({"ok": True, "message": message})
                return
            config = SHARED.set_config(payload)
            self.send_json({"ok": True, "config": config})
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            self.send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def authorized(self) -> bool:
        if self.client_address[0] == "127.0.0.1":
            return True
        with SHARED.lock:
            config = deepcopy(SHARED.config)
        if not config.get("access", {}).get("require_auth", False):
            return True
        header = self.headers.get("Authorization", "")
        if not header.startswith("Basic "):
            return False
        try:
            username, password = base64.b64decode(header[6:], validate=True).decode("utf-8").split(":", 1)
        except (ValueError, UnicodeDecodeError):
            return False
        return verify_password(config, username, password)

    def request_authentication(self) -> None:
        body = b"Authentication required"
        self.send_response(HTTPStatus.UNAUTHORIZED)
        self.send_header("WWW-Authenticate", 'Basic realm="D\'San Master View", charset="UTF-8"')
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, value: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
        self.send_bytes(json.dumps(value).encode(), "application/json", status)

    def send_bytes(self, body: bytes, content_type: str, status: HTTPStatus = HTTPStatus.OK) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        bridge_policy = " 'unsafe-eval'" if getattr(self.server, "desktop_bridge", False) and self.client_address[0] == "127.0.0.1" else ""
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; style-src 'self' 'unsafe-inline'; "
            f"script-src 'self' 'unsafe-inline'{bridge_policy}; connect-src 'self'; img-src 'self' data:",
        )
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: Any) -> None:
        if self.path != "/api/state":
            super().log_message(fmt, *args)


def validate_message(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or not isinstance(payload.get("text"), str):
        raise ValueError("message text is required")
    if len(payload["text"]) > 160:
        raise ValueError("message must be 160 characters or fewer")
    color = payload.get("color", "#ffffff")
    if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise ValueError("message color must be a six-digit hex color")
    return {"text": payload["text"].strip(), "color": color, "flash": bool(payload.get("flash", False))}


def create_server(port: int = LOCAL_PORT) -> ThreadingHTTPServer:
    try:
        server = ThreadingHTTPServer((SERVER_BIND_HOST, port), Handler)
    except OSError as error:
        if os.environ.get("TECH_HUB_BACKEND_PORT"):
            raise
        if error.errno not in (errno.EADDRINUSE, 10048) and getattr(error, "winerror", None) != 10048:
            raise
        server = ThreadingHTTPServer((SERVER_BIND_HOST, 0), Handler)
    with SHARED.lock:
        SHARED.server_port = server.server_port
        SHARED.network_cache_at = 0.0
    LimitimerWorker(SHARED).start()
    PerfectCueWorker(SHARED).start()
    return server


def main() -> None:
    server = create_server()
    print(f"D’San Master View is available locally and on the LAN at port {server.server_port}", flush=True)
    if "--open" in sys.argv:
        threading.Timer(0.6, lambda: webbrowser.open(f"http://127.0.0.1:{server.server_port}")).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nMonitor stopped", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
