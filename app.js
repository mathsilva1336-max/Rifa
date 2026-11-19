/*
  CONFIGURAÇÃO: substitua os valores abaixo pelos dados do seu projeto Firebase.
  O firebaseConfig é público por natureza; a proteção real fica nas regras do Firestore.
*/
const firebaseConfig = {
  apiKey: "AIzaSyCDr_KynRN5dNy9bitJY1RO1nBbJzWrzSQ",
  authDomain: "rifa-288bf.firebaseapp.com",
  projectId: "rifa-288bf",
  appId: "1:745171313506:web:837f16eaf6e5d6e0d1423b"
};

// Deve ser exatamente o e-mail da conta administrativa criada no Firebase Authentication.
const ADMIN_EMAIL = "PREENCHER_COM_SEU_EMAIL_ADMINISTRATIVO";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, signInAnonymously, signInWithEmailAndPassword, signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, onSnapshot, writeBatch, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const grid = $("numbersGrid");
const dialog = $("numberDialog");
const selected = new Set();
let app, auth, db, currentUser = null, isAdmin = false, records = new Map(), unsubscribe = null;

function notice(message, type="") {
  const el = $("connectionNotice");
  el.textContent = message;
  el.className = "notice" + (type ? " " + type : "");
}
function formatNumber(n){ return String(n).padStart(3,"0"); }
function parseNumbers(value) {
  const parts = value.split(/[,\s;]+/).filter(Boolean);
  if (!parts.length) throw new Error("Informe pelo menos um número.");
  const nums = parts.map(p => {
    if (!/^\d{1,3}$/.test(p)) throw new Error(`Número inválido: ${p}`);
    const n = Number(p);
    if (n < 1 || n > 400) throw new Error("Os números precisam estar entre 001 e 400.");
    return n;
  });
  if (new Set(nums).size !== nums.length) throw new Error("Você repetiu um número.");
  return nums.sort((a,b)=>a-b);
}
function renderGrid() {
  const search = $("numberSearch").value.trim();
  const filter = $("statusFilter").value;
  grid.replaceChildren();
  for (let n=1;n<=400;n++) {
    const id = formatNumber(n), occupied = records.has(id);
    if (search && !id.includes(search)) continue;
    if (filter==="free" && occupied) continue;
    if (filter==="busy" && !occupied) continue;
    const btn = document.createElement("button");
    btn.type="button"; btn.className="number"+(occupied?" busy":"")+(selected.has(id)?" selected":"");
    btn.textContent=id; btn.setAttribute("aria-label",`Número ${id}, ${occupied?"ocupado":"disponível"}`);
    btn.addEventListener("click",()=>handleNumberClick(id));
    grid.append(btn);
  }
  const count=records.size;
  $("totalCount").textContent="400";
  $("occupiedCount").textContent=count;
  $("availableCount").textContent=400-count;
  updateSelectionSummary();
}
function updateSelectionSummary(){
  const nums=[...selected].sort().join(", ");
  $("selectionSummary").textContent=nums ? `Selecionados: ${nums}` : "Nenhum número selecionado.";
  $("chosenNumbers").value=nums;
}
function handleNumberClick(id) {
  const record=records.get(id);
  if(record){ showRecord(id,record); return; }
  if(selected.has(id)) selected.delete(id); else selected.add(id);
  renderGrid();
}
function showRecord(id,record) {
  $("dialogTitle").textContent=`Número ${id}`;
  const content=$("dialogContent"); content.replaceChildren();
  const p=document.createElement("p"); p.className="detail";
  const name=document.createElement("strong"); name.textContent=record.name || "Não informado";
  p.append("Participante: ",name,document.createElement("br"),"Telefone: ",record.phone || "Não informado",document.createElement("br"),"Situação: ",record.status || "Ocupado");
  content.append(p);
  const actions=$("dialogActions"); actions.replaceChildren();
  if(isAdmin){
    const del=document.createElement("button"); del.className="button danger"; del.textContent="Liberar número";
    del.addEventListener("click",async()=>{
      if(!confirm(`Liberar o número ${id}? Essa ação não pode ser desfeita.`)) return;
      try { await deleteDoc(doc(db,"reservas",id)); dialog.close(); notice(`Número ${id} liberado.`, "success"); }
      catch(e){ alert("Não foi possível liberar: "+friendlyError(e)); }
    });
    actions.append(del);
  }
  const close=document.createElement("button"); close.className="button button-outline"; close.textContent="Fechar"; close.addEventListener("click",()=>dialog.close());
  actions.append(close); dialog.showModal();
}
function friendlyError(e){
  if(e.code==="permission-denied") return "Permissão negada. Verifique se você entrou com a conta administrativa correta ou se as regras foram publicadas.";
  if(e.code==="auth/invalid-credential") return "E-mail ou senha administrativa incorretos.";
  if(e.code==="auth/operation-not-allowed") return "Ative o login anônimo e o login por e-mail/senha no Firebase Authentication.";
  if(e.code==="unavailable") return "Sem conexão com o Firebase. Confira a internet e tente novamente.";
  return e.message || "Erro desconhecido.";
}
async function reserve(event){
  event.preventDefault();
  const name=$("participantName").value.trim(), phone=$("participantPhone").value.trim();
  if(name.length<2 || phone.length<6){ alert("Informe nome e telefone válidos."); return; }
  let nums;
  try{ nums=parseNumbers($("chosenNumbers").value); }catch(e){ alert(e.message); return; }
  const already=nums.filter(n=>records.has(formatNumber(n)));
  if(already.length){ alert("Estes números já foram ocupados: "+already.join(", ")+". Atualize a seleção."); return; }
  $("reserveButton").disabled=true; $("reserveButton").textContent="Salvando…";
  try{
    // Um único batch: ou todos os números são gravados, ou nenhum é gravado.
    // As regras do Firestore também impedem sobrescrever números já existentes.
    const batch=writeBatch(db);
    const createdAt=new Date().toISOString();
    for(const n of nums){
      const id=formatNumber(n);
      batch.set(doc(db,"reservas",id),{
        number:id, name, phone, status:"Ocupado", createdAt
      });
    }
    await batch.commit();
    $("reservationForm").reset(); selected.clear(); renderGrid();
    notice(`${nums.length} número(s) cadastrado(s) com sucesso.`, "success");
  }catch(e){ alert("Não foi possível concluir o cadastro: "+friendlyError(e)); }
  finally{$("reserveButton").disabled=false;$("reserveButton").textContent="Confirmar cadastro e reserva";}
}
async function start(){
  try{
    if(firebaseConfig.apiKey.startsWith("COLE_") || !firebaseConfig.projectId || ADMIN_EMAIL.startsWith("COLOQUE_")){
      notice("Configuração pendente: siga o guia LEIA-ME para conectar seu Firebase.", "error");
      $("reserveButton").disabled=true; return;
    }
    app=initializeApp(firebaseConfig); auth=getAuth(app); db=getFirestore(app);
    onAuthStateChanged(auth, async user=>{
      if(!user){
        try{await signInAnonymously(auth);}catch(e){notice("Falha ao entrar: "+friendlyError(e),"error");}
        return;
      }
      currentUser=user;
      isAdmin=!user.isAnonymous && user.email?.toLowerCase()===ADMIN_EMAIL.toLowerCase();
      $("adminLoginForm").hidden=isAdmin;
      $("adminLogout").hidden=!isAdmin;
      $("adminStatus").textContent=isAdmin?"Acesso administrativo ativo. Você pode liberar números.":"Entre com a conta administrativa para liberar números.";
      if(unsubscribe) unsubscribe();
      unsubscribe=onSnapshot(collection(db,"reservas"),snap=>{
        records=new Map();
        snap.forEach(d=>records.set(d.id,d.data()));
        renderGrid();
        notice("Conectado. Atualizações em tempo real ativadas.", "success");
      },e=>notice("Erro ao carregar dados: "+friendlyError(e),"error"));
    });
  }catch(e){notice("Erro de inicialização: "+friendlyError(e),"error");}
}
$("reservationForm").addEventListener("submit",reserve);
$("numberSearch").addEventListener("input",renderGrid);
$("statusFilter").addEventListener("change",renderGrid);
$("adminToggle").addEventListener("click",()=>{
  $("adminPanel").hidden=!$("adminPanel").hidden;
  if(!$("adminPanel").hidden) $("adminPanel").scrollIntoView({behavior:"smooth",block:"start"});
});
$("adminLoginForm").addEventListener("submit",async e=>{
  e.preventDefault();
  try{
    await signInWithEmailAndPassword(auth,$("adminEmail").value.trim(),$("adminPassword").value);
    $("adminPassword").value="";
    notice("Sessão administrativa iniciada.","success");
  }catch(err){alert("Não foi possível entrar: "+friendlyError(err));}
});
$("adminLogout").addEventListener("click",async()=>{
  try{await signOut(auth); await signInAnonymously(auth); notice("Você saiu da área administrativa.","success");}
  catch(e){alert(friendlyError(e));}
});
$("closeDialog").addEventListener("click",()=>dialog.close());
start();