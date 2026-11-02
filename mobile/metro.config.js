const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// react-native-audio-api re-exports its <AudioControls> UI component from the
// package root, and that component imports reanimated and gesture-handler,
// which the library doesn't declare as dependencies. We don't use the
// component, so resolve those imports to empty modules — only when they come
// from inside react-native-audio-api, so the real packages still work if you
// install them later.
const AUDIO_API_DIR = path.join('node_modules', 'react-native-audio-api');
const STUBBED_MODULES = new Set([
  'react-native-reanimated',
  'react-native-gesture-handler',
]);

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    resolveRequest: (context, moduleName, platform) => {
      if (
        STUBBED_MODULES.has(moduleName) &&
        path.normalize(context.originModulePath).includes(AUDIO_API_DIR)
      ) {
        return { type: 'empty' };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
