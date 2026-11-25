import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
const root=new URL('./',import.meta.url),port=Number(process.argv[2] ?? 4305);
if(!Number.isInteger(port)||port<1||port>65535) throw Error('포트는 1~65535 범위입니다.');
const mime={'.html':'text/html','.css':'text/css','.mjs':'text/javascript'};
const server=createServer(async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
  const path=req.url.split('?')[0];
  if(path==='/r05-field'){res.writeHead(308,{Location:'/r05-field/'}).end();return;}
  const relative=path.replace(/^\/r05-field\//,'/').slice(1);
  const file=relative===''||relative==='index.html'?'index.html':relative==='built/'?'apps-script/Index.html':
    /^src\/[a-z-]+\.(mjs|css)$/.test(relative)?relative:null;
  if(!file){res.writeHead(404).end();return;}
  try {
    const bytes=await readFile(new URL(file,root));
    res.writeHead(200,{'Content-Type':mime[extname(file)]+'; charset=utf-8','Cache-Control':'no-store'}).end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(404).end();}
});
server.on('error',e=>{console.error(e.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log('R0.5  http://127.0.0.1:'+port+'/'));
