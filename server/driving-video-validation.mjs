import { validateVideo } from './video-validation.mjs';

export const MAX_DRIVING_VIDEO_BYTES=12*1024*1024;
export const DRIVING_VIDEO_LIMITS=Object.freeze({maxBytes:MAX_DRIVING_VIDEO_BYTES,minDurationSeconds:3,maxDurationSeconds:15,minDimension:128,
  maxLongEdge:1920,maxShortEdge:1080,minFps:8,maxFps:60,maxFrames:900,acceptedMimeTypes:['video/mp4','video/webm']});
const invalid=()=>{throw Object.assign(new Error('驱动视频无效。请上传 3–15 秒、最高 1080p 的 MP4 或 WebM，且不超过 12 MB。'),{code:'INVALID_DRIVING_VIDEO'});};
function vint(bytes,offset,strip){
  if(offset>=bytes.length||!bytes[offset])invalid();
  let length=1,marker=0x80;while(!(bytes[offset]&marker)){length++;marker>>=1;}
  if(length>(strip?8:4)||offset+length>bytes.length)invalid();
  let value=BigInt(strip?bytes[offset]&(marker-1):bytes[offset]);
  for(let i=1;i<length;i++)value=(value<<8n)|BigInt(bytes[offset+i]);
  return{length,value,unknown:strip&&value===(1n<<BigInt(length*7))-1n};
}
function element(bytes,offset){const id=vint(bytes,offset,false),size=vint(bytes,offset+id.length,true),start=offset+id.length+size.length;
  if(!size.unknown&&size.value>BigInt(bytes.length-start))invalid();
  return{id:Number(id.value),start,end:size.unknown?bytes.length:start+Number(size.value),unknown:size.unknown};}
function webmHeader(bytes){
  const header=element(bytes,0);if(header.id!==0x1a45dfa3||header.unknown||header.end>4096)invalid();
  let docType;for(let offset=header.start,count=0;offset<header.end;count++){
    if(count>32)invalid();const item=element(bytes,offset);if(item.unknown||item.end>header.end)invalid();
    if(item.id===0x4282)docType=bytes.toString('ascii',item.start,item.end);offset=item.end;
  }
  if(docType!=='webm')invalid();
  let offset=header.end;for(let count=0;count<16;count++){
    const item=element(bytes,offset);
    if(item.id===0x18538067){if(item.start===item.end||item.end!==bytes.length)invalid();return;}
    if(item.unknown||![0xec,0xbf].includes(item.id))invalid();offset=item.end;
  }
  invalid();
}
// Only a bounded container gate. The Python runner must fully decode/probe
// duration, dimensions, frame count and rate before importing neural models.
export function validateDrivingVideo(bytes,mimeType){
  if(!Buffer.isBuffer(bytes)||bytes.length<32||bytes.length>MAX_DRIVING_VIDEO_BYTES)invalid();
  if(mimeType==='video/mp4'){
    let metadata;try{metadata=validateVideo(bytes);}catch{invalid();}
    if(metadata.durationSeconds<3||metadata.durationSeconds>15||Math.max(metadata.width,metadata.height)>1920||Math.min(metadata.width,metadata.height)>1080||Math.min(metadata.width,metadata.height)<128)invalid();
    return{...metadata,extension:'mp4'};
  }
  if(mimeType==='video/webm'){webmHeader(bytes);return{mimeType,extension:'webm',bytes:bytes.length};}
  invalid();
}
export function parseDrivingVideoDataUri(value){
  if(typeof value!=='string'||value.length>Math.ceil(MAX_DRIVING_VIDEO_BYTES/3)*4+64)invalid();
  const match=/^data:(video\/(?:mp4|webm));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match||match[2].length%4!==0)invalid();const buffer=Buffer.from(match[2],'base64');
  if(buffer.toString('base64')!==match[2])invalid();return{buffer,...validateDrivingVideo(buffer,match[1])};
}
