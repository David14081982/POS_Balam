// H-102 · contrato rojo A–O de proyección comercial V2.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sources = Object.fromEntries(['data','inventory','pos','returns','loans','xlsx-io','heritage'].map(name => [name, read(`./balam/${name}.jsx`)]));
let pass=0,fail=0; const ok=(name,value)=>{console.log(`${value?'✅':'❌'} ${name}`);value?pass++:fail++;};
function runtime(){const mem=new Map();let n=0;const noop=()=>{};const localStorage={getItem:k=>mem.get(k)||null,setItem:(k,v)=>mem.set(k,String(v)),removeItem:k=>mem.delete(k)};const s={console,localStorage,Date,setTimeout,clearTimeout,JSON,Math,Object,Array,String,Number,Boolean,isNaN,parseInt,parseFloat,RegExp,Error,Set,Map,Promise,CustomEvent:class{}};s.window={localStorage,dispatchEvent:noop,addEventListener:noop,removeEventListener:noop,CORE:{catalogProducts:()=>[],saveCatalogProducts:noop,registerCatalogProducts:noop,registerSyncGateway:noop,invokeSync:noop,getDeviceId:()=> 'h102'},UI:{toast:noop},crypto:{randomUUID:()=>`${(++n).toString(16).padStart(8,'0')}-0000-4000-8000-000000000102`}};s.globalThis=s;vm.createContext(s);vm.runInContext(read('./balam/config.jsx'),s);vm.runInContext(sources.data,s);return s.window.DATA;}
const D=runtime(), familyId='10200000-0000-4000-8000-000000000102';
const base={referenceFamilyId:familyId,cat:'1',modelo:'VIC',nombre:'VICTOR',manga:'ML',tela:'ALG',color:'BL',cuello:'TRA',orn:'BEL',sizeCategoryId:'size_number',precio:1250,attrs:{producto:'VIC',corte:'-',caracteristicas:'66'}};
const specs=[['XS','L',10,1250,['AZL','DRO'],'size_letter'],['S','L',10,1250,['AZL','DRO'],'size_letter'],['38','N',10,50,['AZL','DRO']],['40','N',10,1250,['AZL','DRO']],['42','N',10,3000,['AZL','DRO']],['44','N',10,1250,['AZL','DRO']],['46','N',10,1250,['AZL','DRO']]];
const refs=[]; for(const [size,scale,stock,price,colors,category='size_number'] of specs) refs.push(D.createReference({...base,sizeCategoryId:category,sizeCode:size,sizeScale:scale,stockQuantity:stock,precio:price,ornamentColorCodes:colors},refs));
D.products.splice(0,D.products.length,...refs); const p=D.referenceFamilyProjection(familyId); const commercial=D.commercialProducts();
ok('A. Inventario recibe una entrada comercial',commercial.length===1&&commercial[0].isFamilyProjection);
ok('B. detalle dispone de las siete referencias',p?.references.length===7&&p.sizeGroups.length===7);
ok('C. total familiar = 70',p?.totalStock===70);
ok('D. precio familiar = 50–3000',p?.priceMin===50&&p.priceMax===3000&&p.hasMultiplePrices);
ok('E. SKU familiar no toma XS',p?.sku===null&&p.skuLabel==='Varios SKU');
ok('F. POS consume commercialProducts',/commercialProducts\(/.test(sources.pos));
ok('G. POS usa stock total familiar',/totalStock/.test(sources.pos)&&/isFamilyProjection/.test(sources.pos));
ok('H. selector familiar entrega referencia exacta',/onPick\(reference, reference\.sizeCode\)/.test(sources.heritage));
ok('I. venta conserva productId exacto',/productId:\s*p\.id/.test(sources.pos)&&/productId:\s*l\.p\.id/.test(sources.data));
ok('J. talla repetida conserva variantes',p?.sizeGroups.every(g=>g.references.length===1));
ok('K. Excel permanece una fila por referencia',/products\.map\(p\s*=>\s*rowFromProduct/.test(sources['xlsx-io']));
ok('L. etiquetas seleccionan referencias exactas',/label-reference-select|label-family-reference/.test(sources.inventory));
ok('M. Préstamos consume familia y termina en productId',/commercialProducts\(/.test(sources.loans)&&/productId:\s*p\.id/.test(sources.loans));
ok('N. Cambios consume familia y termina en productId',/commercialProducts\(/.test(sources.returns)&&/p\.id/.test(sources.returns));
ok('O. KPI cuenta proyecciones comerciales',/commercialProducts\(/.test(read('./balam/dashboard.jsx')));
console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`); process.exit(fail?1:0);
