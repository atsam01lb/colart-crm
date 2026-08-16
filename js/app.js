// ---------- STATE ----------
let clients = [];
let deals = [];
let tasks = [];
let workflowItems = [];

const WORKFLOW_STAGES = [
  { key: 'planned', label: 'Planned' },
  { key: 'file_created', label: 'File created' },
  { key: 'approved', label: 'Client approved' },
  { key: 'posted', label: 'Posted' },
];

const PIPELINE_STAGES = [
  { key: 'inquiry', label: 'Inquiry' },
  { key: 'proposal_sent', label: 'Proposal sent' },
  { key: 'contract_signed', label: 'Contract signed' },
  { key: 'onboarded', label: 'Onboarded' },
  { key: 'lost', label: 'Lost' },
];

// ---------- AUTH ----------
document.getElementById('loginBtn').addEventListener('click', login);
document.getElementById('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });

async function login() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  if (!email || !password) { errEl.textContent = 'Enter email and password.'; return; }

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) { errEl.textContent = error.message; return; }
  enterApp();
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  document.getElementById('app').classList.remove('visible');
  document.getElementById('loginScreen').style.display = 'flex';
});

async function checkSession() {
  const { data } = await supabaseClient.auth.getSession();
  if (data.session) enterApp();
}

async function enterApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').classList.add('visible');
  await loadAll();
  renderDashboard();
  renderClients();
  renderPipeline();
  renderTasks();
  renderWorkflow();
}

// ---------- NAV ----------
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    item.classList.add('active');
    document.getElementById('view-' + item.dataset.view).classList.add('active');
  });
});

// ---------- DATA LOADING ----------
async function loadAll() {
  const [c, d, t, w] = await Promise.all([
    supabaseClient.from('clients').select('*').order('created_at', { ascending: false }),
    supabaseClient.from('pipeline').select('*').order('created_at', { ascending: false }),
    supabaseClient.from('tasks').select('*').order('due_date', { ascending: true }),
    supabaseClient.from('workflow_items').select('*').order('start_date', { ascending: false }),
  ]);
  clients = c.data || [];
  deals = d.data || [];
  tasks = t.data || [];
  workflowItems = w.data || [];
}

// ---------- DASHBOARD ----------
function renderDashboard() {
  document.getElementById('statActive').textContent = clients.filter(c => c.status === 'active').length;
  document.getElementById('statProspects').textContent = deals.filter(d => !['onboarded', 'lost'].includes(d.stage)).length;
  document.getElementById('statTasks').textContent = tasks.filter(t => t.status !== 'done').length;
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('statOverdue').textContent = tasks.filter(t => t.due_date && t.due_date < today && t.status !== 'done').length;

  const paidClients = clients.filter(c => c.status === 'active' && c.monthly_fee);
  const mrr = paidClients.reduce((sum, c) => sum + Number(c.monthly_fee || 0), 0);
  document.getElementById('statMRR').textContent = '$' + mrr.toLocaleString();
  document.getElementById('statPaidClients').textContent = paidClients.length;

  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();
  const adSpend = workflowItems
    .filter(w => w.service === 'ads' && w.start_date)
    .filter(w => {
      const d = new Date(w.start_date);
      return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    })
    .reduce((sum, w) => sum + Number(w.budget_spent || 0), 0);
  document.getElementById('statAdSpend').textContent = '$' + adSpend.toLocaleString();

  const recent = clients.slice(0, 6);
  const grid = document.getElementById('recentClients');
  grid.innerHTML = recent.length ? recent.map(clientCardHTML).join('') : `<div class="empty-state">No clients yet. Add your first one from the Clients tab.</div>`;
  grid.querySelectorAll('.client-card').forEach(card => card.addEventListener('click', () => openClientModal(card.dataset.id)));
}

// ---------- CLIENTS ----------
function clientCardHTML(c) {
  const services = (c.services || []).map(s => `<span class="tag">${escapeHTML(s)}</span>`).join('');
  return `
    <div class="client-card status-${c.status}" data-id="${c.id}">
      <span class="status-pill status-${c.status}">${c.status}</span>
      <h3>${escapeHTML(c.name)}</h3>
      <div class="meta">${escapeHTML(c.industry || '')}${c.contact_name ? ' · ' + escapeHTML(c.contact_name) : ''}</div>
      <div class="tag-row">${services}</div>
    </div>`;
}

function renderClients() {
  const search = document.getElementById('clientSearch').value.toLowerCase();
  const filter = document.getElementById('clientFilter').value;
  const filtered = clients.filter(c =>
    (!filter || c.status === filter) &&
    (!search || c.name.toLowerCase().includes(search) || (c.industry || '').toLowerCase().includes(search))
  );
  const grid = document.getElementById('clientGrid');
  grid.innerHTML = filtered.length ? filtered.map(clientCardHTML).join('') : `<div class="empty-state">No clients match. <button class="btn btn-ghost" onclick="document.getElementById('clientSearch').value='';document.getElementById('clientFilter').value='';renderClients();">Clear filters</button></div>`;
  grid.querySelectorAll('.client-card').forEach(card => card.addEventListener('click', () => openClientModal(card.dataset.id)));
}
document.getElementById('clientSearch').addEventListener('input', renderClients);
document.getElementById('clientFilter').addEventListener('change', renderClients);

document.getElementById('addClientBtn').addEventListener('click', () => openClientModal(null));
document.getElementById('closeClientModal').addEventListener('click', () => closeModal('clientModal'));

function openClientModal(id) {
  const c = clients.find(x => x.id === id);
  document.getElementById('clientModalTitle').textContent = c ? 'Edit client' : 'Add client';
  document.getElementById('clientId').value = c ? c.id : '';
  document.getElementById('clientName').value = c ? c.name : '';
  document.getElementById('clientIndustry').value = c ? (c.industry || '') : '';
  document.getElementById('clientContact').value = c ? (c.contact_name || '') : '';
  document.getElementById('clientPhone').value = c ? (c.phone || '') : '';
  document.getElementById('clientEmail').value = c ? (c.email || '') : '';
  document.getElementById('clientWebsite').value = c ? (c.website || '') : '';
  document.getElementById('clientStatus').value = c ? c.status : 'prospect';
  document.getElementById('clientMonthlyFee').value = c ? (c.monthly_fee || '') : '';
  document.getElementById('clientNotes').value = c ? (c.notes || '') : '';
  document.getElementById('deleteClientBtn').style.display = c ? 'inline-flex' : 'none';

  const services = c ? (c.services || []) : [];
  document.querySelectorAll('.svc-check').forEach(cb => { cb.checked = services.includes(cb.value); });

  document.getElementById('socialEmail').value = c ? (c.social_email || '') : '';
  document.getElementById('socialEmailPassword').value = c ? (c.social_email_password || '') : '';
  document.getElementById('facebookPage').value = c ? (c.facebook_page || '') : '';
  document.getElementById('instagramUsername').value = c ? (c.instagram_username || '') : '';
  document.getElementById('instagramPassword').value = c ? (c.instagram_password || '') : '';
  document.getElementById('tiktokUsername').value = c ? (c.tiktok_username || '') : '';
  document.getElementById('tiktokPassword').value = c ? (c.tiktok_password || '') : '';

  document.getElementById('webEmail').value = c ? (c.web_email || '') : '';
  document.getElementById('webEmailPassword').value = c ? (c.web_email_password || '') : '';
  document.getElementById('domainUsername').value = c ? (c.domain_username || '') : '';
  document.getElementById('domainPassword').value = c ? (c.domain_password || '') : '';
  document.getElementById('hostingUsername').value = c ? (c.hosting_username || '') : '';
  document.getElementById('hostingPassword').value = c ? (c.hosting_password || '') : '';

  toggleServiceSections();
  openModal('clientModal');
}

function toggleServiceSections() {
  const checked = Array.from(document.querySelectorAll('.svc-check')).filter(cb => cb.checked).map(cb => cb.value);
  document.getElementById('socialFieldsSection').style.display = checked.includes('social') ? 'block' : 'none';
  document.getElementById('webFieldsSection').style.display = checked.includes('web') ? 'block' : 'none';
}
document.querySelectorAll('.svc-check').forEach(cb => cb.addEventListener('change', toggleServiceSections));

document.getElementById('saveClientBtn').addEventListener('click', async () => {
  const id = document.getElementById('clientId').value;
  const services = Array.from(document.querySelectorAll('.svc-check')).filter(cb => cb.checked).map(cb => cb.value);
  const payload = {
    name: document.getElementById('clientName').value.trim(),
    industry: document.getElementById('clientIndustry').value.trim(),
    contact_name: document.getElementById('clientContact').value.trim(),
    phone: document.getElementById('clientPhone').value.trim(),
    email: document.getElementById('clientEmail').value.trim(),
    website: document.getElementById('clientWebsite').value.trim(),
    status: document.getElementById('clientStatus').value,
    services: services,
    monthly_fee: document.getElementById('clientMonthlyFee').value || null,
    notes: document.getElementById('clientNotes').value.trim(),
    social_email: document.getElementById('socialEmail').value.trim(),
    social_email_password: document.getElementById('socialEmailPassword').value.trim(),
    facebook_page: document.getElementById('facebookPage').value.trim(),
    instagram_username: document.getElementById('instagramUsername').value.trim(),
    instagram_password: document.getElementById('instagramPassword').value.trim(),
    tiktok_username: document.getElementById('tiktokUsername').value.trim(),
    tiktok_password: document.getElementById('tiktokPassword').value.trim(),
    web_email: document.getElementById('webEmail').value.trim(),
    web_email_password: document.getElementById('webEmailPassword').value.trim(),
    domain_username: document.getElementById('domainUsername').value.trim(),
    domain_password: document.getElementById('domainPassword').value.trim(),
    hosting_username: document.getElementById('hostingUsername').value.trim(),
    hosting_password: document.getElementById('hostingPassword').value.trim(),
  };
  if (!payload.name) { alert('Client name is required.'); return; }

  if (id) {
    await supabaseClient.from('clients').update(payload).eq('id', id);
  } else {
    await supabaseClient.from('clients').insert(payload);
  }
  closeModal('clientModal');
  await loadAll();
  renderDashboard(); renderClients(); renderTasks(); renderWorkflow(); populateTaskClientOptions();
});

document.getElementById('deleteClientBtn').addEventListener('click', async () => {
  const id = document.getElementById('clientId').value;
  if (!confirm('Delete this client? This also removes their linked tasks.')) return;
  await supabaseClient.from('clients').delete().eq('id', id);
  closeModal('clientModal');
  await loadAll();
  renderDashboard(); renderClients(); renderTasks(); renderWorkflow();
});

// ---------- PIPELINE ----------
function renderPipeline() {
  const board = document.getElementById('pipelineBoard');
  board.innerHTML = PIPELINE_STAGES.map(stage => {
    const stageDeals = deals.filter(d => d.stage === stage.key);
    return `
      <div class="pipeline-col">
        <h4>${stage.label} (${stageDeals.length})</h4>
        ${stageDeals.map(d => `
          <div class="deal-card" data-id="${d.id}">
            <strong>${escapeHTML(d.lead_name)}</strong>
            ${d.value ? `<div class="val">$${Number(d.value).toLocaleString()}</div>` : ''}
          </div>`).join('')}
      </div>`;
  }).join('');
  board.querySelectorAll('.deal-card').forEach(card => card.addEventListener('click', () => openDealModal(card.dataset.id)));
}

document.getElementById('addDealBtn').addEventListener('click', () => openDealModal(null));
document.getElementById('closeDealModal').addEventListener('click', () => closeModal('dealModal'));

function openDealModal(id) {
  const d = deals.find(x => x.id === id);
  document.getElementById('dealModalTitle').textContent = d ? 'Edit lead' : 'Add lead';
  document.getElementById('dealId').value = d ? d.id : '';
  document.getElementById('dealName').value = d ? d.lead_name : '';
  document.getElementById('dealStage').value = d ? d.stage : 'inquiry';
  document.getElementById('dealValue').value = d ? (d.value || '') : '';
  document.getElementById('dealNotes').value = d ? (d.notes || '') : '';
  document.getElementById('deleteDealBtn').style.display = d ? 'inline-flex' : 'none';
  openModal('dealModal');
}

document.getElementById('saveDealBtn').addEventListener('click', async () => {
  const id = document.getElementById('dealId').value;
  const payload = {
    lead_name: document.getElementById('dealName').value.trim(),
    stage: document.getElementById('dealStage').value,
    value: document.getElementById('dealValue').value || null,
    notes: document.getElementById('dealNotes').value.trim(),
    updated_at: new Date().toISOString(),
  };
  if (!payload.lead_name) { alert('Lead name is required.'); return; }

  if (id) {
    await supabaseClient.from('pipeline').update(payload).eq('id', id);
  } else {
    await supabaseClient.from('pipeline').insert(payload);
  }
  closeModal('dealModal');
  await loadAll();
  renderDashboard(); renderPipeline();
});

document.getElementById('deleteDealBtn').addEventListener('click', async () => {
  const id = document.getElementById('dealId').value;
  if (!confirm('Delete this lead?')) return;
  await supabaseClient.from('pipeline').delete().eq('id', id);
  closeModal('dealModal');
  await loadAll();
  renderDashboard(); renderPipeline();
});

// ---------- TASKS ----------
function populateTaskClientOptions() {
  const sel = document.getElementById('taskClient');
  sel.innerHTML = '<option value="">— No client —</option>' +
    clients.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
}

function renderTasks() {
  const filter = document.getElementById('taskFilter').value;
  const filtered = tasks.filter(t => !filter || t.status === filter);
  const list = document.getElementById('taskList');
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">No tasks match.</div>`;
    return;
  }
  list.innerHTML = filtered.map(t => {
    const client = clients.find(c => c.id === t.client_id);
    return `
      <div class="task-row" data-id="${t.id}">
        <div style="flex:1; cursor:pointer;" class="task-open">
          <div class="task-title">${escapeHTML(t.title)}</div>
          <div class="task-client">${client ? escapeHTML(client.name) : 'No client'} ${t.due_date ? '· due ' + t.due_date : ''}</div>
        </div>
        <select class="task-status-select task-status-inline">
          <option value="todo" ${t.status === 'todo' ? 'selected' : ''}>To do</option>
          <option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>In progress</option>
          <option value="review" ${t.status === 'review' ? 'selected' : ''}>In review</option>
          <option value="done" ${t.status === 'done' ? 'selected' : ''}>Done</option>
        </select>
      </div>`;
  }).join('');

  list.querySelectorAll('.task-open').forEach(el => {
    el.addEventListener('click', () => openTaskModal(el.closest('.task-row').dataset.id));
  });
  list.querySelectorAll('.task-status-inline').forEach(sel => {
    sel.addEventListener('change', async (e) => {
      const id = sel.closest('.task-row').dataset.id;
      await supabaseClient.from('tasks').update({ status: e.target.value }).eq('id', id);
      await loadAll();
      renderDashboard(); renderTasks();
    });
  });
}
document.getElementById('taskFilter').addEventListener('change', renderTasks);

document.getElementById('addTaskBtn').addEventListener('click', () => { populateTaskClientOptions(); openTaskModal(null); });
document.getElementById('closeTaskModal').addEventListener('click', () => closeModal('taskModal'));

function openTaskModal(id) {
  populateTaskClientOptions();
  const t = tasks.find(x => x.id === id);
  document.getElementById('taskModalTitle').textContent = t ? 'Edit task' : 'Add task';
  document.getElementById('taskId').value = t ? t.id : '';
  document.getElementById('taskTitle').value = t ? t.title : '';
  document.getElementById('taskClient').value = t ? (t.client_id || '') : '';
  document.getElementById('taskType').value = t ? t.type : 'social';
  document.getElementById('taskStatus').value = t ? t.status : 'todo';
  document.getElementById('taskDue').value = t ? (t.due_date || '') : '';
  document.getElementById('taskNotes').value = t ? (t.notes || '') : '';
  document.getElementById('deleteTaskBtn').style.display = t ? 'inline-flex' : 'none';
  openModal('taskModal');
}

document.getElementById('saveTaskBtn').addEventListener('click', async () => {
  const id = document.getElementById('taskId').value;
  const payload = {
    title: document.getElementById('taskTitle').value.trim(),
    client_id: document.getElementById('taskClient').value || null,
    type: document.getElementById('taskType').value,
    status: document.getElementById('taskStatus').value,
    due_date: document.getElementById('taskDue').value || null,
    notes: document.getElementById('taskNotes').value.trim(),
  };
  if (!payload.title) { alert('Task title is required.'); return; }

  if (id) {
    await supabaseClient.from('tasks').update(payload).eq('id', id);
  } else {
    await supabaseClient.from('tasks').insert(payload);
  }
  closeModal('taskModal');
  await loadAll();
  renderDashboard(); renderTasks();
});

document.getElementById('deleteTaskBtn').addEventListener('click', async () => {
  const id = document.getElementById('taskId').value;
  if (!confirm('Delete this task?')) return;
  await supabaseClient.from('tasks').delete().eq('id', id);
  closeModal('taskModal');
  await loadAll();
  renderDashboard(); renderTasks();
});

// ---------- WORKFLOW ----------
function populateWorkflowClientOptions() {
  const sel = document.getElementById('workflowClient');
  sel.innerHTML = '<option value="">— No client —</option>' +
    clients.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');

  const filterSel = document.getElementById('workflowClientFilter');
  const current = filterSel.value;
  filterSel.innerHTML = '<option value="">All clients</option>' +
    clients.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
  filterSel.value = current;
}

function renderWorkflow() {
  populateWorkflowClientOptions();
  const clientFilter = document.getElementById('workflowClientFilter').value;
  const serviceFilter = document.getElementById('workflowServiceFilter').value;
  const filtered = workflowItems.filter(w =>
    (!clientFilter || w.client_id === clientFilter) &&
    (!serviceFilter || w.service === serviceFilter)
  );
  const list = document.getElementById('workflowList');
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">No workflow items yet. Track service start dates and deliverable stages here.</div>`;
    return;
  }
  const stageOrder = WORKFLOW_STAGES.map(s => s.key);
  list.innerHTML = filtered.map(w => {
    const client = clients.find(c => c.id === w.client_id);
    const currentIdx = stageOrder.indexOf(w.stage);
    const stagesHTML = WORKFLOW_STAGES.map((s, i) => {
      const cls = i < currentIdx ? 'done' : (i === currentIdx ? 'current' : '');
      return `<span class="wf-stage ${cls}">${s.label}</span>`;
    }).join('');
    const freqLabel = { one_time: 'One-time', weekly: 'Weekly', monthly: 'Monthly' }[w.frequency] || w.frequency;
    return `
      <div class="workflow-row" data-id="${w.id}">
        <div class="wf-top">
          <div>
            <div class="wf-title">${escapeHTML(w.title)}</div>
            <div class="wf-meta">${client ? escapeHTML(client.name) : 'No client'} · ${escapeHTML(w.service)} · ${freqLabel}${w.start_date ? ' · started ' + w.start_date : ''}</div>
          </div>
        </div>
        <div class="wf-stages">${stagesHTML}</div>
      </div>`;
  }).join('');
  list.querySelectorAll('.workflow-row').forEach(row => row.addEventListener('click', () => openWorkflowModal(row.dataset.id)));
}
document.getElementById('workflowClientFilter').addEventListener('change', renderWorkflow);
document.getElementById('workflowServiceFilter').addEventListener('change', renderWorkflow);

document.getElementById('addWorkflowBtn').addEventListener('click', () => openWorkflowModal(null));
document.getElementById('closeWorkflowModal').addEventListener('click', () => closeModal('workflowModal'));

document.getElementById('workflowService').addEventListener('change', toggleAdsSection);
function toggleAdsSection() {
  document.getElementById('adsFieldsSection').style.display =
    document.getElementById('workflowService').value === 'ads' ? 'block' : 'none';
}

function openWorkflowModal(id) {
  populateWorkflowClientOptions();
  const w = workflowItems.find(x => x.id === id);
  document.getElementById('workflowModalTitle').textContent = w ? 'Edit workflow item' : 'Add workflow item';
  document.getElementById('workflowId').value = w ? w.id : '';
  document.getElementById('workflowTitle').value = w ? w.title : '';
  document.getElementById('workflowClient').value = w ? (w.client_id || '') : '';
  document.getElementById('workflowService').value = w ? w.service : 'social';
  document.getElementById('workflowStartDate').value = w ? (w.start_date || '') : '';
  document.getElementById('workflowFrequency').value = w ? w.frequency : 'one_time';
  document.getElementById('workflowStage').value = w ? w.stage : 'planned';
  document.getElementById('workflowNotes').value = w ? (w.notes || '') : '';
  document.getElementById('adsDateCreated').value = w ? (w.start_date || '') : '';
  document.getElementById('adsBudgetSpent').value = w ? (w.budget_spent || '') : '';
  document.getElementById('adsDuration').value = w ? (w.duration_days || '') : '';
  document.getElementById('adsResults').value = w ? (w.results || '') : '';
  document.getElementById('deleteWorkflowBtn').style.display = w ? 'inline-flex' : 'none';
  toggleAdsSection();
  openModal('workflowModal');
}

document.getElementById('saveWorkflowBtn').addEventListener('click', async () => {
  const id = document.getElementById('workflowId').value;
  const payload = {
    title: document.getElementById('workflowTitle').value.trim(),
    client_id: document.getElementById('workflowClient').value || null,
    service: document.getElementById('workflowService').value,
    start_date: document.getElementById('workflowStartDate').value || null,
    frequency: document.getElementById('workflowFrequency').value,
    stage: document.getElementById('workflowStage').value,
    notes: document.getElementById('workflowNotes').value.trim(),
    budget_spent: document.getElementById('adsBudgetSpent').value || null,
    duration_days: document.getElementById('adsDuration').value || null,
    results: document.getElementById('adsResults').value.trim(),
    updated_at: new Date().toISOString(),
  };
  if (!payload.title) { alert('Title is required.'); return; }

  if (id) {
    await supabaseClient.from('workflow_items').update(payload).eq('id', id);
  } else {
    await supabaseClient.from('workflow_items').insert(payload);
  }
  closeModal('workflowModal');
  await loadAll();
  renderWorkflow();
});

document.getElementById('deleteWorkflowBtn').addEventListener('click', async () => {
  const id = document.getElementById('workflowId').value;
  if (!confirm('Delete this workflow item?')) return;
  await supabaseClient.from('workflow_items').delete().eq('id', id);
  closeModal('workflowModal');
  await loadAll();
  renderWorkflow();
});

// ---------- MODAL HELPERS ----------
function openModal(id) { document.getElementById(id).classList.add('visible'); }
function closeModal(id) { document.getElementById(id).classList.remove('visible'); }
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('visible'); });
});

// ---------- UTIL ----------
function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// ---------- INIT ----------
checkSession();
