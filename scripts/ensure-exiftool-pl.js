// Ensure optional exiftool-vendored.pl directory exists to avoid ENOENT during packaging
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const targetDir = path.join(root, 'node_modules', 'exiftool-vendored.pl');

try {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    process.stdout.write(`Created placeholder: ${targetDir}\n`);
  } else {
    process.stdout.write(`Placeholder already exists: ${targetDir}\n`);
  }
  process.exit(0);
} catch (err) {
  console.error('Failed to ensure exiftool-vendored.pl directory:', err);
  process.exit(1);
}


