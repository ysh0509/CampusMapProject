/*
pathWorker.js
해당 js는 웹 워커로서, 경로 탐색 알고리즘을 실행하는 역할 수행
*/

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
