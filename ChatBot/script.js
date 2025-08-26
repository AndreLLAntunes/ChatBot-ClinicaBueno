/* Clinic Chatbot - improved flow
   - Captura nome e telefone com validação
   - Agendamento com dias úteis e intervalos configuráveis
   - Confirmação e resumo
   - Informações de horário de atendimento
   - Fallbacks fora de contexto + timers de inatividade
   - Simulação de lembrete (setTimeout) e armazenamento local (localStorage)
*/

const chat = document.getElementById("chat");
const quick = document.getElementById("quick");
const input = document.getElementById("input");
const composer = document.getElementById("composer");
const resetBtn = document.getElementById("resetBtn");

const tplBot = document.getElementById("tpl-msg-bot");
const tplUser = document.getElementById("tpl-msg-user");
const tplQuick = document.getElementById("tpl-quick");

/** STATE **/
const state = {
  step: "welcome",
  awaiting: null, // "name" | "phone" | "specialty" | "day" | "time" | "feedback"
  context: {
    name: null,
    phone: null,
    specialty: null, // "Consulta" | "Exame"
    dayISO: null, // yyyy-mm-dd
    time: null,   // "HH:MM - HH:MM"
  },
  timers: {
    inactivity1: null,
    inactivity2: null
  }
};

function saveAppointments(list){
  localStorage.setItem("appointments", JSON.stringify(list));
  renderAppts();
}

function loadAppts(){
  try{
    return JSON.parse(localStorage.getItem('clinic_appts') || '[]');
  }catch(e){
    return [];
  }
}

function newId(){
  return 'a-' + Math.random().toString(36).slice(2,9);
}

function renderAppts(){
  const list = loadAppts();
  apptsList.innerHTML = '';
  if(!list.length){
    apptsList.innerHTML = '<div class="muted">Nenhum agendamento</div>';
    return;
  }
  list.sort((a,b) => new Date(a.dateISO + 'T' + a.time.split(' - ')[0] + ':00') - new Date(b.dateISO + 'T' + b.time.split(' - ')[0] + ':00'));
  list.forEach(a => {
    const d = document.createElement('div');
    d.className = 'appt';
    d.innerHTML = `<div>
      <strong>${sanitize(a.name)}</strong><div class="muted">${sanitize(a.specialty)} • ${a.dateISO} • ${a.time}</div>
      <div class="muted" style="font-size:12px">${sanitize(a.phone)}</div>
    </div>`;
    const actions = document.createElement('div');
    const btn1 = document.createElement('button');
    btn1.className = 'ghost';
    btn1.textContent = 'Cancelar';
    btn1.onclick = () => {
      if(confirm('Cancelar esse agendamento?')){
        cancelAppt(a.id);
      }
    };
    const btn2 = document.createElement('button');
    btn2.className = 'ghost';
    btn2.style.marginTop = '6px';
    btn2.textContent = 'Baixar .ics';
    btn2.onclick = () => {
      downloadICS(a);
    };
    actions.appendChild(btn1);
    actions.appendChild(btn2);
    d.appendChild(actions);
    apptsList.appendChild(d);
  });
}

function isHoliday(iso){
  return CONFIG.holidays.includes(iso);
}

function isSunday(date){
  return new Date(date).getDay() === 0;
}

function getBusinessSlotsForDate(iso){
  const d = new Date(iso);
  const day = d.getDay();
  const schedule = (day === 6) ? CONFIG.saturday : CONFIG.work;
  if(!schedule || isHoliday(iso) || isSunday(iso)) return [];
  return generateSlots(schedule.start, schedule.end, CONFIG.slotMinutes);
}

function generateSlots(start, end, minutes){
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const slots = [];
  let cur = new Date(0, 0, 0, sh, sm, 0);
  const until = new Date(0, 0, 0, eh, em, 0);
  while(cur < until){
    const next = new Date(cur.getTime() + minutes * 60000);
    const s = cur.toTimeString().slice(0, 5);
    const e = next.toTimeString().slice(0, 5);
    slots.push(`${s} - ${e}`);
    cur = next;
  }
  return slots;
}

function getTakenSlots(iso){
  const list = loadAppts();
  return list.filter(a => a.dateISO === iso).map(a => a.time);
}

function availableSlots(iso){
  const all = getBusinessSlotsForDate(iso);
  const taken = new Set(getTakenSlots(iso));
  return all.filter(s => !taken.has(s));
}

function toICSDate(iso, time){
  const start = iso + 'T' + time.split(' - ')[0].replace(':', '') + '00';
  const end = iso + 'T' + time.split(' - ')[1].replace(':', '') + '00';
  return { start, end };
}

function downloadICS(a){
  const times = toICSDate(a.dateISO, a.time);
  const uid = a.id + '@clinic';
  const text =
`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Clínica Saúde+//EN
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${formatICSDate(new Date())}
DTSTART:${formatICSDate(new Date(a.dateISO + 'T' + a.time.split(' - ')[0] + ':00'))}
DTEND:${formatICSDate(new Date(a.dateISO + 'T' + a.time.split(' - ')[1] + ':00'))}
SUMMARY:Consulta - ${escapeICSText(a.name)}
DESCRIPTION:Tipo:${escapeICSText(a.specialty)}\\nContato:${escapeICSText(a.phone)}
END:VEVENT
END:VCALENDAR`;
  const blob = new Blob([text], {type: 'text/calendar'});
  const url = URL.createObjectURL(blob);
  const ael = document.createElement('a');
  ael.href = url;
  ael.download = `agendamento-${a.id}.ics`;
  document.body.appendChild(ael);
  ael.click();
  ael.remove();
  URL.revokeObjectURL(url);
}

function escapeICSText(s){
  return (s || '').replace(/[,;]/g, '\\$&');
}

function formatICSDate(d){
  return d.toISOString().replace(/[-:]/g, '').slice(0, 19) + 'Z';
}

function confirmAndSave(){
  const c = STATE.ctx;
  const id = newId();
  const item = { id, name: c.name, phone: c.phone, type: c.type, specialty: c.specialty, doctor: c.doctor || '', dateISO: c.dateISO, time: c.time, createdAt: new Date().toISOString() };
  const list = loadAppts();
  list.push(item);
  saveAppts(list);
  addBot('Agendamento realizado com sucesso ✅\n' +
         `Nome: ${c.name}\nTipo: ${c.specialty}\nData: ${c.dateISO} • ${c.time}\nContato: ${c.phone}`);
  addBot('Você pode baixar o convite do calendário agora.');
  downloadICS(item);
  setTimeout(() => {
    addBot(`Lembrete automático: ${c.name}, sua ${c.specialty} é hoje ${c.dateISO} às ${c.time.split(' - ')[0]}. Confirmar presença?`);
    quickReplies([{ label: 'Confirmo', value: 'reminder:confirm' }, { label: 'Cancelar', value: 'reminder:cancel' }]);
    STATE.step = 'reminder';
  }, 10000);
  resetContext();
}

function cancelAppt(id){
  const list = loadAppts().filter(a => a.id !== id);
  saveAppts(list);
  addBot('Agendamento cancelado.');
}

function maskPhone(v){
  const d = v.replace(/\D/g, '');
  if(d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d{0,4})?/, '($1) $2-$3').replace(/-undefined/, '');
  return d.replace(/(\d{2})(\d{5})(\d{0,4})?/, '($1) $2-$3').replace(/-undefined/, '');
}

function validPhone(s){
  const d = (s || '').replace(/\D/g, '');
  return d.length === 10 || d.length === 11;
}

function quickReplies(opts){
  quick.innerHTML = '';
  opts.forEach(o => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = o.label;
    b.onclick = () => handleInput(o.value, true);
    quick.appendChild(b);
  });
}

function clearQuick(){
  quick.innerHTML = '';
}

function start(){
  STATE.step = 'menu';
  resetContext();
  log.innerHTML = '';
  addBot(greeting() + '\nBem-vindo ao atendimento digital da Clínica Saúde+.\nSou o Assistente — vamos começar?');
  showMenu();
  renderAppts();
}

function greeting(){
  const h = new Date().getHours();
  return (h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite');
}

function resetContext(){
  STATE.ctx = { name: null, phone: null, type: null, specialty: null, doctor: null, dateISO: null, time: null };
  clearQuick();
}

function showMenu(){
  STATE.step = 'menu';
  STATE.awaiting = null;
  quickReplies([
    { label: 'Agendar consulta', value: 'agendar' },
    { label: 'Horário de atendimento', value: 'horario' },
    { label: 'Falar com atendente', value: 'humano' },
    { label: 'Listar agendamentos', value: 'listar' }
  ]);
}

function handleInput(text, isQuick = false){
  if(!text) return;
  if(!isQuick) addUser(text);
  const t = (text || '').toString().trim();

  if(/^menu$/i.test(t)){
    addBot('Voltando ao menu principal');
    showMenu();
    return;
  }
  if(/^listar$/i.test(t)){
    renderAppts();
    addBot('Aqui estão seus agendamentos salvos.');
    return;
  }
  if(/^horari/i.test(t)){
    addBot('Atendimento: segunda a sexta 09:00–19:00. Sábado 08:00–12:00. Domingos e feriados fechados.');
    showMenu();
    return;
  }
  if(/^humano$/i.test(t) || t === 'falar com atendente'){
    startHandover();
    return;
  }

  if(STATE.step === 'reminder'){
    if(/confirm/i.test(t) || /confirmo/i.test(t) || t === 'reminder:confirm'){
      addBot('Presença confirmada! Obrigado 🙏');
      showMenu();
      return;
    }
    if(/cancel/i.test(t) || t === 'reminder:cancel'){
      addBot('Consulta cancelada. Vamos registrar e avisar a equipe.');
      showMenu();
      return;
    }
  }

  switch(STATE.step){
    case 'menu':
      if(/^agendar$/i.test(t) || t === 'agendar'){
        startScheduling();
      } else {
        addBot('Desculpe, escolha uma opção do menu');
        showMenu();
      }
      break;
    case 'collect_name':
      processName(t);
      break;
    case 'collect_phone':
      processPhone(t);
      break;
    case 'collect_type':
      processType(t);
      break;
    case 'collect_specialty':
      processSpecialty(t);
      break;
    case 'select_doctor':
      processDoctor(t);
      break;
    case 'select_day':
      processDay(t);
      break;
    case 'select_time':
      processTime(t);
      break;
    case 'confirm':
      if(/confirmar|sim|ok|confirm/i.test(t)){
        confirmAndSave();
      } else if(/refazer/i.test(t)){
        startScheduling();
      } else if(/cancelar|não/i.test(t)){
        addBot('Agendamento cancelado. Posso ajudar em outra coisa?');
        showMenu();
      }
      break;
    case 'handover':
      addBot('Mensagem registrada. Nossa equipe entrará em contato.');
      showMenu();
      break;
    default:
      addBot('Não entendi — retorne ao menu.');
      showMenu();
      break;
  }
}

function startScheduling(){
  resetContext();
  STATE.step = 'collect_name';
  addBot('Ótimo! Para começar, qual é o seu nome completo?');
  clearQuick();
}

function processName(t){
  const clean = t.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ\s'-]/g, '').trim();
  if(clean.length < 2){
    addBot('Por favor, informe seu nome (2+ caracteres).');
    return;
  }
  STATE.ctx.name = clean;
  addBot(`Prazer, ${clean}. Agora, qual o seu telefone com DDD? Ex: 11 91234-5678`);
  STATE.step = 'collect_phone';
}

function processPhone(t){
  const masked = maskPhone(t);
  if(!validPhone(t)){
    addBot('Número inválido. Tente no formato: (11) 91234-5678');
    return;
  }
  STATE.ctx.phone = masked;
  addBot(`Obrigado! Vou usar ${masked}. O que deseja agendar? Consulta ou Exame?`);
  STATE.step = 'collect_type';
  quickReplies([{ label: 'Consulta', value: 'Consulta' }, { label: 'Exame', value: 'Exame' }]);
}

function processType(t){
  const v = t.toLowerCase();
  if(!/(consulta|exame)/i.test(v)){
    addBot('Escolha: Consulta ou Exame');
    quickReplies([{ label: 'Consulta', value: 'Consulta' }, { label: 'Exame', value: 'Exame' }]);
    return;
  }
  STATE.ctx.type = v.includes('exame') ? 'Exame' : 'Consulta';
  STATE.step = 'collect_specialty';
  const specs = ['Clínica Geral', 'Ortopedia', 'Dermatologia', 'Cardiologia', 'Pediatria'];
  addBot('Perfeito. Escolha a especialidade:');
  quickReplies(specs.map(s => ({ label: s, value: s })));
}

function processSpecialty(t){
  STATE.ctx.specialty = t;
  const doctors = doctorsBySpecialty(STATE.ctx.specialty);
  if(doctors.length){
    STATE.step = 'select_doctor';
    addBot('Selecione um profissional:');
    quickReplies(doctors.map(d => ({ label: d, value: d })));
  } else {
    STATE.step = 'select_day';
    addBot('Ok. Escolha o dia para o atendimento:');
    showDayOptions();
  }
}

function doctorsBySpecialty(spec){
  const map = {
    'Clínica Geral': ['Dra. Ana Silva', 'Dr. João Souza'],
    'Ortopedia': ['Dr. Marcos Rocha'],
    'Dermatologia': ['Dra. Luiza Campos'],
    'Cardiologia': ['Dr. Pedro Andrade'],
    'Pediatria': ['Dra. Fernanda Lopes']
  };
  return map[spec] || [];
}

function processDoctor(t){
  STATE.ctx.doctor = t;
  STATE.step = 'select_day';
  addBot(`Você escolheu ${t}. Agora, selecione o dia:`);
  showDayOptions();
}

function showDayOptions(){
  clearQuick();
  const days = nextBusinessDays(CONFIG.futureDays);
  const opts = days.map(d => ({ label: `${d.label} (${d.iso})`, value: d.iso }));
  quickReplies(opts);
}

function nextBusinessDays(n){
  const out = [];
  const today = new Date();
  for(let i = 0; out.length < n && i < 40; i++){
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    if(isSunday(iso) || isHoliday(iso)) continue;
    out.push({ iso, label: labelDate(d) });
  }
  return out;
}

function labelDate(d){
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  return `${days[d.getDay()]} ${dd}/${mm}`;
}

function processDay(t){
  const iso = t;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)){
    addBot('Escolha um dia válido nas opções.');
    return;
  }
  if(isSunday(iso) || isHoliday(iso)){
    addBot('Data indisponível (domingo/feriado). Escolha outra.');
    showDayOptions();
    return;
  }
  STATE.ctx.dateISO = iso;
  STATE.step = 'select_time';
  addBot(`Data escolhida: ${iso}. Selecione horário disponível:`);
  showTimeOptionsForDate(iso);
}

function showTimeOptionsForDate(iso){
  const slots = availableSlots(iso);
  if(!slots.length){
    addBot('Não há horários disponíveis nessa data. Escolha outro dia.');
    showDayOptions();
    return;
  }
  quickReplies(slots.slice(0, 40).map(s => ({ label: s, value: s })));
}

function processTime(t){
  STATE.ctx.time = t;
  const taken = getTakenSlots(STATE.ctx.dateISO);
  if(taken.includes(t)){
    addBot('Ops — horário já ocupado, escolha outro.');
    showTimeOptionsForDate(STATE.ctx.dateISO);
    return;
  }
  STATE.step = 'confirm';
  addBot(`Confira: \nNome: ${STATE.ctx.name}\nContato: ${STATE.ctx.phone}\nTipo: ${STATE.ctx.specialty}\nData: ${STATE.ctx.dateISO} • ${STATE.ctx.time}\nConfirmar?`);
  quickReplies([{ label: 'Confirmar ✅', value: 'confirm' }, { label: 'Refazer', value: 'refazer' }, { label: 'Cancelar', value: 'cancel' }]);
}

function startHandover(){
  STATE.step = 'handover';
  addBot('Vou transferir você para um atendente humano. Se não houver ninguém disponível, deixe uma mensagem e retornaremos.');
  clearQuick();
  quickReplies([{ label: 'Deixar mensagem', value: 'mensagem' }, { label: 'Voltar ao menu', value: 'menu' }]);
}

joinQueueBtn.onclick = () => {
  STATE.queue.push({ time: new Date().toISOString() });
  queueStatus.textContent = `Fila: ${STATE.queue.length} pessoas`;
  addBot('Você entrou na fila de atendimento. Aguarde que um atendente iniciará conversa (simulado).');
};

resetBtn.onclick = () => {
  if(confirm('Reiniciar conversa?')) start();
};

exportAll.onclick = () => {
  const list = loadAppts();
  if(!list.length){
    alert('Nenhum agendamento para exportar.');
    return;
  }
  const header = 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Clínica Saúde+//PT\n';
  const vevents = list.map(a => {
    return `BEGIN:VEVENT
UID:${a.id}@clinic
DTSTAMP:${formatICSDate(new Date())}
DTSTART:${formatICSDate(new Date(a.dateISO + 'T' + a.time.split(' - ')[0] + ':00'))}
DTEND:${formatICSDate(new Date(a.dateISO + 'T' + a.time.split(' - ')[1] + ':00'))}
SUMMARY:Consulta - ${escapeICSText(a.name)}
DESCRIPTION:Tipo:${escapeICSText(a.specialty)}\\nContato:${escapeICSText(a.phone)}
END:VEVENT`;
  }).join('\n');
  const text = header + vevents + '\nEND:VCALENDAR';
  const blob = new Blob([text], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'agendamentos-clinica.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

composer.addEventListener('submit', e => {
  e.preventDefault();
  const t = input.value.trim();
  if(!t) return;
  handleInput(t, false);
  input.value = '';
  input.focus();
});

document.addEventListener('keydown', e => {
  if(e.key === 'Escape') start();
});

start();
renderAppts();
queueStatus.textContent = STATE.queue.length ? `Fila: ${STATE.queue.length} pessoas` : 'Nenhuma pessoa na fila';
window._clinic = { loadAppts, saveAppts, start, availableSlots, CONFIG };