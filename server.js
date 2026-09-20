import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";

const PORT = process.env.PORT || 3000;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36";
const NCM = "https://music.163.com";

const headers = { "User-Agent": UA, "Referer": NCM + "/" };
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
async function ncmGet(endpoint){
  const r=await fetch(NCM+endpoint,{headers}); if(!r.ok) throw new Error("网易云请求失败 "+r.status);
  return r.json();
}
async function ncmPost(endpoint, body){
  const r=await fetch(NCM+endpoint,{method:"POST",headers:{...headers,"content-type":"application/x-www-form-urlencoded"},body});
  if(!r.ok) throw new Error("网易云请求失败 "+r.status); return r.json();
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
async function playlist(id){
  const d=await ncmGet(`/api/v6/playlist/detail?id=${id}`);
  const ids=(d.playlist?.trackIds||[]).map(x=>x.id);
  const songs=[], privileges=[];
  for(let i=0;i<ids.length;i+=200){
    const batch=ids.slice(i,i+200);
    const c=encodeURIComponent(JSON.stringify(batch.map(id=>({id}))));
    const x=await ncmPost("/api/v3/song/detail",`c=${c}`);
    songs.push(...(x.songs||[])); privileges.push(...(x.privileges||[]));
  }
  const pm=new Map(privileges.map(p=>[p.id,p]));
  return {name:d.playlist?.name||"Playlist", songs:songs.map(s=>({...s, privilege:pm.get(s.id)}))};
}
function freePrivilege(p){
  if(!p) return false;
  // fee=0 is normally free; st/maxbr help reject unavailable catalogue entries.
  return p.fee===0 && p.st>=0 && (p.maxbr??1)>0;
}
async function searchNcm(q,limit=12){
  const body=`s=${encodeURIComponent(q)}&type=1&limit=${limit}&offset=0`;
  const x=await ncmPost("/api/search/get/web",body);
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
  if(freePrivilege(s.privilege)) return {source:s, status:"already_free", match:s, score:1};
  const found=await searchNcm(`${s.name} ${artists(s)}`);
  const ds=await details(found.map(x=>x.id));
  const candidates=ds.filter(x=>freePrivilege(x.privilege) && x.id!==s.id)
    .map(x=>({song:x,score:score(s,x)})).sort((a,b)=>b.score-a.score);
  const best=candidates[0];
  return {source:s,status:best?.score>=.78?"matched":"unmatched",match:best?.score>=.78?best.song:null,
          score:best?.score||0,candidates:candidates.slice(0,3)};
}
async function api(req,res,u){
  if(u.pathname==="/api/playlist"){
    const id=playlistId(u.searchParams.get("url")||"");
    if(!id) return json(res,400,{error:"无法识别网易云歌单链接或 ID"});
    const p=await playlist(id);
    const stats={
      total:p.songs.length,
      free:p.songs.filter(s=>freePrivilege(s.privilege)).length,
      restricted:p.songs.filter(s=>!freePrivilege(s.privilege)).length
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
