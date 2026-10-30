import type { XmcpConfig } from 'xmcp';

const config: XmcpConfig = {
  stdio: true,
  http: true,
  paths: {
    prompts: false,
    resources: false,
  },
  bundler: (rspackConfig) => {
    rspackConfig.resolve = {
      ...rspackConfig.resolve,
      extensionAlias: {
        ...(rspackConfig.resolve?.extensionAlias ?? {}),
        '.js': ['.ts', '.js'],
        '.mjs': ['.mts', '.mjs'],
      },
    };
    return rspackConfig;
  },
};

export default config;
