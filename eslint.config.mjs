import clientConfigs from "./apps/client/eslint.config.mjs";
import serverConfigs from "./apps/server/eslint.config.mjs";

const serverFiles = ["apps/server/**/*.{ts,tsx,js}"];
const clientFiles = ["apps/client/**/*.{ts,tsx}"];

function scopeConfigs(configs, directory, defaultFiles) {
  return configs.map((config) => {
    const { files, ignores, ...scopedConfig } = config;
    return {
      ...scopedConfig,
      files: files
        ? files.map((pattern) => `${directory}/${pattern}`)
        : defaultFiles,
      ...(ignores
        ? { ignores: ignores.map((pattern) => `${directory}/${pattern}`) }
        : {}),
    };
  });
}

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "apps/client/eslint.config.mjs",
      "apps/server/eslint.config.mjs",
    ],
  },
  ...scopeConfigs(serverConfigs, "apps/server", serverFiles),
  ...scopeConfigs(clientConfigs, "apps/client", clientFiles),
];
