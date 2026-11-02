// react-native-audio-api downloads native libraries with a bash script run by
// Gradle. On Windows, when Gradle is started from PowerShell or Android Studio,
// Git's Unix tools (mkdir, rm, curl, unzip) are not on PATH, so it fails with
// "mkdir: command not found". This makes the script find them itself.
// Safe to run repeatedly; does nothing on other platforms or if already applied.
const fs = require('fs');
const path = require('path');

const file = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-audio-api',
  'scripts',
  'download-prebuilt-binaries.sh',
);
const MARK = '# finTrack: make Git-for-Windows tools findable';

if (!fs.existsSync(file)) {
  process.exit(0);
}
let text = fs.readFileSync(file, 'utf8');
if (text.includes(MARK)) {
  process.exit(0);
}
const eol = text.includes('\r\n') ? '\r\n' : '\n';
const lines = text.split(/\r?\n/);
// Keep the shebang first, then put /usr/bin and /bin at the front of PATH.
const at = lines[0].startsWith('#!') ? 1 : 0;
lines.splice(at, 0, MARK, 'export PATH="/usr/bin:/bin:/mingw64/bin:$PATH"');
fs.writeFileSync(file, lines.join(eol));
console.log('[finTrack] patched react-native-audio-api download script for Windows PATH');
