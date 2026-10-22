import {createWriteStream,createReadStream} from 'node:fs';
import {mkdir,stat,rename,writeFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
const root=new URL('../../asset-sources/tps-v4/',import.meta.url);await mkdir(root,{recursive:true});
const source='https://disk.yandex.com/d/bWopgbGj1ZUV1w',name='taichi.pth.tar',size=350993469;
const expectedSha256='0aa12db735ed9959b3e70d8c3ad171ee7282d235d2e4bcae2b25b7a8c7e63dca';
const target=new URL(name,root),part=new URL(name+'.download',root);
if((await stat(target).catch(()=>null))?.size===size){const hash=createHash('sha256');for await(const chunk of createReadStream(target))hash.update(chunk);if(hash.digest('hex')!==expectedSha256)throw new Error('Existing weight checksum mismatch');console.log(JSON.stringify({stage:'weights',status:'already-present-verified',bytes:size,sha256:expectedSha256}));process.exit(0);}
const url='https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key='+encodeURIComponent(source)+'&path='+encodeURIComponent('/'+name);
const listing=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!listing.ok)throw new Error('Yandex listing '+listing.status);const data=await listing.json();if(!data.href)throw new Error('No public download URL');
console.log(JSON.stringify({stage:'weights',status:'downloading',bytes:size,source}));
const response=await fetch(data.href,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw new Error('Weight download '+response.status);
const hash=createHash('sha256');let bytes=0;const stream=Readable.fromWeb(response.body);stream.on('data',chunk=>{hash.update(chunk);bytes+=chunk.length;});await pipeline(stream,createWriteStream(part));
if(bytes!==size)throw new Error('Unexpected weight size '+bytes);const sha256=hash.digest('hex');if(sha256!==expectedSha256)throw new Error('Weight checksum mismatch');await rename(part,target);
const manifest={source,repository:'https://github.com/yoyo-nb/Thin-Plate-Spline-Motion-Model',file:name,bytes,sha256,downloadedAt:new Date().toISOString(),license:'Repository MIT. Author-linked research checkpoint; commercial dataset/image permissions not asserted.'};await writeFile(new URL('weights-manifest.json',root),JSON.stringify(manifest,null,2));console.log(JSON.stringify({stage:'weights',status:'complete',...manifest}));
