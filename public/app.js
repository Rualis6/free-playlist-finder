const $=s=>document.querySelector(s); let results=[], playlistName="", playlistMeta=null;
const artist=s=>(s.ar||s.artists||[]).map(x=>x.name).join(" / ");
const clean=s=>({id:s.id,name:s.name,dt:s.dt||s.duration,ar:s.ar||s.artists,privilege:s.privilege});
function render(r,i){
 const src=r.source, dst=r.match;
 const label=r.status==="already_free"?"本来就免费":r.status==="matched"?`已替换 · ${Math.round(r.score*100)}%`:"未找到可靠替代";
 return `<article class="song ${r.status}"><div><b>${src.name}</b><div class="meta">${artist(src)}</div>
 ${r.status==="matched"?`<div class="arrow">↓ 免费版本</div><b>${dst.name}</b><div class="meta">${artist(dst)} · ID ${dst.id}</div>`:""}</div>
 <span class="status ${r.status}">${label}</span></article>`;
}
$("#go").onclick=async()=>{
 const btn=$("#go"); btn.disabled=true; btn.textContent="读取中…"; results=[]; $("#songs").innerHTML="";
 try{
  const p=await fetch("/api/playlist?url="+encodeURIComponent($("#url").value)).then(r=>r.json());
  if(p.error) throw Error(p.error); playlistName=p.name; playlistMeta={id:p.id,name:p.name,stats:p.stats};
  $("#summary").classList.remove("hidden"); $("#summary").innerHTML=`<b>${p.name}</b><div class="meta">${p.songs.length} 首 · 正在逐首检查…</div>`;
  for(let i=0;i<p.songs.length;i++){
   $("#summary").innerHTML=`<b>${p.name}</b><div class="meta">正在检查 ${i+1}/${p.songs.length}</div>`;
   let r=await fetch("/api/match",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({song:clean(p.songs[i])})}).then(x=>x.json());
   results.push(r); $("#songs").insertAdjacentHTML("beforeend",render(r,i));
  }
  const n=results.filter(x=>x.status==="matched").length, f=results.filter(x=>x.status==="already_free").length;
  $("#summary").innerHTML=`<b>${p.name}</b><div class="meta">${p.songs.length} 首 · ${f} 首原本免费 · ${n} 首找到免费替代 · ${p.songs.length-f-n} 首未匹配</div>`;
  $("#actions").classList.remove("hidden");
 }catch(e){alert(e.message)} finally{btn.disabled=false;btn.textContent="分析歌单";}
};
function finalSongs(){return results.map(r=>r.match||r.source)}
$("#copy").onclick=async()=>{await navigator.clipboard.writeText(finalSongs().map(s=>`${s.name} — ${artist(s)}`).join("\n"));$("#copy").textContent="已复制 ✓";setTimeout(()=>$("#copy").textContent="复制免费版歌曲清单",1400)};
$("#csv").onclick=()=>{let rows=[["title","artist","netease_id","result"],...results.map(r=>{let s=r.match||r.source;return[s.name,artist(s),s.id,r.status]})];let csv=rows.map(x=>x.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");let a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv"}));a.download=(playlistName||"playlist")+"-free.csv";a.click()};

$("#diag").onclick=()=>{
 const report={
   generatedAt:new Date().toISOString(),
   appVersion:"0.2",
   playlist:playlistMeta,
   results:results.map(r=>({
     source:{id:r.source?.id,name:r.source?.name,artist:artist(r.source||{}),duration:r.source?.dt||r.source?.duration,privilege:r.source?.privilege},
     status:r.status,
     score:r.score,
     match:r.match?{id:r.match.id,name:r.match.name,artist:artist(r.match),duration:r.match.dt||r.match.duration,privilege:r.match.privilege}:null,
     candidates:(r.candidates||[]).map(c=>({score:c.score,id:c.song?.id,name:c.song?.name,artist:artist(c.song||{}),duration:c.song?.dt||c.song?.duration,privilege:c.song?.privilege}))
   }))
 };
 const a=document.createElement("a");
 a.href=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:"application/json"}));
 a.download=(playlistName||"playlist")+"-diagnostic.json"; a.click();
};
