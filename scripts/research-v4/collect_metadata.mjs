// Public model listings only. Does not download weights or call inference APIs.
import {writeFile,mkdir} from 'node:fs/promises';
import os from 'node:os';
const output=new URL('./results/',import.meta.url);await mkdir(output,{recursive:true});
const sources={
 fashn:'https://huggingface.co/api/models/fashn-ai/fashn-vton-1.5/tree/main?recursive=true',
 liveportrait:'https://huggingface.co/api/models/KwaiVGI/LivePortrait/tree/main?recursive=true',
 tps:'https://cloud-api.yandex.net/v1/disk/public/resources?public_key=https://disk.yandex.com/d/bWopgbGj1ZUV1w'
};
const result={at:new Date().toISOString(),machine:{cpu:os.cpus()[0].model,logicalCores:os.cpus().length,totalGiB:os.totalmem()/2**30,freeGiB:os.freemem()/2**30,node:process.version},sources:{}};
for(const [name,url] of Object.entries(sources)){
 try{const response=await fetch(url,{signal:AbortSignal.timeout(25000)});const data=await response.json();const listing=Array.isArray(data)?data:data._embedded?.items;result.sources[name]={url,status:response.status,files:listing?.filter(f=>f.size).map(f=>({path:f.path||f.name,bytes:f.size})),error:data.error};}
 catch(e){result.sources[name]={url,error:e.message};}
}
await writeFile(new URL('model-metadata.json',output),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
