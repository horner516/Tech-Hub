"""Bounded, user-requested TCP discovery for serial network adapters."""
import ipaddress
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor

SCAN_LOCK = threading.Lock()


def identify_traffic(data):
    # Import on demand to reuse the validated protocol implementation.
    from app import crc16_modbus
    for offset in range(max(0, len(data) - 54)):
        frame = data[offset:offset + 55]
        if frame[:2] == b'\x81\x00' and frame[51] == 0x83 and frame[54] == 0xff:
            if int.from_bytes(frame[52:54], 'big') == crc16_modbus(frame[:52]):
                return 'Limitimer — verified status frame'
    if data and all(value in (0x0f, 0x1f, 0x2f, 0x3f) for value in data):
        return 'Possible PerfectCue — cue bytes observed'
    return 'Unknown — no identifying traffic'


def listen_for_identity(connection):
    data = bytearray()
    deadline = time.monotonic() + 1.2
    while time.monotonic() < deadline and len(data) < 8192:
        connection.settimeout(max(.01, deadline - time.monotonic()))
        try:
            chunk = connection.recv(min(4096, 8192 - len(data)))
        except OSError:
            break
        if not chunk:
            break
        data.extend(chunk)
        identity = identify_traffic(data)
        if identity.startswith('Limitimer'):
            return identity
    return identify_traffic(data)


def scan_targets(payload):
    if not isinstance(payload, dict):
        raise ValueError('Enter a subnet and ports to scan.')
    try:
        network = ipaddress.ip_network(str(payload.get('subnet', '')), strict=False)
    except ValueError:
        raise ValueError('Enter an IPv4 subnet such as 10.21.0.0/24.')
    private_ranges = [ipaddress.ip_network(value) for value in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16')]
    if network.version != 4 or network.prefixlen < 24 or not any(network.subnet_of(item) for item in private_ranges):
        raise ValueError('Scan a local IPv4 subnet of 256 addresses or fewer (/24 through /32).')
    ports = payload.get('ports')
    if not isinstance(ports, list) or not 1 <= len(ports) <= 4 or any(type(port) is not int or not 1 <= port <= 65535 for port in ports):
        raise ValueError('Enter between one and four TCP ports, from 1 to 65535.')
    return [(str(host), port) for host in network.hosts() for port in sorted(set(ports))]


def scan_network(payload, connected=()):
    targets = scan_targets(payload)
    if not SCAN_LOCK.acquire(blocking=False):
        raise ValueError('A scan is already running. Please wait for it to finish.')
    known = set(connected)
    def probe(target):
        host, port = target
        if target in known:
            return {'host': host, 'port': port, 'connected': True}
        try:
            with socket.create_connection(target, timeout=0.4) as connection:
                return {'host': host, 'port': port, 'connected': False, 'identity': listen_for_identity(connection)}
        except OSError:
            return None
    try:
        with ThreadPoolExecutor(max_workers=24) as pool:
            return [result for result in pool.map(probe, targets) if result]
    finally:
        SCAN_LOCK.release()
