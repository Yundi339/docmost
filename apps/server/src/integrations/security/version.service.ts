import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const packageJson = require('./../../../package.json');

@Injectable()
export class VersionService {
  constructor() {}

  async getVersion() {
    const currentVersion = packageJson?.version;

    return {
      currentVersion,
    };
  }
}
