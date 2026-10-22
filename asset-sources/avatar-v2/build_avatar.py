"""Reproducible CC0 MakeHuman adaptation. Run with Blender 4.5 background Python."""
import bpy, json, math, os, bmesh
from mathutils import Vector, Matrix
P = os.path.dirname(os.path.abspath(__file__))
OUTPUT = os.path.abspath(os.path.join(P,'../../public/models/avatar-v2/atelier-body.glb'))
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
verts=[]; faces=[]; helpers={}; group=''
for line in open(os.path.join(P,'base.obj')):
    a=line.split()
    if not a: continue
    if a[0]=='v': verts.append(Vector(map(float,a[1:4])))
    elif a[0]=='g': group=a[1]
    elif a[0]=='f':
        face=[int(v.split('/')[0])-1 for v in a[1:]]
        if group=='body':faces.append(face)
        elif group in ['helper-tights','helper-skirt']:helpers.setdefault(group,[]).append(face)
rig=json.load(open(os.path.join(P,'default.mhskel')))
weights=json.load(open(os.path.join(P,'default_weights.mhw')))['weights']
scale=3.36/16.6589
def coord(p): return Vector((p.x*scale,-p.z*scale,(p.y+8.1676)*scale))
def joint(name):
    ids=rig['joints'][name]; return coord(sum((verts[i] for i in ids),Vector())/len(ids))
def head(n): return joint(rig['bones'][n]['head'])
points={
 'Hips':head('root'), 'Spine':head('spine03'), 'Chest':head('spine01'),
 'Neck':head('neck01'), 'Head':head('head'),
}
parents={'Hips':None,'Spine':'Hips','Chest':'Spine','Neck':'Chest','Head':'Neck'}
for s in ['L','R']:
    for name,source,parent in [('UpperArm','upperarm01','Chest'),('ForeArm','lowerarm01','UpperArm.'+s),('Hand','wrist','ForeArm.'+s),('Thigh','upperleg01','Hips'),('Shin','lowerleg01','Thigh.'+s),('Foot','foot','Shin.'+s)]:
        points[name+'.'+s]=head(source+'.'+s); parents[name+'.'+s]=parent
def mapped(n):
    s=n[-1]; suffix='.'+s
    for prefix,target in [('upperarm','UpperArm'),('lowerarm','ForeArm'),('wrist','Hand'),('finger','Hand'),('metacarpal','Hand'),('upperleg','Thigh'),('lowerleg','Shin'),('foot','Foot'),('toe','Foot')]:
        if n.startswith(prefix): return target+suffix
    if n.startswith('neck'):return 'Neck'
    if n in ['spine01','spine02'] or n.startswith(('clavicle','shoulder','breast')):return 'Chest'
    if n.startswith('spine'):return 'Spine'
    if n=='root' or n.startswith('pelvis'):return 'Hips'
    return 'Head'
faces=[f for f in faces if sum(verts[i].y for i in f)/len(f)>-7.38]
used=sorted(set(i for f in faces for i in f)); idx={old:i for i,old in enumerate(used)}
me=bpy.data.meshes.new('Human continuous topology');me.from_pydata([coord(verts[i]) for i in used],[],[[idx[i] for i in f] for f in faces]);me.update()
body=bpy.data.objects.new('CeramicBody',me);bpy.context.collection.objects.link(body)
combined={i:{} for i in used}
for n,entries in weights.items():
    target=mapped(n)
    for i,w in entries:
        if i in combined: combined[i][target]=combined[i].get(target,0)+w
for n in points: body.vertex_groups.new(name=n)
for old,data in combined.items():
    total=sum(data.values()) or 1
    for n,w in data.items():body.vertex_groups[n].add([idx[old]],w/total,'REPLACE')
def armature(points):
    data=bpy.data.armatures.new('Atelier skeleton');obj=bpy.data.objects.new('AtelierRig',data);bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active=obj;obj.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
    for n,p in points.items():
        b=data.edit_bones.new(n);b.head=p;b.tail=p+Vector((0,0,.15))
    for n,parent in parents.items():
        if parent:data.edit_bones[n].parent=data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT');return obj
arm=armature(points)
mod=body.modifiers.new('Skin','ARMATURE');mod.object=arm
garments=[]
for name,source in [('Shirt','helper-tights'),('Jacket','helper-tights'),('Trousers','helper-tights'),('Dress','helper-skirt')]:
    ff=[]
    for f in helpers[source]:
        center=sum((verts[i] for i in f),Vector())/len(f)
        if name=='Shirt' and not (center.y>1.15 and (abs(center.x)<2.2 or center.y>4.2)):continue
        if name=='Jacket' and not center.y>.1:continue
        if name=='Trousers' and not -6.7<center.y<1.65:continue
        if name=='Dress' and center.y < -4.1:continue
        ff.append(f)
    # The dress bodice uses the same fitted shoulder pattern as the shirt.
    if name=='Dress':
        ff += [f for f in helpers['helper-tights'] if (lambda c:c.y>1.45 and (abs(c.x)<1.65 or c.y>5.1))(sum((verts[i] for i in f),Vector())/len(f))]
    indices=sorted(set(i for f in ff for i in f)); remap={old:i for i,old in enumerate(indices)}
    gm=bpy.data.meshes.new(name+' pattern');gm.from_pydata([coord(verts[i]) for i in indices],[],[[remap[i] for i in f] for f in ff]);gm.update()
    go=bpy.data.objects.new(name,gm);bpy.context.collection.objects.link(go)
    gw={i:{} for i in indices}
    for n,entries in weights.items():
        target=mapped(n)
        for i,w in entries:
            if i in gw:gw[i][target]=gw[i].get(target,0)+w
    for n in points:go.vertex_groups.new(name=n)
    for old,data in gw.items():
        total=sum(data.values()) or 1
        for n,w in data.items():go.vertex_groups[n].add([remap[old]],w/total,'REPLACE')
    gm=go.modifiers.new('SourceSkin','ARMATURE');gm.object=arm
    garments.append(go)
# Reduce the source A-pose to a comfortable fashion stance. The transformation
# acts on the source continuous mesh through the official anatomical weights.
for s,sgn in [('L',1),('R',-1)]:
    for n,child,direction in [('UpperArm','ForeArm',Vector((sgn*.11,0,-1))),('ForeArm','Hand',Vector((sgn*.035,-.06,-1))),('Thigh','Shin',Vector((sgn*.025,0,-1))),('Shin','Foot',Vector((sgn*.025,0,-1)))]:
        b=arm.pose.bones[n+'.'+s]; c=arm.pose.bones[child+'.'+s]
        bpy.context.view_layer.update()
        current=(c.head-b.head).normalized();q=current.rotation_difference(direction.normalized())
        m=b.matrix.copy();m=Matrix.Translation(b.head)@q.to_matrix().to_4x4()@Matrix.Translation(-b.head)@m;b.matrix=m
        bpy.context.view_layer.update()
bpy.context.view_layer.update()
newpoints={n:arm.pose.bones[n].head.copy() for n in points}
bpy.context.view_layer.objects.active=body;bpy.ops.object.modifier_apply(modifier=mod.name)
for go in garments:
    bpy.context.view_layer.objects.active=go;bpy.ops.object.modifier_apply(modifier='SourceSkin')
bpy.data.objects.remove(arm,do_unlink=True)
arm=armature(newpoints);mod=body.modifiers.new('Skin','ARMATURE');mod.object=arm
for p in body.data.polygons:p.use_smooth=True
# An opaque garment is always present in runtime. No nude mode is exposed.
def material(name,color,roughness=.6,metallic=0):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=roughness;bs.inputs['Metallic'].default_value=metallic
    return m
body.data.materials.append(material('Porcelain',(0.57,.52,.44),.33))
for go in garments:
    for poly in go.data.polygons:poly.use_smooth=True
    # Give each garment visible ease rather than painting directly onto skin.
    for v in go.data.vertices:
        p=v.co
        if go.name in ['Shirt','Jacket','Dress']:
            if abs(p.x)<.32 and 1.85<p.z<2.6:
                p.x*=1.11;p.y=(p.y+.10)*1.10-.10
            p+=v.normal*(.017 if go.name!='Jacket' else .028)
        else:
            p+=v.normal*.018
    bm=bmesh.new();bm.from_mesh(go.data)
    for v in bm.verts:
        if not v.is_boundary:continue
        p=v.co
        if go.name in ['Shirt','Jacket','Dress']:
            if p.z>2.76:p.z=2.79
            if go.name=='Shirt':
                if p.z<2.1:p.z=1.90
                elif abs(p.x)>.30 and p.z<2.65:p.z=2.33
            elif go.name=='Jacket':
                if abs(p.x)<.36 and p.z<1.95:p.z=1.73
                elif abs(p.x)>.36 and p.z<2.1:p.z=1.86
            elif go.name=='Dress':
                if p.z<1.3:p.z=.92
                elif 1.7<p.z<2.2:p.z=2.0
                elif abs(p.x)>.28 and 2.2<p.z<2.7:p.z=2.60
        elif go.name=='Trousers' and p.z<.5:p.z=.28
    if go.name=='Dress':
        waist_edges=[e for e in bm.edges if e.is_boundary and all(abs(v.co.z-2.0)<.001 for v in e.verts)]
        if waist_edges:bmesh.ops.bridge_loops(bm,edges=waist_edges)
        waist_verts=[v for v in bm.verts if 1.87<v.co.z<2.12]
        for _ in range(3):bmesh.ops.smooth_vert(bm,verts=waist_verts,factor=.35,use_axis_x=True,use_axis_y=True,use_axis_z=True)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(go.data);bm.free()
    uv=go.data.uv_layers.new(name='Cloth weave')
    for poly in go.data.polygons:
        for li in poly.loop_indices:
            p=go.data.vertices[go.data.loops[li].vertex_index].co
            uv.data[li].uv=(p.x*2,p.z*2)
    sm=go.modifiers.new('Tailored smooth surface','SUBSURF');sm.levels=1
    so=go.modifiers.new('Cloth edge thickness','SOLIDIFY');so.thickness=.009;so.offset=0
    skin=go.modifiers.new('Skin','ARMATURE');skin.object=arm
    go.parent=arm
    go.data.materials.append(material('Trouser wool' if go.name=='Trousers' else 'Fabric',(.09,.1,.11) if go.name=='Trousers' else (.34,.42,.32),.84))
body.parent=arm
# The matte sculptural head deliberately retains the continuous anatomical
# silhouette without adding fake pupils, mouth primitives or a photo mask.
sub=body.modifiers.new('Anatomical surface','SUBSURF');sub.levels=1
bpy.context.view_layer.objects.active=body;bpy.ops.object.modifier_move_up(modifier=sub.name)
# Save the neutral source used by garment generation and QA.
data={'joints':{n:[p.x,p.z,-p.y] for n,p in newpoints.items()},'profiles':[]}
for y in [1.5,1.65,1.8,1.95,2.1,2.25,2.4,2.55,2.65,2.75,2.85,3.0,3.2]:
    ps=[v.co for v in body.data.vertices if abs(v.co.z-y)<.03 and abs(v.co.x)<.36]
    if ps:data['profiles'].append([y,max(abs(p.x) for p in ps),min(p.y for p in ps),max(p.y for p in ps)])
json.dump(data,open(os.path.join(P,'neutral-profile.json'),'w'),indent=2)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(P,'atelier-source.blend'))
bpy.ops.export_scene.gltf(filepath=OUTPUT,export_format='GLB',export_apply=True,export_animations=False)
print(json.dumps(data))
