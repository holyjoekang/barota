// Vercel Node.js serverless function. Keys are read only from environment variables.
const ALLOWED_STATIONS = new Set(['잠실나루','강남','판교']);
const ALLOWED_LINES = new Set(['2호선','신분당선']);
const cache = new Map();
const ttl = 20000;
async function cached(url){const old=cache.get(url);if(old&&Date.now()-old.at<ttl)return old.data;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);try{const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw Error('상위 API HTTP '+response.status);const data=await response.json();cache.set(url,{at:Date.now(),data});return data;}finally{clearTimeout(timer);}}
function subwayDirection(row,station,line,direction){const train=String(row.trainLineNm||'');const dest=String(row.bstatnNm||'');const updn=String(row.updnLine||'');const lineName=String(row.subwayId||'');if(line==='2호선' && lineName && lineName!=='1002')return false;
 if(line==='신분당선' && lineName && !['1077','1092'].includes(lineName) && !train.includes('신분당'))return false;
 if(line==='2호선'&&station==='잠실나루')return /내선|강남|교대|잠실|성수/.test(train+' '+updn) && !/외선/.test(train);
 if(line==='2호선'&&station==='강남')return /외선|잠실|종합운동장|삼성|성수/.test(train+' '+updn) && !/내선/.test(train);
 if(line==='신분당선')return direction.includes('광교')?/광교|정자|판교|수원/.test(train+' '+dest):/신사|강남/.test(train+' '+dest);
 return true;
}
function parseSubway(data,station,line,direction){const rows=data.realtimeArrivalList||[];if(!Array.isArray(rows))return [];return rows.filter(r=>subwayDirection(r,station,line,direction)).map(r=>{const seconds=Number(r.barvlDt);return {type:'subway',name:line+' '+station+'역',destination:String(r.trainLineNm||r.bstatnNm||direction),minutes:Number.isFinite(seconds)&&seconds>=0?seconds/60:null,message:String(r.arvlMsg2||'도착정보 확인 필요'),receivedAt:r.recptnDt||null};}).sort((a,b)=>(a.minutes??Infinity)-(b.minutes??Infinity)).slice(0,5);}
function parseBus(data){const body=data.response?.body;const raw=body?.items?.item||[];return (Array.isArray(raw)?raw:[raw]).filter(Boolean).map(x=>({type:'bus',name:'버스 '+String(x.routeno||x.routeNo||''),destination:String(x.nodenm||x.nodeNm||''),minutes:Number.isFinite(Number(x.arrtime))?Number(x.arrtime)/60:null,message:'정류소 도착 예정'})).slice(0,8);}
module.exports=async(req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Access-Control-Allow-Origin',process.env.ALLOWED_ORIGIN||'*');res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');if(req.method==='OPTIONS')return res.status(204).end();if(req.method!=='GET')return res.status(405).json({error:'GET only'});
 const station=String(req.query.station||'잠실나루'),line=String(req.query.line||'2호선'),direction=String(req.query.direction||'강남 방면');if(!ALLOWED_STATIONS.has(station)||!ALLOWED_LINES.has(line))return res.status(400).json({error:'Unsupported station/line'});
 const items=[],warnings=[];const key=process.env.SEOUL_SUBWAY_KEY;
 if(key){try{const url=`http://swopenapi.seoul.go.kr/api/subway/${encodeURIComponent(key)}/json/realtimeStationArrival/0/50/${encodeURIComponent(station)}`;const data=await cached(url);if(data.errorMessage&&data.errorMessage.status!==200)throw Error(data.errorMessage.message||'API 오류');items.push(...parseSubway(data,station,line,direction));if(!items.some(x=>x.type==='subway'))warnings.push('해당 방향 지하철 정보 없음');}catch(e){warnings.push('지하철 조회 실패: '+e.message);}}else warnings.push('SEOUL_SUBWAY_KEY 미설정');
 const city=String(req.query.cityCode||''),node=String(req.query.nodeId||'');if(city&&node){if(!/^\d{1,5}$/.test(city)||!/^[-_a-zA-Z0-9]{1,40}$/.test(node))return res.status(400).json({error:'Invalid bus stop'});if(process.env.TAGO_SERVICE_KEY){try{const url=new URL('https://apis.data.go.kr/1613000/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList');url.searchParams.set('serviceKey',process.env.TAGO_SERVICE_KEY);url.searchParams.set('cityCode',city);url.searchParams.set('nodeId',node);url.searchParams.set('_type','json');url.searchParams.set('numOfRows','20');const data=await cached(url.toString());items.push(...parseBus(data));}catch(e){warnings.push('버스 조회 실패: '+e.message);}}else warnings.push('TAGO_SERVICE_KEY 미설정');}
 return res.status(200).json({items,warnings,updatedAt:new Date().toISOString(),source:'서울시 실시간 지하철 / 국토교통부 TAGO'});
};
