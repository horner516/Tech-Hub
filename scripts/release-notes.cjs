'use strict';
// GitHub assets are a flat list; provide grouped download links above the notes.
const fs=require('node:fs');
function downloads(version,apps){
 const base=`https://github.com/horner516/Tech-Hub/releases/download/v${version}/`;
 const link=(name,file)=>`[${name}](${base}${file})`;
 return `## Downloads

### Full w/all modules

Tech Hub with all official modules included for offline installation.

- ${link('Mac — Apple silicon','Tech-Hub-macOS-arm64-Full.dmg')}
- ${link('Windows — x64','Tech-Hub-Windows-x64-Full-Setup.exe')}
- ${link('Linux / Raspberry Pi — ARM64','Tech-Hub-Linux-arm64-Full.tar.gz')}
- ${link('Linux — x64','Tech-Hub-Linux-x64-Full.tar.gz')}

### Lite Installer

Tech Hub host and shared runtime. Choose and download modules from the Module Library after installation.

- ${link('Mac — Apple silicon','Tech-Hub-macOS-arm64.dmg')}
- ${link('Windows — x64','Tech-Hub-Windows-x64-Setup.exe')}
- ${link('Linux / Raspberry Pi — ARM64','Tech-Hub-Linux-arm64-Lite.tar.gz')}
- ${link('Linux — x64','Tech-Hub-Linux-x64-Lite.tar.gz')}

### Modules

Universal module packages for Mac, Windows and Linux. Install official modules through the Module Library; use the all-modules ZIP for offline installation.

- **${link('Download all modules','Tech-Hub-All-Apps.zip')}**
${apps.map(a=>`- ${link(a.name,new URL(a.packages.universal.url).pathname.split('/').pop())}`).join('\n')}
- ${link('Developer SDK','Tech-Hub-SDK.zip')}

---

`;
}
if(require.main===module){const version=require('../package.json').version,catalog=JSON.parse(fs.readFileSync(process.argv[2])),notes=fs.readFileSync('RELEASE_NOTES.md','utf8');process.stdout.write(downloads(version,catalog.apps)+notes);}
module.exports={downloads};
