// H171: real generated App/AUTH/STORE/DATA; standalone execution uses HTTP fixtures only.
// Exported journey performs UI actions and DOM observations, never business API calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {chromium} from 'playwright-core';

const sha=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const ARTIFACT='cf32a52c56c5cacadc536bc151993f2efc5bcebbd2608089cee0a0bc92139437';

/** Reusable with a caller-owned page and approved expected identities/credentials.
 * Caller owns transport, printer observation and artifact verification.
 * onStep receives only safe DOM observations; credentials are never returned.
 */
export async function runCoreJourney(page, expected, {onStep=async()=>{},relogin=false}={}) {
  const steps=[];
  const mark=async(name,details={})=>{const row={name,ok:true,...details};steps.push(row);await onStep(row,page);};
  const nav=async id=>{
    const target=page.getByTestId('nav-'+id);
    const menu=page.locator('button[aria-controls="balam-navigation"]');
    if(await menu.isVisible()&&await menu.getAttribute('aria-expanded')==='false')await menu.click();
    await target.click();
  };
  if(relogin){
    const menu=page.locator('button[aria-controls="balam-navigation"]');
    if(await menu.isVisible()&&await menu.getAttribute('aria-expanded')==='false')await menu.click();
    await page.getByTestId('auth-logout').click();
    await page.locator('input[type="email"]').waitFor({state:'visible'});
    await mark('logout',{contract:'auth-logout UI; terminal-local Auth signout'});
  }
  try {
    await page.locator('input[type="email"]').fill(expected.login.email);
    await page.locator('input[type="password"]').fill(expected.login.password);
    // Existing functional keyboard contract; suppress Playwright fill call logs on failure.
    await page.locator('input[type="password"]').press('Enter');
    await page.getByTestId('nav-pos').waitFor({state:'attached'});
    await nav('pos');
    await page.getByTestId('pos-barcode-input').waitFor();
  } catch { throw new Error('CORE_UI_LOGIN_FAILED'); }
  await mark('login', {contract:'email/password types + Enter; actual AUTH and startup gates'});

  if(await page.getByTestId('pos-checkout-open').isVisible())assert.equal(await page.getByTestId('pos-checkout-open').isDisabled(),true);
  await page.getByTestId('pos-barcode-input').fill(expected.search);
  await page.getByTestId('pos-product-'+expected.commercialKey).waitFor();
  await page.getByTestId('pos-product-'+expected.commercialKey).click();
  await page.getByTestId('family-size-pick-'+expected.sizeGroupKey).click();
  await page.getByTestId('pos-family-variant-picker').waitFor();
  const variant=page.getByTestId('family-variant-pick-'+expected.productId);
  assert.match(await variant.textContent(),new RegExp(String(expected.unitPrice)));
  await variant.click();
  const openCart=page.getByTestId('pos-cart-open');
  if(await openCart.isVisible())await openCart.click();
  const line=page.getByTestId('ticket-line-'+expected.productId);
  await line.waitFor();
  assert.match(await line.textContent(),new RegExp(expected.sizeCode));
  assert.match(await page.getByTestId('ticket-line-sku-'+expected.productId).textContent(),new RegExp(expected.sku.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.equal(await page.locator('[data-testid^="ticket-line-"]:not([data-testid^="ticket-line-sku-"])').count(),1);
  await mark('search-size-variant-cart', {productId:expected.productId,sku:expected.sku,size:expected.sizeCode,lines:1});

  await page.getByTestId('pos-checkout-open').click();
  await page.getByTestId('checkout-method-Efectivo').click();
  assert.equal(await page.getByTestId('checkout-confirmar').isDisabled(),true);
  await page.getByTestId('checkout-recibido').fill(String(expected.unitPrice-1));
  assert.equal(await page.getByTestId('checkout-confirmar').isDisabled(),true);
  await page.getByTestId('checkout-recibido').fill(String(expected.unitPrice));
  assert.equal(await page.getByTestId('checkout-confirmar').isEnabled(),true);
  await mark('cash-validation', {emptyBlocked:true,insufficientBlocked:true,exactAmountEnabled:true,total:expected.unitPrice});
  await page.getByTestId('checkout-confirmar').click();
  assert.equal(await page.getByTestId('seller-pick-confirm').isDisabled(),true);
  await page.getByTestId('seller-pick-'+expected.sellerId).click();
  assert.equal(await page.getByTestId('seller-pick-confirm').isEnabled(),true);
  await page.getByTestId('seller-pick-confirm').click();
  await page.getByTestId('receipt-print').waitFor({timeout:30000});
  const ticket=page.locator('#balam-ticket[data-document-type="sale"]');
  await ticket.waitFor({state:'attached'});
  const folio=await ticket.getAttribute('data-document-id');
  assert.ok(folio);
  const ticketText=await ticket.textContent();
  assert.ok(ticketText.includes(expected.productName));
  assert.ok(ticketText.includes(expected.sku));
  assert.ok(ticketText.includes(String(expected.unitPrice)));
  await page.getByTestId('receipt-print').click();
  await mark('confirmed-sale-ticket', {folio,total:expected.unitPrice,productId:expected.productId,ticketTextSha256:sha(ticketText),hardware:'NOT_TESTED'});
  // Modal has an existing Escape contract; no new selector needed for Nueva venta.
  await page.keyboard.press('Escape');
  await page.getByTestId('receipt-print').waitFor({state:'detached'});

  const inspectStock=async(stage)=>{
    await nav('inventario');
    await page.getByTestId('inventory-product-'+expected.commercialKey).filter({visible:true}).click();
    const chip=page.getByTestId('product-detail-size-chip').filter({has:page.locator('[data-testid="product-detail-size-variants"]')});
    await chip.scrollIntoViewIfNeeded();
    const text=await chip.textContent();
    assert.ok(text.includes(expected.familyStockAfter+' pz'),text);
    // The stock row exposes the physical SKU as readable content; observation only.
    const variants=await page.getByTestId('product-detail-size-variants').textContent();
    const selected=await page.getByTestId('product-detail-size-variants').locator(':scope > div').evaluateAll((rows,sku)=>rows.filter(row=>row.textContent.includes(sku)).map(row=>row.textContent),expected.sku);
    assert.equal(selected.length,1);
    assert.ok(selected[0].includes(expected.stockAfter+' pz'),selected[0]);
    await mark(stage,{productId:expected.productId,stock:expected.stockAfter,familyStock:expected.familyStockAfter,visibleVariantsSha256:sha(variants)});
    await page.getByTestId('product-detail-close').click();
  };
  await inspectStock('stock-after-sale');
  await nav('reportes');
  await page.getByTestId('reports-tab-sales').click();
  const reportControl=page.getByTestId('sales-reprint-'+folio);
  await reportControl.waitFor();
  const reportText=await reportControl.locator('xpath=ancestor::tr').textContent();
  assert.ok(reportText.includes(String(expected.unitPrice)));
  await mark('sale-query',{folio,reportRowTextSha256:sha(reportText)});
  await page.reload({waitUntil:'load'});
  await page.getByTestId('nav-reportes').waitFor({state:'attached'});
  await nav('reportes');
  await page.getByTestId('reports-tab-sales').click();
  await page.getByTestId('sales-reprint-'+folio).waitFor();
  const refreshed=await page.getByTestId('sales-reprint-'+folio).locator('xpath=ancestor::tr').textContent();
  assert.equal(refreshed,reportText);
  await mark('refresh-sale-query',{folio,reportRowUnchanged:true});
  await inspectStock('refresh-stock');
  return {folio,steps};
}

async function runLocal() {
  const output=path.resolve(process.env.BALAM_CORE_JOURNEY_OUTPUT||'docs/fixes/evidence/h171/core-journey');
  await fs.mkdir(output,{recursive:true});
  const html=await fs.readFile(process.env.BALAM_VERIFIED_HTML||'index.html');
  const expectedArtifact=process.env.BALAM_CORE_JOURNEY_EXPECTED_SHA256||ARTIFACT;
  assert.match(expectedArtifact,/^[a-f0-9]{64}$/);
  assert.equal(sha(html),expectedArtifact,'Artifact must match the explicitly verified candidate SHA256');
  const relogin=process.env.BALAM_CORE_JOURNEY_RELOGIN==='1';
  const evidence={artifactSha256:sha(html),startedAt:new Date().toISOString(),scope:'Real App/AUTH/STORE/DATA UI, HTTP transport intercepted with coherent in-memory fixture. No remote Auth/RLS/SQL or financial certification.',steps:[],requests:[],unexpectedRequests:[],blockedWebSockets:[],pageErrors:[],consoleErrors:[],failedRequests:[],printHandoffs:[],externalRequestsAllowed:0,remoteWrites:0,sourceSha256:sha(await fs.readFile('qa-h171-core-journey.mjs'))};
  const server=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  let browser,page,snapshot,expected,authUser;
  const receipts=new Map();let revision=1,loginCount=0,logoutCount=0,committedSales=0;
  const fixtureLogin={email:'h171-core@example.invalid',password:'LocalFixtureOnly!171'};
  const now=()=>new Date().toISOString();
  try {
    browser=await chromium.launch(process.env.BALAM_CHROME_EXECUTABLE?{executablePath:process.env.BALAM_CHROME_EXECUTABLE,headless:true}:{channel:'chrome',headless:true});
    const context=await browser.newContext({viewport:{width:Number(process.env.BALAM_CORE_JOURNEY_WIDTH)||1280,height:900},serviceWorkers:'block'});
    assert.equal(typeof context.routeWebSocket,'function','WebSocket cage is required');
    await context.routeWebSocket('**',ws=>{const u=new URL(ws.url());evidence.blockedWebSockets.push(u.origin+u.pathname);ws.close({code:1000,reason:'H171 isolated fixture'});});
    await context.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin===base)return route.continue();
      if(url.origin!=='https://telohdbvbvsfmwyriflz.supabase.co'){evidence.unexpectedRequests.push({url:url.origin+url.pathname,method:req.method()});return route.abort();}
      const json=async value=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
      try {
        if(url.pathname==='/auth/v1/token'){
          const body=req.postDataJSON();assert.equal(body.email,fixtureLogin.email);assert.equal(body.password,fixtureLogin.password);loginCount++;
          const expires=Math.floor(Date.now()/1000)+3600;
          const token=Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:authUser.id,exp:expires,role:'authenticated'})).toString('base64url')+'.fixture';
          evidence.requests.push({name:'auth-password-login',transport:'INTERCEPTED'});
          return json({access_token:token,token_type:'bearer',expires_in:3600,expires_at:expires,refresh_token:'local-fixture-refresh',user:authUser});
        }
        if(url.pathname==='/auth/v1/user')return json(authUser);
        if(url.pathname==='/auth/v1/logout'){
          assert.equal(url.searchParams.get('scope'),'local');logoutCount++;
          evidence.requests.push({name:'auth-local-logout',transport:'INTERCEPTED'});return json({});
        }
        const name=url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/)?.[1];
        if(!name)throw Error('UNEXPECTED_HTTP_PATH:'+url.pathname);
        const args=req.postDataJSON()||{};
        evidence.requests.push({name,transport:'INTERCEPTED',requestId:args.p_request_id||null});
        if(name==='current_permission_snapshot')return json({model_version:'h56-screen-permissions-v1',permission_version:'1',verified_at:now(),profile_status:'active',profile:authUser.profile,base_role:'admin',permissions:args.p_screen_keys.map(screen_key=>({screen_key,allowed:true,source:'role',role_code:'admin'}))});
        if(name==='online_presence'||name==='online_connectivity')return json({ok:true});
        if(name==='online_adoption_report')return json({ok:true,revision:1,state:args.p_report.state});
        if(name==='online_snapshot_if_changed')return json({...clone(snapshot),serverTime:now(),snapshotRevision:String(revision),unchanged:false});
        if(name==='online_request_result')return json(receipts.has(args.p_request_id)?{found:true,receipt:receipts.get(args.p_request_id)}:{found:false});
        if(name==='execute_online_command'){
          const command=args.p_command;assert.equal(command.expectedActorId,authUser.id);
          if(receipts.has(args.p_request_id))return json(receipts.get(args.p_request_id));
          let result;
          if(command.type==='folio')result={folio:'H171-LOCAL-0001'};
          else if(command.type==='sale'){
            assert.equal(committedSales,0);assert.equal(command.items.length,1);assert.equal(command.items[0].product_id,expected.productId);assert.equal(command.items[0].qty,1);assert.equal(command.header.total,116);assert.equal(command.header.iva,16);assert.equal(command.header.subtotal,100);assert.equal(command.header.saldo,0);assert.equal(command.payments.length,1);assert.equal(command.payments[0].monto,116);
            const product=snapshot.products.find(p=>p.id===expected.productId);assert.equal(product.stock_quantity,expected.stockBefore);
            product.stock_quantity--;product.sync_version++;
            snapshot.sales.push({...command.header,stock_reserved:true});snapshot.saleItems.push(...command.items.map((row,index)=>({...row,id:index+1})));
            snapshot.payments.push(...command.payments.map(row=>{
              const marker='__BALAM_MONEY_V1__';
              const money=String(row.metodo||'').startsWith(marker)?JSON.parse(row.metodo.slice(marker.length)):null;
              return money?{...row,metodo:money.nominalMethod,components:money.components}:row;
            }));
            snapshot.movements.push(...command.moves.map((row,index)=>({...row,id:index+1})));
            for(const effect of command.sellerEffects||[]){
              const seller=snapshot.sellers.find(row=>row.id===effect.id);assert.ok(seller);
              seller.ventas_mes=effect.after_ventas_mes;seller.ventas_num=effect.after_ventas_num;seller.comision_acum=effect.after_comision_acum;seller.sync_version++;
              snapshot.commissionContext.sellerBases.find(row=>row.sellerId===effect.id).baseRaw+=command.header.comision_base==='bruto'?command.header.total:command.header.subtotal;
            }
            committedSales++;revision++;result={folio:command.folio,operationId:command.operationId};
            evidence.fixtureCommit={operationId:command.operationId,productId:command.items[0].product_id,quantity:1,total:116,subtotal:100,iva:16,payments:1,stockBefore:expected.stockBefore,stockAfter:product.stock_quantity,commandSha256:sha(JSON.stringify(command))};
          }else throw Error('UNEXPECTED_FIXTURE_COMMAND:'+command.type);
          const receipt={ok:true,status:'confirmed',result};receipts.set(args.p_request_id,receipt);return json(receipt);
        }
        throw Error('UNEXPECTED_FIXTURE_RPC:'+name);
      }catch(error){evidence.unexpectedRequests.push({path:url.pathname,error:error.message});return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({code:'FIXTURE_REJECTED',message:error.message})});}
    });
    page=await context.newPage();page.setDefaultTimeout(15000);
    page.on('pageerror',error=>evidence.pageErrors.push(error.message));
    page.on('console',msg=>{if(msg.type()==='error')evidence.consoleErrors.push(msg.text());});
    page.on('requestfailed',req=>evidence.failedRequests.push({url:req.url(),error:req.failure()?.errorText}));
    await page.goto(base,{waitUntil:'load'});
    await page.waitForFunction(()=>window.AUTH?.isReady()&&window.DATA&&window.CONFIG);
    const seed=await page.evaluate(()=>{
      // Seed construction only, before login. No commercial projection is installed here.
      const C=CONFIG,prior=C.snapshot(),config=C.prepareMutation('reset',[]).state;
      C.load(config);
      const family='17110000-0000-4000-8000-000000000099';
      const products=['BL','BE'].map((color,index)=>DATA.createReference({id:'17110000-0000-4000-8000-00000000000'+(index+1),referenceFamilyId:family,nombre:'Guayabera Jornada H171',modelo:'J171',cat:'21',manga:'ML',tela:'ALG',color,cuello:'NOR',orn:'—',ornamentColorCodes:[],precio:116,costo:40,stockQuantity:index?2:3,sizeCode:'40',sizeScale:'N',sizeCategoryId:'size_number',attrs:{__sizeCategoryId:'size_number'}},[]));
      C.load(prior);
      return {products,config,family};
    });
    const sellerId='17110000-0000-4000-8000-000000000003',actorId='17110000-0000-4000-8000-000000000004';
    expected={login:fixtureLogin,search:'J171',productName:seed.products[0].nombre,commercialKey:'family:'+seed.family,sizeGroupKey:'size_number::N::40',sizeCode:'40',productId:seed.products[0].id,sku:seed.products[0].sku,sellerId,unitPrice:116,stockBefore:3,stockAfter:2,familyStockAfter:4};
    authUser={id:actorId,aud:'authenticated',role:'authenticated',email:fixtureLogin.email,email_confirmed_at:now(),created_at:now(),app_metadata:{provider:'email',providers:['email']},user_metadata:{},profile:{id:actorId,nombre:'Administrador fixture H171',role:'admin',active:true}};
    const keys=['products','clients','sellers','promotions','sales','saleItems','payments','returns','returnItems','exchanges','exchangeItems','loans','movements','liquidations','commissionAdjustments','lookup','settings'];
    snapshot={contractVersion:1,snapshotRevision:'1',unchanged:false,configVersion:1,serverTime:now(),commercialQuote:{configVersion:1,promotionsFingerprint:'h171-fixture',sellersFingerprint:'h171-fixture'},commissionContext:{periodStart:'',sellerBases:[]},...Object.fromEntries(keys.map(k=>[k,[]]))};
    snapshot.products=seed.products.map(p=>({id:p.id,reference_family_id:p.referenceFamilyId,record_model:'v2',cat:p.cat,manga:p.manga,tela:p.tela,color:p.color,cuello:p.cuello,modelo:p.modelo,nombre:p.nombre,orn:p.orn,ornament_color_codes:[],precio:p.precio,costo:p.costo,stock:[],stock_quantity:p.stockQuantity,size_code:p.sizeCode,size_scale:p.sizeScale,size_category_id:p.sizeCategoryId,barcode_code:p.barcodeCode,barcode_contract:3,physical_signature:p.physicalSignature,sku:p.sku,attrs:p.attrs,sync_version:1}));
    snapshot.clients=[{id:'c7',nombre:'Público en general',generic:true,compras:0,total:0,sync_version:1}];
    snapshot.sellers=[{id:sellerId,nombre:'Vendedor Fixture',email:'seller-fixture@example.invalid',iniciales:'VF',color:'#334455',role:'vendedor',active:true,comision_pct:0,sync_version:1},{...authUser.profile,iniciales:'AF',color:'#445566',email:fixtureLogin.email,sync_version:1}];
    snapshot.commissionContext.sellerBases=[{sellerId,baseRaw:0},{sellerId:actorId,baseRaw:0}];
    snapshot.lookup=Object.entries(seed.config.catalogs).flatMap(([kind,rows])=>rows.map((r,sort_order)=>({kind,...r,sort_order})));
    snapshot.settings=Object.entries(seed.config.settings).map(([key,value])=>({key,value}));snapshot.settings.push({key:'_catalogMeta',value:seed.config.catalogMeta});
    const printHook=()=>{
      window.__h171Prints=[];const original=UI.receiptFrame;
      UI.receiptFrame=async(...args)=>{const frame=await original(...args);frame.contentWindow.print=()=>{window.__h171Prints.push({text:frame.contentDocument.body.textContent,html:frame.contentDocument.documentElement.outerHTML,documentId:frame.contentDocument.querySelector('[data-document-id]')?.dataset.documentId});frame.contentWindow.dispatchEvent(new Event('afterprint'));};return frame;};
    };
    await page.evaluate(printHook);
    if(relogin){
      try{
        await page.locator('input[type="email"]').fill(fixtureLogin.email);
        await page.locator('input[type="password"]').fill(fixtureLogin.password);
        await page.locator('input[type="password"]').press('Enter');
        await page.getByTestId('nav-pos').waitFor({state:'attached'});
      }catch{throw new Error('CORE_UI_INITIAL_LOGIN_FAILED');}
    }
    evidence.fixture={products:2,families:1,variantsSameSize:2,initialPieces:5,sellerEligible:true,initialSales:0,login:'synthetic credentials; not exported'};
    const journey=await runCoreJourney(page,expected,{relogin,onStep:async(row,p)=>{
      evidence.steps.push(row);
      await p.screenshot({path:path.join(output,String(evidence.steps.length).padStart(2,'0')+'-'+row.name+'.png'),fullPage:false});
      if(row.name==='confirmed-sale-ticket'){
        await p.waitForFunction(()=>window.__h171Prints.length===1);
        const printed=await p.evaluate(()=>window.__h171Prints[0]);assert.equal(printed.documentId,row.folio);assert.ok(printed.text.includes(expected.sku));
        await fs.writeFile(path.join(output,'receipt.html'),printed.html);
        evidence.printHandoffs.push({documentId:printed.documentId,htmlSha256:sha(printed.html),textSha256:sha(printed.text),physicalPrinterTested:false});
      }
      await fs.writeFile(path.join(output,'journey.json'),JSON.stringify(evidence,null,2)+'\n');
    }});
    assert.equal(loginCount,relogin?2:1);assert.equal(logoutCount,relogin?1:0);assert.equal(journey.steps.length,relogin?9:8);
    assert.equal(committedSales,1);assert.equal(receipts.size,2);assert.equal(snapshot.sales.length,1);assert.equal(snapshot.payments.length,1);
    evidence.storage=await page.evaluate(()=>({keys:Object.keys(localStorage),businessKeys:Object.keys(localStorage).filter(k=>/^balam_pos_|^balam_config|^balam_sync_queue|^balam_online_request_v1:/.test(k))}));
    assert.deepEqual(evidence.storage.businessKeys,[]);assert.deepEqual(evidence.unexpectedRequests,[]);assert.deepEqual(evidence.pageErrors,[]);assert.deepEqual(evidence.consoleErrors,[]);
    evidence.result={ok:true,steps:journey.steps.length,folio:journey.folio,loginCount,logoutCount,relogin,fixtureSales:committedSales,fixtureReceipts:receipts.size,refreshReconstructed:true,realSupabaseCertified:false};
  }catch(error){evidence.result={ok:false,error:error.message};process.exitCode=1;await page?.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});if(page){evidence.failureVisibleText=(await page.locator('body').innerText()).slice(-5000);evidence.observedToasts=await page.evaluate(()=>window.__h171ObservedToasts);evidence.diagnostics=await page.evaluate(()=>({calls:window.__h171Calls,status:STORE.syncStatus()}));}}
  finally{evidence.completedAt=new Date().toISOString();await fs.writeFile(path.join(output,'journey.json'),JSON.stringify(evidence,null,2)+'\n');await browser?.close();await new Promise(resolve=>server.close(resolve));console.log(JSON.stringify(evidence.result));}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await runLocal();
