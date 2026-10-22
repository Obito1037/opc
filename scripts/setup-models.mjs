import {mkdir,copyFile,readdir,stat,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const modelDir=path.join(root,'public/models');
await mkdir(modelDir,{recursive:true});
await mkdir(path.join(root,'public/mediapipe'),{recursive:true});
const wasmDir=path.join(root,'node_modules/@mediapipe/tasks-vision/wasm');
for(const file of await readdir(wasmDir)) if(/\.(wasm|js)$/.test(file)) await copyFile(path.join(wasmDir,file),path.join(root,'public/mediapipe',file));
const models=[
  ['pose_landmarker_lite.task','https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'],
  ['face_landmarker.task','https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'],
  ['selfie_multiclass_256x256.tflite','https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite'],
];
const manifest=[];
for(const [name,url] of models) {
  const destination=path.join(modelDir,name);
  let exists=false;try{exists=(await stat(destination)).size>1000000;}catch{}
  if(!exists){
    console.log(`Downloading ${name} ...`);
    const response=await fetch(url,{signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw new Error(`${response.status} downloading ${name}`);
    const data=Buffer.from(await response.arrayBuffer());
    if(data.length<1000000)throw new Error(`Invalid model: ${name}`);
    await writeFile(destination,data);
  }
  const {readFile}=await import('node:fs/promises');
  const data=await readFile(destination);
  manifest.push({name,url,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
  console.log(`Ready ${name} (${data.length} bytes)`);
}
await writeFile(path.join(modelDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Models and WASM ready. All photo inference is local.');
