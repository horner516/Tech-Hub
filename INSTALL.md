Tech Hub — Mac installation

Requires an Apple silicon Mac (M1 or later) running macOS 13 or later.

1. Open the disk image and drag Tech Hub into Applications.
2. Open Tech Hub from Applications. The TH menu appears in the menu bar.
3. Choose Open Master Page. It shows the status and URLs for all five services.
4. Allow Local Network access if macOS asks. If using the macOS firewall, allow
   incoming connections for Tech Hub when sharing dashboards with other computers.
5. Use each service’s settings to add your devices. New installs start empty.

This build is ad-hoc signed, not Apple Developer ID signed or notarized. macOS
may block the first launch. After verifying the download’s source, use System
Settings > Privacy & Security > Open Anyway if offered by macOS.

Share individual service URLs from the master page. Set separate service
passwords there if you need restricted access. The admin page is local to this
Mac. HTTP is unencrypted; use a trusted show network.

Quit Tech Hub from the TH menu before replacing the module with an update.
Configuration is stored in ~/Library/Application Support/Tech Hub and survives
module updates. The menu provides shortcuts to configuration and logs.


## Tech Hub 1.0 module choices

Choose Host for a smaller download and install modules from Module Library. Choose Full to include all five official modules without internet access. The all-modules ZIP can also be imported through Module Library on an existing host; use the universal ZIP matching your host catalog version. The Full installer retains previously disabled services. Module updates and uninstall preserve settings. Existing 0.x installations can use Install previously enabled modules after a Host upgrade. Quit Tech Hub before replacing the desktop application.

Module packages are universal between supported Mac and Windows hosts. Tech Hub provides Node and the native D’san/Power compatibility engines. Lux Link returns in host 1.0.4 as a universal module; existing settings are retained. The MA Web Remote screen reader is supplied by the Mac host. See sdk/SHARED-RUNTIME.md for the runtime contract.
