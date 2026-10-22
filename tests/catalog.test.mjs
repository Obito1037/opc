import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,defaultLook,applyProduct,validateImageFile,sanitizeLook} from '../src/catalog.js';
test('changing shoes, accessories and makeup retains existing clothing selection',()=>{
  let look=applyProduct(defaultLook,catalog.find(p=>p.id==='rose-dress'));
  for(const id of ['city-boots','frame-glasses','coral-lip'])look=applyProduct(look,catalog.find(p=>p.id===id));
  assert.equal(look.garment,'dress');assert.equal(look.color,'#b77b76');
  assert.equal(look.shoe,'boots');assert.equal(look.accessory,'glasses');assert.equal(look.makeup,'#c46e58');
  assert.equal(defaultLook.garment,'shirt');
});
test('upload validation rejects unsupported, empty and oversized files',()=>{
  assert.match(validateImageFile({type:'image/svg+xml',size:100}),/JPG/);
  assert.match(validateImageFile({type:'image/jpeg',size:17*1024*1024}),/16 MB/);
  assert.ok(validateImageFile({type:'image/png',size:0}));
  assert.equal(validateImageFile({type:'image/webp',size:1024}),'');
});
test('saved presets cannot introduce arbitrary values and opacity stays bounded',()=>{
  assert.deepEqual(sanitizeLook(null),defaultLook);
  const result=sanitizeLook({color:'red',garment:'<script>',makeup:'#cc0022',makeupIntensity:10,accessory:'none'});
  assert.equal(result.color,defaultLook.color);assert.equal(result.garment,'shirt');
  assert.equal(result.makeup,'#cc0022');assert.equal(result.makeupIntensity,1);assert.equal(result.accessory,'none');
});
