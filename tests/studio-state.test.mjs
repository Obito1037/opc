import test from 'node:test';
import assert from 'node:assert/strict';
import {LookHistory,parseLookCollection,serializeLookCollection,sanitizePreferences} from '../src/studio-state.js';
import {defaultLook} from '../src/catalog.js';
test('undo groups a continuous slider gesture and branching clears redo',()=>{
  const h=new LookHistory(defaultLook);
  h.commit({...defaultLook,makeupIntensity:.5},{group:'intensity',time:100});
  h.commit({...defaultLook,makeupIntensity:.8},{group:'intensity',time:200});
  assert.equal(h.undo().makeupIntensity,.35);assert.equal(h.redo().makeupIntensity,.8);
  h.undo();h.commit({...defaultLook,color:'#78939f'});assert.equal(h.canRedo,false);assert.equal(h.undo().color,defaultLook.color);
});
test('history is bounded and does not retain mutable input objects',()=>{
  const h=new LookHistory(defaultLook,{limit:3}),value={...defaultLook,color:'#78939f'};h.commit(value);value.color='#ffffff';assert.equal(h.current.color,'#78939f');
  for(let i=0;i<8;i++)h.commit({...defaultLook,makeupIntensity:i/10});assert.equal(h.past.length,3);
});
test('portable collections round-trip only safe styling fields',()=>{
  const original=[{name:'我的春日搭配',look:{...defaultLook,secret:'not exported'},photo:'personal-image',id:'ignored'}];
  const encoded=serializeLookCollection(original);assert.ok(!encoded.includes('personal-image'));assert.ok(!encoded.includes('secret'));assert.ok(!encoded.includes('ignored'));
  assert.deepEqual(parseLookCollection(encoded),[{name:'我的春日搭配',look:defaultLook}]);
  const forged=JSON.stringify({format:'yingshen.looks',version:1,looks:[{name:'x',look:{color:'url(javascript:evil)',makeupIntensity:9}}]});
  assert.equal(parseLookCollection(forged)[0].look.color,defaultLook.color);assert.equal(parseLookCollection(forged)[0].look.makeupIntensity,1);
});
test('malformed/oversized collections and unknown preferences are rejected or normalized',()=>{
  for(const value of ['no json','{}','a'.repeat(65537),JSON.stringify({format:'yingshen.looks',version:1,looks:[{look:[]}]})])assert.throws(()=>parseLookCollection(value));
  assert.deepEqual(sanitizePreferences({theme:'invalid',quality:'unknown',motion:'off',backdrop:'file:///'}),{theme:'system',quality:'auto',motion:'system',backdrop:'pearl'});
});
