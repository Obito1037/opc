import {sanitizeLook} from './catalog.js';

// History stores only small, validated styling parameters, never personal media.
export class LookHistory {
  constructor(initial,{limit=40}={}){this.current=sanitizeLook(initial);this.past=[];this.future=[];this.limit=limit;this.lastGroup=null;this.lastTime=0;}
  commit(value,{group=null,time=Date.now()}={}){
    const next=sanitizeLook(value);if(JSON.stringify(next)===JSON.stringify(this.current))return false;
    if(!group||group!==this.lastGroup||time-this.lastTime>700||this.future.length){this.past.push(this.current);if(this.past.length>this.limit)this.past.shift();}
    this.current=next;this.future=[];this.lastGroup=group;this.lastTime=time;return true;
  }
  undo(){if(!this.past.length)return null;this.future.push(this.current);this.current=this.past.pop();this.lastGroup=null;return {...this.current};}
  redo(){if(!this.future.length)return null;this.past.push(this.current);this.current=this.future.pop();this.lastGroup=null;return {...this.current};}
  get canUndo(){return this.past.length>0;}
  get canRedo(){return this.future.length>0;}
}
export function sanitizePreferences(value={}){
  return {theme:['system','light','dark'].includes(value?.theme)?value.theme:'system',quality:['auto','balanced','quality'].includes(value?.quality)?value.quality:'auto',motion:['system','reduced','full'].includes(value?.motion)?value.motion:'system',backdrop:['pearl','ink','rose'].includes(value?.backdrop)?value.backdrop:'pearl'};
}
export function safeLookName(value){return String(value??'我的搭配').replace(/[\u0000-\u001f]/g,'').trim().slice(0,50)||'我的搭配';}
export function parseLookCollection(text){
  if(typeof text!=='string'||text.length>65536)throw new Error('搭配文件过大，请选择 64 KB 以内的 JSON 文件');
  let data;try{data=JSON.parse(text);}catch{throw new Error('无法读取搭配文件，请选择映身导出的 JSON');}
  if(data?.format!=='yingshen.looks'||data.version!==1||!Array.isArray(data.looks)||data.looks.length<1||data.looks.length>24)throw new Error('搭配文件格式不正确，单次可导入 1–24 套');
  return data.looks.map(item=>{if(!item||typeof item!=='object'||!item.look||typeof item.look!=='object'||Array.isArray(item.look))throw new Error('搭配条目不完整');return {name:safeLookName(item.name),look:sanitizeLook(item.look)};});
}
export function serializeLookCollection(looks){return JSON.stringify({format:'yingshen.looks',version:1,looks:looks.slice(0,24).map(item=>({name:safeLookName(item.name),look:sanitizeLook(item.look)}))},null,2);}
