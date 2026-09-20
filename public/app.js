const $=s=>document.querySelector(s); let results=[], playlistName="", playlistMeta=null;
const artist=s=>(s.ar||s.artists||[]).map(x=>x.name).join(" / ");
const clean=s=>({id:s.id,name:s.name,dt:s.dt||s.duration,ar:s.ar||s.artists,privilege:s.privilege});
function render(r,i){
 const src=r.source, dst=r.match;
 const labels={
  already_free:"本服务器可免费播放",
  region_unverified:"目录显示免费 · 地区待验证",
  matched:`已找到免费替代 · ${Math.round((r.score||0)*100)}%`,
  matched_unverified:`找到免费候选 · 待大陆验证 · ${Math.round((r.score||0)*100)}%`,
  unmatched:"未找到可靠替代"
 };
 const showMatch=(r.status==="matched"||r.status==="matched_unverified")&&dst&&dst.id!==src.id;
 return `<article class="song ${r.status}"><div><b>${src.name}</b><div class="meta">${artist(src)}</div>
 ${showMatch?`<div class="arrow">↓ 候选免费版本</div><b>${dst.name}</b><div class="meta">${artist(dst)} · ID ${dst.id}</div>`:""}</div>
 <span class="status ${r.status}">${labels[r.status]||r.status}</span></article>`;
}
$("#go").onclick=async()=>{
 const btn=$("#go"); btn.disabled=true; btn.textContent="读取中…"; results=[]; $("#songs").innerHTML="";
 try{
  const p=await fetch("/api/playlist?url="+encodeURIComponent($("#url").value)).then(r=>r.json());
  if(p.error) throw Error(p.error); playlistName=p.name; playlistMeta={id:p.id,name:p.name,stats:p.stats};
  $("#summary").classList.remove("hidden");
  const warn=p.stats?.regionLimited?`<div class="meta"><b>⚠ 当前 Render 节点疑似受地区限制。</b> 本轮只验证目录级免费/VIP和匹配候选；“大陆可播”需在大陆节点复核。</div>`:"";
  $("#summary").innerHTML=`<b>${p.name}</b><div class="meta">${p.songs.length} 首 · 目录免费 ${p.stats?.catalogFree??"?"} · VIP ${p.stats?.vip??"?"} · 当前服务器可播 ${p.stats?.playableHere??"?"}</div>${warn}<div class="meta">正在逐首检查…</div>`;
  for(let i=0;i<p.songs.length;i++){
   $("#summary").innerHTML=`<b>${p.name}</b><div class="meta">正在检查 ${i+1}/${p.songs.length}</div>`;
   let r=await fetch("/api/match",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({song:clean(p.songs[i])})}).then(x=>x.json());
   results.push(r); $("#songs").insertAdjacentHTML("beforeend",render(r,i));
  }
  const n=results.filter(x=>x.status==="matched").length;
  const u=results.filter(x=>x.status==="matched_unverified").length;
  const f=results.filter(x=>x.status==="already_free"||x.status==="region_unverified").length;
  const miss=results.filter(x=>x.status==="unmatched").length;
  const warn=p.stats?.regionLimited?`<div class="meta"><b>⚠ Render 新加坡节点存在地区限制。</b> “待大陆验证”不代表最终可播结论。</div>`:"";
  $("#summary").innerHTML=`<b>${p.name}</b><div class="meta">${p.songs.length} 首 · ${f} 首目录免费/已免费 · ${n} 首验证替代 · ${u} 首免费候选待验证 · ${miss} 首未匹配</div>${warn}`;
  $("#actions").classList.remove("hidden");
 }catch(e){
  $("#summary").classList.remove("hidden");
  $("#summary").innerHTML=`<b>读取失败</b><div class="meta" style="white-space:pre-wrap">${String(e.message)}</div>`;
} finally{btn.disabled=false;btn.textContent="分析歌单";}
};
function finalSongs(){return results.map(r=>r.match||r.source)}
$("#copy").onclick=async()=>{await navigator.clipboard.writeText(finalSongs().map(s=>`${s.name} — ${artist(s)}`).join("\n"));$("#copy").textContent="已复制 ✓";setTimeout(()=>$("#copy").textContent="复制免费版歌曲清单",1400)};
$("#csv").onclick=()=>{let rows=[["title","artist","netease_id","result"],...results.map(r=>{let s=r.match||r.source;return[s.name,artist(s),s.id,r.status]})];let csv=rows.map(x=>x.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");let a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv"}));a.download=(playlistName||"playlist")+"-free.csv";a.click()};

$("#diag").onclick=()=>{
 const report={
   generatedAt:new Date().toISOString(),
   appVersion:"0.4",
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
