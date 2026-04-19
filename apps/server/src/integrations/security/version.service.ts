import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const packageJson = require('./../../../package.json');

@Injectable()
export class VersionService {
  constructor() {}

  async getVersion() {
    const url = `https://api.github.com/repos/Yundi339/docmost/releases/latest`;
    const currentVersion = packageJson?.version;

    let latestVersion = null;
    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        latestVersion = data?.tag_name?.replace('v', '') ?? null;
      }
    } catch (err) {
      /* empty */
    }

    return {
      currentVersion,
      latestVersion,
      releaseUrl: 'https://github.com/Yundi339/docmost/releases',
    };
  }
}
