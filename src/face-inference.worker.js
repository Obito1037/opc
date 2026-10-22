import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// Emscripten's optional debug hook avoids its non-strict block-function fallback
// when this classic runtime is imported with module semantics.
self.dbg = (...args) => console.warn(...args);

// MediaPipe's WASM loader uses a CommonJS/global factory. Its module-worker
// fallback calls self.import: bridge it without eval or remote scripts.
self.import = async path => {
  const url = new URL(path, self.location.href);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/mediapipe/'))
    throw new Error('Only local MediaPipe runtime files can be loaded');
  self.exports = {}; self.module = { exports: self.exports };
  await import(/* @vite-ignore */ url.href);
  self.ModuleFactory = self.module.exports;
};

let model;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      const files = await FilesetResolver.forVisionTasks('/mediapipe');
      model = await FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate: 'CPU' },
        runningMode: 'VIDEO', numFaces: 1, minFaceDetectionConfidence: .5,
        minTrackingConfidence: .5, outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'detect') {
      const started = performance.now();
      try {
        const result = model.detectForVideo(data.bitmap, data.timestamp);
        self.postMessage({ type: 'result', id: data.id, sourceId: data.sourceId,
          face: result.faceLandmarks[0] || null, inferenceMs: performance.now() - started });
      } finally { data.bitmap.close(); }
    }
  } catch (error) {
    self.postMessage({ type: 'error', id: data.id, sourceId: data.sourceId, message: error.message });
  }
};
