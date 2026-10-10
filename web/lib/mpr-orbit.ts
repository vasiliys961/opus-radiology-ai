/** Pure camera rotations; no patient voxels or measurements are changed. */
export type Vec3 = [number,number,number];
export type CameraPose = { position: Vec3; focalPoint: Vec3; viewUp: Vec3 };
const dot = (a: Vec3,b:Vec3) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a:Vec3,b:Vec3):Vec3 => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=(v:Vec3):Vec3=> {const d=Math.hypot(...v);return d>1e-8?v.map(x=>x/d) as Vec3:[0,0,1]};
const rotate=(v:Vec3,axis:Vec3,rad:number):Vec3=>{
  const k=norm(axis),c=Math.cos(rad),s=Math.sin(rad),cv=cross(k,v),kv=dot(k,v);
  return v.map((x,i)=>x*c+cv[i]*s+k[i]*kv*(1-c)) as Vec3;
};
/** Yaw around camera up, pitch around camera right; retain focal point and radius. */
export function orbitCamera(camera:CameraPose,yawDegrees:number,pitchDegrees:number):CameraPose {
  if (![...camera.position,...camera.focalPoint,...camera.viewUp,yawDegrees,pitchDegrees].every(Number.isFinite)) return camera;
  const rel=camera.position.map((x,i)=>x-camera.focalPoint[i]) as Vec3;
  if(Math.hypot(...rel)<1e-8) return camera;
  const up=norm(camera.viewUp);
  let pos=rotate(rel,up,yawDegrees*Math.PI/180);
  const right=norm(cross(up,pos));
  pos=rotate(pos,right,pitchDegrees*Math.PI/180);
  const nextUp=norm(rotate(up,right,pitchDegrees*Math.PI/180));
  return {position:pos.map((x,i)=>x+camera.focalPoint[i]) as Vec3,focalPoint:[...camera.focalPoint],viewUp:nextUp};
}
