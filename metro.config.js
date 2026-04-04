const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** Metro was resolving `zustand/middleware` to `esm/middleware.mjs` on web, which uses
 * `import.meta` and breaks in the classic bundle (SyntaxError). Force the CJS build. */
const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

const zustandMiddlewareCjs = path.join(projectRoot, 'node_modules', 'zustand', 'middleware.js');

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'zustand/middleware') {
    return { type: 'sourceFile', filePath: zustandMiddlewareCjs };
  }
  if (typeof upstreamResolveRequest === 'function') {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
