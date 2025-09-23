// Ensure optional exiftool-vendored directories exist to avoid ENOENT during packaging
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const dirsToEnsure = [
  path.join(root, 'node_modules', 'exiftool-vendored.pl'),
  path.join(root, 'node_modules', 'exiftool-vendored.exe'),
];

try {
  dirsToEnsure.forEach((dirPath) => {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      process.stdout.write(`Created placeholder: ${dirPath}\n`);
    } else {
      process.stdout.write(`Placeholder already exists: ${dirPath}\n`);
    }
  });
  process.exit(0);
} catch (err) {
  console.error('Failed to ensure exiftool-vendored.pl directory:', err);
  process.exit(1);
}


