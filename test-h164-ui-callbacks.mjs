// H164: actual client form handlers must expose the authoritative save Promise.
// One focused case; no build, browser, Supabase request, or commercial mutation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

const source=fs.readFileSync('balam/clients.jsx','utf8');
assert.ok(source.includes('window.ClientsScreen = ClientsScreen;'));
const element=(type,props,...children)=>({type,props:props||{},children});
const window={DATA:{},HX:{},UI:{toast(){},fmt:value=>value},CONFIG:{codes:()=>[]}};
const context=vm.createContext({window,React:{createElement:element,useState:initial=>{
  const value=typeof initial==='function'?initial():initial;
  return [value&&typeof value==='object'&&value.nombre===''?{...value,nombre:'QA sin efectos'}:value,()=>{}];
},useMemo:fn=>fn(),useEffect(){},useRef:()=>({current:null})}});
vm.runInContext(source.replace('window.ClientsScreen = ClientsScreen;','window.__h164Forms = {ClientEditModal,NewClientForm}; window.ClientsScreen = ClientsScreen;'),context);
const nodes=tree=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...nodes(tree.children)];
let resolveSave,calls=0;
const authoritativePromise=new Promise(resolve=>{resolveSave=resolve;});
const onSave=()=>{calls++;return authoritativePromise;};
const edit=window.__h164Forms.ClientEditModal({c:{nombre:'QA existente'},onClose(){},onSave});
assert.equal(edit.props.footer[1].props.onClick(),authoritativePromise,'Edit must expose the existing authoritative promise');
const create=window.__h164Forms.NewClientForm({onCancel(){},onSave});
const save=nodes(create).find(node=>node.type==='button'&&node.children.flat().includes('Guardar cliente'));
assert.ok(save,'Actual new-client save button');assert.equal(save.props.onClick(),authoritativePromise,'Create must expose the existing authoritative promise');
assert.equal(calls,2);resolveSave({ok:true});await authoritativePromise;
const evidence={name:'Client create/edit callbacks return authoritative Promise',pass:true,sourceSha256:createHash('sha256').update(source).digest('hex'),remoteBusinessWrites:0};
fs.mkdirSync('.evidence-h164',{recursive:true});fs.writeFileSync('.evidence-h164/ui-callbacks.json',JSON.stringify(evidence,null,2));
console.log('PASS client create/edit callbacks return authoritative Promise\n1 PASS / 0 FAIL');
