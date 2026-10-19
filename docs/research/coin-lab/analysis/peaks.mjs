import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fft } from './fft.mjs';
const SR = 48000, N = 4096;
function decode(f) { const b = execFileSync('ffmpeg', ['-v','error','-i',f,'-ac','1','-ar',String(SR),'-f','f32le','-']); return new Float32Array(b.buffer, b.byteOffset, b.length/4); }
function spec(x, at) { const re = new Float64Array(N), im = new Float64Array(N); for (let i=0;i<N;i++){ const w=0.5-0.5*Math.cos(2*Math.PI*i/(N-1)); re[i]=(x[at+i]??0)*w; } fft(re,im); const m=new Float64Array(N/2); for(let i=0;i<N/2;i++) m[i]=Math.hypot(re[i],im[i]); return m; }
for (const f of process.argv.slice(2)) {
  const x = decode(f); let peak=0; for (const v of x) peak=Math.max(peak,Math.abs(v));
  let on=0; while (Math.abs(x[on])<0.2*peak) on++;
  // envelope decay: rms 10ms windows
  const rms=[]; for(let i=on;i+480<x.length;i+=480){let s=0;for(let k=0;k<480;k++)s+=x[i+k]**2;rms.push(Math.sqrt(s/480));}
  const db=rms.map(r=>20*Math.log10(r/rms[0]+1e-9)); const t20=db.findIndex(d=>d<-20)*10, t40=db.findIndex(d=>d<-40)*10;
  // onsets: count rms jumps > 6dB
  let hits=0; for(let i=1;i<rms.length;i++) if(rms[i]>rms[i-1]*2 && rms[i]>0.05*rms[0]) hits++;
  const a=spec(x,on), b=spec(x,on+Math.round(0.08*SR));
  const pk=[]; for(let i=3;i<N/2-3;i++){ if(a[i]>a[i-1]&&a[i]>=a[i+1]&&a[i]>a[i-2]&&a[i]>a[i+2]) pk.push(i);} pk.sort((p,q)=>a[q]-a[p]);
  const top=pk.slice(0,6).sort((p,q)=>p-q).map(i=>`${Math.round(i*SR/N)}Hz(${(20*Math.log10(b[i]/a[i]+1e-9)).toFixed(0)}dB@80ms)`);
  let c=0,s=0; for(let i=0;i<N/2;i++){c+=a[i]*i*SR/N;s+=a[i];}
  console.log(f.split('/').pop().padEnd(26), `len ${(x.length/SR).toFixed(2)}s t-20 ${t20}ms t-40 ${t40}ms hits ${hits} centroid ${Math.round(c/s)}Hz`, top.join(' '));
}
