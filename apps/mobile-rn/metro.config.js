const path = require('path');
const {
  getDefaultConfig,
  mergeConfig,
} = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

const config = {
  watchFolders: [
    path.resolve(__dirname, '../../packages'),
  ],
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(__dirname, '../../node_modules'),
    ],
    extraNodeModules: {
      '@maka/core': path.resolve(__dirname, '../../packages/core'),
      '@maka/runtime-host': path.resolve(__dirname, '../../packages/runtime-host'),
    },
  },
};

module.exports = mergeConfig(defaultConfig, config);