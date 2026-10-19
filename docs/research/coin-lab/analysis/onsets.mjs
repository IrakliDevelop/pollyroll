import { execFileSync } from 'node:child_process';
import { fft } from './fft.mjs';
const SR = 48000;
export function decode(f) { const b = execFileSync('ffmpeg', ['-v','error','-i',f,'-ac','1','-ar',String(SR),'-f','f32le','-'], { maxBuffer: 1 << 28 }); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset+b.length)); }
function peaksAt(x, at, N=2048) { const re=new Float64Array(N), im=new Float64Array(N); for(let i=0;i<N;i++){const w=0.5-0.5*Math.cos(2*Math.PI*i/(N-1)); re[i]=(x[at+i]??0)*w;} fft(re,im); const m=[]; for(let i=0;i<N/2;i++) m.push(Math.hypot(re[i],im[i])); const pk=[]; for(let i=4;i<N/2-2;i++) if(m[i]>m[i-1]&&m[i]>=m[i+1]&&m[i]>m[i-2]&&m[i]>m[i+2]) pk.push(i); pk.sort((a,b)=>m[b]-m[a]); return pk.slice(0,5).sort((a,b)=>a-b).map(i=>Math.round(i*SR/N)); }
if (process.argv[1].endsWith('onsets.mjs')) for (const f of process.argv.slice(2)) {
  const x = decode(f); let peak=0; for (const v of x) peak=Math.max(peak,Math.abs(v));
  const W=48; const e=[]; for(let i=0;i+W<x.length;i+=W){let s=0;for(let k=0;k<W;k++)s+=x[i+k]**2; e.push(Math.sqrt(s/W));}
  const out=[]; let last=-99;
  for(let i=3;i<e.length;i++){ const prev=Math.max(e[i-1],e[i-2],e[i-3]); if(e[i]>2.2*prev && e[i]>0.04*peak && i-last>8){ out.push(i); last=i; } }
  console.log(f.split('/').pop(), 'peak', peak.toFixed(2));
  for (const i of out) { const at=i*W; let p=0; for(let k=at;k<Math.min(x.length,at+960);k++) p=Math.max(p,Math.abs(x[k])); // decay: time to drop -20dB of local max env
    let j=i; const top=Math.max(...e.slice(i,i+4)); while(j<e.length && e[j]>top*0.1) j++;
    console.log(`  ${(at/SR*1000).toFixed(1)}ms  ${(20*Math.log10(p/peak)).toFixed(0)}dB  -20dB after ${(j-i)}ms  peaks ${peaksAt(x,at).join(',')}`); }
}
