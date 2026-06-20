import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

const rootPackage = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'),
);
const expectedVersion = rootPackage.version;
const failures = [];
const packageFiles = new Set(['package.json']);
const workspacePatterns = rootPackage.workspaces?.packages ?? [];

for (const pattern of workspacePatterns) {
  const [baseDir, wildcard] = pattern.split('/');

  if (wildcard !== '*' || !baseDir) {
    continue;
  }

  const absoluteBaseDir = path.join(rootDir, baseDir);
  if (!fs.existsSync(absoluteBaseDir)) {
    continue;
  }

  for (const entry of fs.readdirSync(absoluteBaseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageFile = path.join(baseDir, entry.name, 'package.json');
    if (fs.existsSync(path.join(rootDir, packageFile))) {
      packageFiles.add(packageFile);
    }
  }
}

for (const packageFile of packageFiles) {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(rootDir, packageFile), 'utf8'),
  );

  if (packageJson.version !== expectedVersion) {
    failures.push(
      `${packageFile}: expected ${expectedVersion}, got ${
        packageJson.version ?? '<missing>'
      }`,
    );
  }
}

if (failures.length > 0) {
  console.error('Package versions are not synchronized:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`All package versions are synchronized at ${expectedVersion}.`);
