# NovaStar VMP project format (`.nprj`) — what we know

Notes from examining a real project file exported by **VMP V1.5.1**:
`Default Project-2026-07-30-21-29.nprj`, 9.9 MB, 8 × MX40 Pro (offline project).

**Headline: a `.nprj` is a zip of plain JSON.** It is not an opaque binary. Generating
one is a realistic goal — unlike LCT's `.scr`, which remains proprietary and is still
not something to fabricate.

One thing blocks a writer today, and it is a gap in the *sample*, not in the format.
See §5.

---

## 1. Container

```
Default Project-….nprj                  zip
├── check.xml                           manifest: project + device inventory
├── XCenterFile.zip                     zip
│   └── projectDocData.json             email/alarm config + screen↔device mapping
├── 192.168.0.10_project_               zip, one per device, named by IP
├── 192.168.0.11_project_
└── …                                   (8 devices here)
```

Each `<ip>_project_` entry is itself a zip holding that controller's filesystem:

```
customconfig/cabinetCustom.json         custom cabinet definitions
rvCardData/
  singleCabinetConfig.json              cabinetID → physical size
  cards/{1..8}customBase.bin            receiving-card config blobs, magic "RCCB"
  cards/defaultCard.bin                 372,813 bytes each (680,275 for default)
controller3.1/
  usrconfig/screenConfig.json           ← THE FILE THAT MATTERS
  usrconfig/outputConfig.json           colour, gamma, HDR, sync, bit depth
  usrconfig/deviceConfig.json           network, optical port mode
  usrconfig/screenAutoConfig.json       the auto-config wizard's last settings
  usrconfig/backup.json                 master/backup pairing
  usrconfig/… (30-odd more)             presets, schedules, SNMP, monitoring
  customconfig/…
```

## 2. `check.xml` — the manifest

```xml
<ProjectConfig ProjectVersion="1" ProjectId="offlineDefaultProjectUuid"
               ProjectName="Default Project" GenerateTime="1785443355975"
               VMPVersion="V1.5.1" IsOnlineProject="false">
  <Devices DeviceNumber="8">
    <Device isBakcup="false" slaveMac="" masterMac="">
      <LastOperatorTime>1783871311</LastOperatorTime>
      <DeviceDataFilePath>192.168.0.10_project_</DeviceDataFilePath>
      <ProejctName>Default Project</ProejctName>   <!-- sic: typo is in the format -->
      <ScreenGroups/>
      <Screens><Screen name="New Screen 1"/></Screens>
      <DeviceName>MX40 Pro_1</DeviceName>
      <DeviceKey>127.0.0.1@10001</DeviceKey>
      <DeviceIp>192.168.0.10</DeviceIp>
      <DeviceSN>047Z988SJVQWV080</DeviceSN>
      <DeviceMAC>00:11:22:33:38:11</DeviceMAC>
      <DeviceModelID>5141</DeviceModelID>          <!-- 5141 = MX40 Pro -->
      <DeviceTypeName>MX40 Pro</DeviceTypeName>
      <DeviceVersion>V1.5.1</DeviceVersion>
      <Subcards/>
    </Device>
    …
  </Devices>
</ProjectConfig>
```

Note `ProejctName` is misspelled in the schema itself. A writer must reproduce the
typo. Also note `DeviceKey` uses `@` here but `:` in `projectDocData.json`
(`127.0.0.1:10001`) — the two files disagree on the separator.

## 3. `screenConfig.json` — the actual map

```jsonc
{
  "screens": [{
    "screenID": "{bed25068-1b5f-4c67-b4cf-4cf3141ef2eb}",   // braced GUID
    "screenName": "New Screen 1",
    "workingMode": 1, "layoutMode": 0, "lowLatency": false,
    "position": {"x": 0, "y": 0},
    "screenGroupID": "{83b0b25f-…}",
    "canvases": [{
      "canvasID": 2048,
      "outputCardId": 8,
      "outputCardModeId": 5141,        // == DeviceModelID
      "inputID": 0,
      "size": {"width": 3840, "height": 2160},    // the input raster
      "position": {"x": 4040, "y": 0},            // canvas placement
      "rectSize": {"width": 384, "height": 2304}, // bounding box of the cabinets
      "cabinets": [
        {"cabinetID": 14416869612060672, "connectID": 0, "outputID": 2048,
         "pageID": 0, "position": {"x": 0, "y": 1968},
         "size": {"width": 192, "height": 192}, "angle": 0, "lockStatus": false},
        …
      ]
    }]
  }],
  "CanvasSizeInfo": …,
  "screenGroups": …
}
```

### `cabinetID` is structured — 64-bit, big-endian byte fields

`14416869612060672` = `0x0033381108000000`:

| Bytes | Value        | Meaning                                             |
|-------|--------------|-----------------------------------------------------|
| 0     | `00`         | pad                                                 |
| 1–3   | `33 38 11`   | **low three octets of the device MAC** (`00:11:22:33:38:11`) |
| 4     | `08`         | matches `outputCardId` (8)                          |
| 5–7   | `00 00 00`   | sequential cabinet index, 0-based                   |

So cabinet IDs are derivable, not opaque: `(macTail << 32) | (outputCard << 24) | index`.
Confirmed across all 18 cabinets — indices ran `0x000000`–`0x000011`.

### Geometry

Cabinet `position` is in **pixels, relative to the canvas**, and **can be negative**
(this sample runs `y` from `-144` to `1968`). `rectSize` is the bounding box of the
placed cabinets, not the canvas size.

## 4. What the sample contained

- 8 devices declared; **only device 1 (192.168.0.10) has any cabinets**. The other seven
  have a screen and a canvas with an empty `cabinets` array.
- 18 cabinets of 192 × 192 px, in two columns.
- Ordered by `connectID`, the positions walk a clean serpentine: column `x=0` from
  `y=1968` up to `y=-144` (IDs 0–11), then column `x=192` from `y=-144` down to `y=816`
  (IDs 12–17).

## 5. THE BLOCKER: `connectID` is ambiguous in this sample

Nothing anywhere in the tree names an Ethernet port. There is no `netPort`, no
`portIndex`, no per-port grouping. `outputID` is `2048` for every cabinet — identical to
`canvasID` — so it carries no per-port information here. That leaves `connectID`, and it
has two readings this sample cannot separate:

**(a) `connectID` is the sending order within one Ethernet port.**
For: the serpentine walk is exactly what a cable run looks like, reversing at the column
boundary. Against: 18 × 36,864 px = **663,552 px**, which exceeds the MX40 Pro's
659,722 px per-port limit at 8-bit/60 Hz. VMP should not have permitted that on one port.

**(b) `connectID` is the Ethernet port index (0-based).**
For: 18 values ≤ the MX40 Pro's 20 ports, contiguous and unique; "connect" reads like a
physical connection. Against: one cabinet per port is a strange way to wire a wall, and
the serpentine ordering would then be incidental.

### The experiment that settles it

Export a project with **more cabinets than the device has ports** — say 40 cabinets of
any size on one MX40 Pro, auto-configured across several ports.

- If `connectID` runs `0…39`, it is sending order (reading **a**), and the port must be
  encoded somewhere else — most likely in `outputID`, which would then vary.
- If `connectID` repeats `0…19` (or resets per port) and `outputID` varies, reading
  **(b)** is right and `outputID` identifies the port.

A sample spanning **two devices** with cabinets would also confirm that the MAC tail in
`cabinetID` tracks the owning device, which is currently inferred from one device only.

## 6. Feasibility assessment

| Piece | Status |
|-------|--------|
| Zip-of-zips container | ✅ trivial |
| `check.xml` manifest | ✅ fully understood (mind the `ProejctName` typo) |
| `projectDocData.json` | ✅ small, screen↔device mapping |
| `screenConfig.json` geometry | ✅ understood |
| `cabinetID` construction | ✅ derived and confirmed |
| **Port assignment** | ❌ **blocked — see §5** |
| `rvCardData/cards/*.bin` | ⚠️ opaque ("RCCB" magic). Probably copyable as a template rather than synthesised; unverified whether they must match the cabinet type. |
| The other ~30 config files | ⚠️ mostly defaults; a writer would clone them from a template project and patch only what changes. |

The realistic implementation is **template-based**: take a known-good exported project
as a skeleton, rewrite `check.xml`, `projectDocData.json` and each device's
`screenConfig.json`, and pass the binaries through untouched. That avoids synthesising
the parts that are still opaque.

**Not attempted until §5 is resolved.** Emitting a project with the port mapping guessed
would produce exactly the failure mode this project refuses to ship: a file that loads
and looks right but drives the wrong cabinets.

---

## Sample provenance

`Default Project-2026-07-30-21-29.nprj`, VMP V1.5.1, offline project, 8 × MX40 Pro with
simulated devices (`127.0.0.1@1000x`, MACs `00:11:22:33:38:11`–`18`). Supplied by the
project author. Not committed to this repo.
