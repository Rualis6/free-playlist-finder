import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";

const PORT = process.env.PORT || 3000;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36";
const NCM = "https://music.163.com";

const headers = {
  "User-Agent": UA,
  "Referer": NCM + "/",
  "Origin": NCM,
  "Accept": "application/json,text/plain,*/*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7"
};
const json = (res, code, body) => {
  res.writeHead(code, {"content-type":"application/json; charset=utf-8","access-control-allow-origin":"*"});
  res.end(JSON.stringify(body));
};
const normalize = s => (s||"").toLowerCase()
  .replace(/\([^)]*(live|remix|伴奏|翻唱|cover)[^)]*\)/gi," ")
  .replace(/\[[^\]]*(live|remix|伴奏|翻唱|cover)[^\]]*\]/gi," ")
  .replace(/[^\p{L}\p{N}]+/gu," ").trim();

function similarity(a,b){
  a=normalize(a); b=normalize(b); if(a===b) return 1;
  const A=new Set(a.split(" ").filter(Boolean)), B=new Set(b.split(" ").filter(Boolean));
  if(!A.size||!B.size) return 0;
  let n=0; for(const x of A) if(B.has(x)) n++;
  return 2*n/(A.size+B.size);
}
function artists(song){ return (song.ar||song.artists||[]).map(x=>x.name).join(" / "); }
function score(src,c){
  const title=similarity(src.name,c.name);
  const artist=similarity(artists(src),artists(c));
  const dur=Math.max(0,1-Math.abs((src.dt||src.duration||0)-(c.dt||c.duration||0))/12000);
  const bad=/\b(live|remix|cover|伴奏|翻唱|纯音乐)\b/i.test(c.name||"") &&
            !/\b(live|remix|cover|伴奏|翻唱|纯音乐)\b/i.test(src.name||"");
  return Math.max(0, .48*title+.38*artist+.14*dur-(bad?.28:0));
}
async function ncmRaw(endpoint, options={}){
  const r=await fetch(NCM+endpoint,{...options,headers:{...headers,...(options.headers||{})}});
  const text=await r.text();
  let data;
  try { data=JSON.parse(text); }
  catch { throw new Error(`网易云返回了非 JSON 内容 (HTTP ${r.status}): ${text.slice(0,180)}`); }
  return {httpStatus:r.status,data};
}
async function ncmGet(endpoint){
  const {httpStatus,data}=await ncmRaw(endpoint);
  if(httpStatus<200||httpStatus>=300) throw new Error(`网易云 HTTP ${httpStatus}`);
  return data;
}
async function ncmPost(endpoint, body){
  const {httpStatus,data}=await ncmRaw(endpoint,{
    method:"POST",
    headers:{"content-type":"application/x-www-form-urlencoded;charset=UTF-8"},
    body
  });
  if(httpStatus<200||httpStatus>=300) throw new Error(`网易云 HTTP ${httpStatus}`);
  return data;
}
function playlistId(input){
  const s=String(input).trim();
  if(/^\d+$/.test(s)) return s;
  try {
    const u=new URL(s);
    const id=u.searchParams.get("id");
    if(id && /^\d+$/.test(id)) return id;
  } catch {}
  const m=s.match(/(?:playlist(?:\/|\?[^#]*?id=))(\d+)/);
  return m?.[1] || null;
}
async function playlistDetail(id){
  const attempts=[];
  for(const attempt of [
    async()=>ncmGet(`/api/v6/playlist/detail?id=${id}&n=100000&s=0`),
    async()=>ncmPost("/api/v6/playlist/detail",`id=${id}&n=100000&s=0`)
  ]){
    try{
      const d=await attempt();
      attempts.push({code:d?.code,hasPlaylist:!!d?.playlist,trackCount:d?.playlist?.trackCount,trackIds:d?.playlist?.trackIds?.length});
      if(d?.code===200 && d?.playlist && Array.isArray(d.playlist.trackIds)) return {data:d,attempts};
    }catch(e){ attempts.push({error:e.message}); }
  }
  throw new Error(`读取歌单失败。网易云返回：${JSON.stringify(attempts)}`);
}
async function playlist(id){
  const {data:d,attempts}=await playlistDetail(id);
  const ids=(d.playlist.trackIds||[]).map(x=>x.id);
  if((d.playlist.trackCount||0)>0 && ids.length===0)
    throw new Error(`歌单显示有 ${d.playlist.trackCount} 首，但 trackIds 为空。诊断：${JSON.stringify(attempts)}`);
  const songs=[], privileges=[];
  for(let i=0;i<ids.length;i+=200){
    const batch=ids.slice(i,i+200);
    const c=encodeURIComponent(JSON.stringify(batch.map(id=>({id}))));
    const x=await ncmPost("/api/v3/song/detail",`c=${c}`);
    songs.push(...(x.songs||[])); privileges.push(...(x.privileges||[]));
  }
  const pm=new Map(privileges.map(p=>[p.id,p]));
  return {
    name:d.playlist.name||"Playlist",
    trackCount:d.playlist.trackCount||ids.length,
    attempts,
    songs:songs.map(s=>({...s, privilege:pm.get(s.id)}))
  };
}
function freePrivilege(p){
  if(!p) return false;
  return p.st>=0 && (p.pl||0)>0;
}
function baseChargeTypes(p){
  return (p?.chargeInfoList||[])
    .filter(x=>(x.rate||0)<=320000)
    .map(x=>x.chargeType)
    .filter(x=>Number.isFinite(x));
}
function catalogClass(songOrPriv){
  const p=songOrPriv?.privilege || songOrPriv;
  const songFee=songOrPriv?.fee;
  const privFee=p?.fee;

  // Strong signals when present.
  if(songFee===4 || privFee===4) return "purchase";
  if(songFee===1 || privFee===1) return "vip";
  if(songFee===8 || privFee===8) return "free_limited";

  // Overseas NetEase responses may flatten fee to 0 and mark st<0 for everything.
  // chargeInfoList often still preserves the base-tier charging pattern.
  const base=baseChargeTypes(p);
  if(base.length){
    if(base.every(x=>x===1)) return "vip_likely";
    if(base.some(x=>x===0)) return "free_catalog";
  }

  if(songFee===0 || privFee===0) return "free_unknown";
  return "unknown";
}
function isFreeCatalog(x){
  return ["free_catalog","free_limited"].includes(catalogClass(x));
}
function isVipCatalog(x){
  return ["vip","vip_likely"].includes(catalogClass(x));
}
function regionLimited(songs){
  if(!songs.length) return false;
  const neg=songs.filter(s=>(s.privilege?.st??0)<0).length;
  return neg/songs.length>=0.75;
}
async function searchNcm(q,limit=12){
  const body=`s=${encodeURIComponent(q)}&type=1&limit=${limit}&offset=0`;
  const x=await ncmPost("/api/cloudsearch/pc",body);
  return x.result?.songs||[];
}
async function details(ids){
  if(!ids.length) return [];
  const c=encodeURIComponent(JSON.stringify(ids.map(id=>({id}))));
  const x=await ncmPost("/api/v3/song/detail",`c=${c}`);
  const pm=new Map((x.privileges||[]).map(p=>[p.id,p]));
  return (x.songs||[]).map(s=>({...s, privilege:pm.get(s.id)}));
}
async function matchOne(s){
  const cls=catalogClass(s);

  if(freePrivilege(s.privilege))
    return {source:s,status:"already_free",match:s,score:1,catalogClass:cls};

  if(isFreeCatalog(s))
    return {source:s,status:"catalog_free_unverified",match:s,score:1,catalogClass:cls};

  // Only VIP-like or otherwise restricted songs need an alternate search.
  const found=await searchNcm(`${s.name} ${artists(s)}`);
  const ds=await details(found.map(x=>x.id));
  const scored=ds.filter(x=>x.id!==s.id)
    .map(x=>({
      song:x,
      score:score(s,x),
      catalogClass:catalogClass(x),
      playableHere:freePrivilege(x.privilege)
    }))
    .sort((a,b)=>b.score-a.score);

  const verified=scored.filter(x=>x.playableHere && x.score>=.78);
  if(verified[0])
    return {source:s,status:"matched",match:verified[0].song,score:verified[0].score,catalogClass:cls,candidates:scored.slice(0,5)};

  const catalogCandidate=scored.filter(x=>isFreeCatalog(x.song) && x.score>=.78)[0];
  if(catalogCandidate)
    return {source:s,status:"matched_unverified",match:catalogCandidate.song,score:catalogCandidate.score,catalogClass:cls,candidates:scored.slice(0,5)};

  return {source:s,status:"unmatched",match:null,score:scored[0]?.score||0,catalogClass:cls,candidates:scored.slice(0,5)};
}
async function api(req,res,u){
  if(u.pathname==="/api/playlist"){
    const id=playlistId(u.searchParams.get("url")||"");
    if(!id) return json(res,400,{error:"无法识别网易云歌单链接或 ID"});
    const p=await playlist(id);
    const stats={
      total:p.songs.length,
      playableHere:p.songs.filter(s=>freePrivilege(s.privilege)).length,
      catalogFree:p.songs.filter(s=>isFreeCatalog(s)).length,
      vip:p.songs.filter(s=>isVipCatalog(s)).length,
      purchase:p.songs.filter(s=>catalogClass(s)==="purchase").length,
      unknown:p.songs.filter(s=>["unknown","free_unknown"].includes(catalogClass(s))).length,
      serverUnavailable:p.songs.filter(s=>(s.privilege?.st??0)<0).length,
      regionLimited:regionLimited(p.songs)
    };
    return json(res,200,{id,...p,stats});
  }
  if(u.pathname==="/api/match" && req.method==="POST"){
    let raw=""; for await(const c of req) raw+=c;
    const {song}=JSON.parse(raw||"{}"); if(!song) return json(res,400,{error:"missing song"});
    return json(res,200,await matchOne(song));
  }
  json(res,404,{error:"not found"});
}
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8"};
http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,`http://${req.headers.host}`);
    if(u.pathname.startsWith("/api/")) return await api(req,res,u);
    let p=path.join(process.cwd(),"public",u.pathname==="/"?"/index.html":u.pathname);
    if(!p.startsWith(path.join(process.cwd(),"public"))) return json(res,403,{error:"forbidden"});
    fs.readFile(p,(e,b)=>{if(e){res.writeHead(404);res.end("Not found");}else{res.writeHead(200,{"content-type":mime[path.extname(p)]||"application/octet-stream"});res.end(b);}});
  }catch(e){json(res,500,{error:e.message});}
}).listen(PORT,()=>console.log(`Free Playlist Finder: http://localhost:${PORT}`));
