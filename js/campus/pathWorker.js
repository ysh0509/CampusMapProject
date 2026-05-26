import { findPath } from './pathfinder.js';

self.onmessage = function (e) {
  const { graphObj, start, end, mode } = e.data;
  try {
    const path = findPath(graphObj, start, end, mode);
    self.postMessage({ path, mode });
  } catch (err) {
    self.postMessage({ path: [], mode, error: err.message });
  }
};
