// ---------- STATE ----------
let clients = [];
let deals = [];
let tasks = [];
let workflowItems = [];
let payments = [];
let currentUserRole = 'employee';
let profiles = [];

const WORKFLOW_STAGES = [
  { key: 'planned', label: 'Planned' },
  { key: 'file_created', label: 'File created' },
  { key: 'approved', label: 'Client approved' },
  { key: 'posted', label: 'Posted' },
];

// Prospect and Paused are manual pipeline states. For everyone else (status = "client",
// or legacy "active"/"past" values), Active vs Ended is computed from start/end dates.
function getEffectiveFee(baseFee, discountType, discountValue) {
  const base = Number(baseFee || 0);
  if (!discountType || discountType === 'none' || !discountValue) return base;
  if (discountType === 'percentage') return Math.max(0, base - (base * Number(discountValue) / 100));
  if (discountType === 'fixed') return Math.max(0, base - Number(discountValue));
  return base;
}

function getEffectiveStatus(c) {
  if (c.status === 'prospect' || c.status === 'paused') return c.status;
  const today = new Date().toISOString().split('T')[0];
  if (c.end_date && c.end_date < today) return 'past';
  if (c.start_date && c.start_date > today) return 'prospect';
  return 'active';
}

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

  const { data: { user } } = await supabaseClient.auth.getUser();
  const { data: profile } = await supabaseClient.from('profiles').select('role, full_name').eq('id', user.id).single();
  currentUserRole = profile ? profile.role : 'employee';
  applyRoleRestrictions();

  const { data: allProfiles } = await supabaseClient.from('profiles').select('id, full_name, role, position');
  profiles = allProfiles || [];

  await loadAll();
  renderDashboard();
  renderClients();
  renderPipeline();
  renderTasks();
  renderWorkflow();
  renderTeam();
}

function applyRoleRestrictions() {
  const isAdmin = currentUserRole === 'admin';
  const dashboardNav = document.querySelector('.nav-item[data-view="dashboard"]');
  dashboardNav.style.display = isAdmin ? '' : 'none';
  document.getElementById('addTaskBtn').style.display = isAdmin ? '' : 'none';
  document.getElementById('teamNavItem').style.display = isAdmin ? '' : 'none';
  if (!isAdmin) {
    // employees land on Clients instead of the financial dashboard
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelector('.nav-item[data-view="clients"]').classList.add('active');
    document.getElementById('view-clients').classList.add('active');
  }
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
  const [c, d, t, w, p] = await Promise.all([
    supabaseClient.from('clients').select('*').order('created_at', { ascending: false }),
    supabaseClient.from('pipeline').select('*').order('created_at', { ascending: false }),
    supabaseClient.from('tasks').select('*').order('due_date', { ascending: true }),
    supabaseClient.from('workflow_items').select('*').order('start_date', { ascending: false }),
    supabaseClient.from('payments').select('*').order('payment_date', { ascending: false }),
  ]);
  clients = c.data || [];
  deals = d.data || [];
  tasks = t.data || [];
  workflowItems = w.data || [];
  payments = p.data || [];
}

// ---------- DASHBOARD ----------
function renderDashboard() {
  document.getElementById('statActive').textContent = clients.filter(c => getEffectiveStatus(c) === 'active').length;
  document.getElementById('statProspects').textContent = deals.filter(d => !['onboarded', 'lost'].includes(d.stage)).length;
  document.getElementById('statTasks').textContent = tasks.filter(t => t.status !== 'done').length;
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('statOverdue').textContent = tasks.filter(t => t.due_date && t.due_date < today && t.status !== 'done').length;

  const paidClients = clients.filter(c => getEffectiveStatus(c) === 'active' && c.monthly_fee);
  const mrr = paidClients.reduce((sum, c) => sum + getEffectiveFee(c.monthly_fee, c.discount_type, c.discount_value), 0);
  document.getElementById('statMRR').textContent = '$' + mrr.toLocaleString();
  document.getElementById('statPaidClients').textContent = paidClients.length;

  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();

  const paidThisMonth = payments
    .filter(p => p.payment_date && new Date(p.payment_date).getMonth() === thisMonth && new Date(p.payment_date).getFullYear() === thisYear)
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  document.getElementById('statPaidThisMonth').textContent = '$' + paidThisMonth.toLocaleString();

  const adSpend = workflowItems
    .filter(w => w.service === 'ads' && w.start_date)
    .filter(w => {
      const d = new Date(w.start_date);
      return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    })
    .reduce((sum, w) => sum + Number(w.budget_spent || 0), 0);
  document.getElementById('statAdSpend').textContent = '$' + adSpend.toLocaleString();

  const recentPayments = payments.slice(0, 6);
  const paymentsEl = document.getElementById('recentPayments');
  paymentsEl.innerHTML = recentPayments.length
    ? recentPayments.map(p => {
        const client = clients.find(c => c.id === p.client_id);
        return `
          <div class="payment-row" data-client-id="${p.client_id || ''}">
            <span class="pay-amount">${client ? escapeHTML(client.name) : 'Unknown client'}</span>
            <span>${p.amount ? '$' + Number(p.amount).toLocaleString() : '—'}</span>
            <span>${p.payment_date || ''}</span>
            <span class="pay-status ${p.status}">${p.status === 'full' ? 'Fully paid' : 'Partial'}</span>
          </div>`;
      }).join('')
    : `<div class="empty-state">No payments logged yet.</div>`;
  paymentsEl.querySelectorAll('.payment-row').forEach(row => {
    row.addEventListener('click', () => {
      if (row.dataset.clientId) openClientModal(row.dataset.clientId);
    });
  });

  const recent = clients.slice(0, 6);
  const grid = document.getElementById('recentClients');
  grid.innerHTML = recent.length ? recent.map(clientCardHTML).join('') : `<div class="empty-state">No clients yet. Add your first one from the Clients tab.</div>`;
  grid.querySelectorAll('.client-card').forEach(card => card.addEventListener('click', () => openClientModal(card.dataset.id)));
}

// ---------- CLIENTS ----------
function clientCardHTML(c) {
  const status = getEffectiveStatus(c);
  const statusLabel = status === 'past' ? 'Ended' : status;
  const services = (c.services || []).map(s => `<span class="tag">${escapeHTML(s)}</span>`).join('');
  return `
    <div class="client-card status-${status}" data-id="${c.id}">
      <span class="status-pill status-${status}">${statusLabel}</span>
      <h3>${escapeHTML(c.name)}</h3>
      <div class="meta">${escapeHTML(c.industry || '')}${c.contact_name ? ' · ' + escapeHTML(c.contact_name) : ''}</div>
      <div class="tag-row">${services}</div>
    </div>`;
}

function renderClients() {
  const search = document.getElementById('clientSearch').value.toLowerCase();
  const filter = document.getElementById('clientFilter').value;
  const filtered = clients.filter(c =>
    (!filter || getEffectiveStatus(c) === filter) &&
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
  document.getElementById('clientStatus').value = c ? (['active','past'].includes(c.status) ? 'client' : c.status) : 'prospect';
  document.getElementById('clientMonthlyFee').value = c ? (c.monthly_fee || '') : '';
  document.getElementById('clientServiceFee').value = c ? (c.service_fee || '') : '';
  document.getElementById('clientDiscountType').value = c ? (c.discount_type || 'none') : 'none';
  document.getElementById('clientDiscountValue').value = c ? (c.discount_value || '') : '';
  document.getElementById('clientStartDate').value = c ? (c.start_date || '') : '';
  document.getElementById('clientEndDate').value = c ? (c.end_date || '') : '';
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
  toggleDiscountField();
  renderPaymentsSection(c);

  const isAdmin = currentUserRole === 'admin';
  document.getElementById('monthlyFeeField').style.display = (isAdmin && document.getElementById('monthlyFeeField').style.display !== 'none') ? 'block' : 'none';
  document.getElementById('serviceFeeField').style.display = (isAdmin && document.getElementById('serviceFeeField').style.display !== 'none') ? 'block' : 'none';
  const discountRow = document.getElementById('clientDiscountType').closest('.field');
  discountRow.style.display = isAdmin ? 'block' : 'none';
  document.getElementById('discountValueField').style.display = isAdmin ? document.getElementById('discountValueField').style.display : 'none';
  document.getElementById('paymentsSection').style.display = isAdmin ? document.getElementById('paymentsSection').style.display : 'none';
  openModal('clientModal');
}

function renderPaymentsSection(c) {
  const section = document.getElementById('paymentsSection');
  if (!c) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  const badge = document.getElementById('membershipBadge');
  const isActive = getEffectiveStatus(c) === 'active';
  badge.innerHTML = `<span class="membership-badge ${isActive ? 'active' : 'ended'}">${isActive ? 'Active' : 'Ended'}</span>`;

  const clientPayments = payments.filter(p => p.client_id === c.id);
  const list = document.getElementById('paymentsList');
  list.innerHTML = clientPayments.length
    ? clientPayments.map(p => `
        <div class="payment-row" data-id="${p.id}">
          <span class="pay-amount">${p.amount ? '$' + Number(p.amount).toLocaleString() : '—'}</span>
          <span>${p.payment_date || ''}</span>
          <span class="pay-status ${p.status}">${p.status === 'full' ? 'Fully paid' : 'Partial'}</span>
        </div>`).join('')
    : `<div style="font-size:13px; color:var(--muted);">No payments logged yet.</div>`;

  list.querySelectorAll('.payment-row').forEach(row => {
    row.addEventListener('click', () => openPaymentModal(row.dataset.id, c.id));
  });
}

document.getElementById('addPaymentBtn').addEventListener('click', () => {
  const clientId = document.getElementById('clientId').value;
  if (!clientId) { alert('Save the client first, then add payments.'); return; }
  openPaymentModal(null, clientId);
});

document.getElementById('generatePaymentBtn').addEventListener('click', () => {
  const clientId = document.getElementById('clientId').value;
  if (!clientId) { alert('Save the client first, then generate a payment.'); return; }
  const c = clients.find(x => x.id === clientId);
  if (!c || !c.monthly_fee) { alert('Set a monthly fee for this client first — the payment is pre-filled from it.'); return; }
  openPaymentModal(null, clientId, { amount: c.monthly_fee, date: new Date().toISOString().split('T')[0] });
});
document.getElementById('closePaymentModal').addEventListener('click', () => closeModal('paymentModal'));

function openPaymentModal(id, clientId, prefill) {
  const p = payments.find(x => x.id === id);
  document.getElementById('paymentModalTitle').textContent = p ? 'Edit payment' : 'Add payment';
  document.getElementById('paymentId').value = p ? p.id : '';
  document.getElementById('paymentClientId').value = clientId;
  document.getElementById('paymentDate').value = p ? p.payment_date : (prefill ? prefill.date : '');
  document.getElementById('paymentAmount').value = p ? (p.amount || '') : (prefill ? prefill.amount : '');
  document.getElementById('paymentStatus').value = p ? p.status : 'full';
  document.getElementById('paymentNotes').value = p ? (p.notes || '') : '';
  document.getElementById('deletePaymentBtn').style.display = p ? 'inline-flex' : 'none';
  openModal('paymentModal');
}

document.getElementById('savePaymentBtn').addEventListener('click', async () => {
  const id = document.getElementById('paymentId').value;
  const clientId = document.getElementById('paymentClientId').value;
  const payload = {
    client_id: clientId,
    payment_date: document.getElementById('paymentDate').value || null,
    amount: document.getElementById('paymentAmount').value || null,
    status: document.getElementById('paymentStatus').value,
    notes: document.getElementById('paymentNotes').value.trim(),
  };
  if (!payload.payment_date) { alert('Payment date is required.'); return; }

  if (id) {
    await supabaseClient.from('payments').update(payload).eq('id', id);
  } else {
    await supabaseClient.from('payments').insert(payload);
  }
  closeModal('paymentModal');
  await loadAll();
  const c = clients.find(x => x.id === clientId);
  renderPaymentsSection(c);
});

document.getElementById('deletePaymentBtn').addEventListener('click', async () => {
  const id = document.getElementById('paymentId').value;
  const clientId = document.getElementById('paymentClientId').value;
  if (!confirm('Delete this payment record?')) return;
  await supabaseClient.from('payments').delete().eq('id', id);
  closeModal('paymentModal');
  await loadAll();
  const c = clients.find(x => x.id === clientId);
  renderPaymentsSection(c);
});

function toggleServiceSections() {
  const checked = Array.from(document.querySelectorAll('.svc-check')).filter(cb => cb.checked).map(cb => cb.value);
  document.getElementById('socialFieldsSection').style.display = checked.includes('social') ? 'block' : 'none';
  document.getElementById('webFieldsSection').style.display = checked.includes('web') ? 'block' : 'none';
  document.getElementById('monthlyFeeField').style.display = checked.includes('social') ? 'block' : 'none';
  document.getElementById('serviceFeeField').style.display = checked.includes('web') ? 'block' : 'none';
  updateDiscountPreview();
}
document.querySelectorAll('.svc-check').forEach(cb => cb.addEventListener('change', toggleServiceSections));

function toggleDiscountField() {
  const type = document.getElementById('clientDiscountType').value;
  document.getElementById('discountValueField').style.display = type === 'none' ? 'none' : 'block';
  document.getElementById('discountValueLabel').textContent = type === 'percentage' ? 'Discount %' : 'Discount amount (USD)';
  updateDiscountPreview();
}

function updateDiscountPreview() {
  const type = document.getElementById('clientDiscountType').value;
  const value = document.getElementById('clientDiscountValue').value;
  const monthly = document.getElementById('clientMonthlyFee').value;
  const service = document.getElementById('clientServiceFee').value;
  const preview = document.getElementById('discountPreview');
  if (type === 'none' || !value) { preview.textContent = ''; return; }
  const lines = [];
  if (document.getElementById('monthlyFeeField').style.display !== 'none' && monthly) {
    lines.push(`Monthly fee after discount: $${getEffectiveFee(monthly, type, value).toLocaleString()}`);
  }
  if (document.getElementById('serviceFeeField').style.display !== 'none' && service) {
    lines.push(`Service fee after discount: $${getEffectiveFee(service, type, value).toLocaleString()}`);
  }
  preview.textContent = lines.join(' · ');
}
document.getElementById('clientDiscountType').addEventListener('change', toggleDiscountField);
document.getElementById('clientDiscountValue').addEventListener('input', updateDiscountPreview);
document.getElementById('clientMonthlyFee').addEventListener('input', updateDiscountPreview);
document.getElementById('clientServiceFee').addEventListener('input', updateDiscountPreview);

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
    service_fee: document.getElementById('clientServiceFee').value || null,
    discount_type: document.getElementById('clientDiscountType').value,
    discount_value: document.getElementById('clientDiscountValue').value || null,
    start_date: document.getElementById('clientStartDate').value || null,
    end_date: document.getElementById('clientEndDate').value || null,
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

  const assignSel = document.getElementById('taskAssignTo');
  assignSel.innerHTML = '<option value="">— Unassigned —</option>' +
    profiles.map(p => `<option value="${p.id}">${escapeHTML(p.full_name || 'Unnamed')} ${p.role === 'admin' ? '(admin)' : ''}</option>`).join('');
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
    const assignee = profiles.find(p => p.id === t.assigned_to);
    return `
      <div class="task-row" data-id="${t.id}">
        <div style="flex:1; cursor:pointer;" class="task-open">
          <div class="task-title">${escapeHTML(t.title)}</div>
          <div class="task-client">${client ? escapeHTML(client.name) : 'No client'} ${assignee ? '· ' + escapeHTML(assignee.full_name || 'Unnamed') : ''} ${t.due_date ? '· due ' + t.due_date : ''}</div>
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
    if (currentUserRole === 'admin') {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => openTaskModal(el.closest('.task-row').dataset.id));
    } else {
      el.style.cursor = 'default';
    }
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
  document.getElementById('taskAssignTo').value = t ? (t.assigned_to || '') : '';
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
    assigned_to: document.getElementById('taskAssignTo').value || null,
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
    let metaLine = `${client ? escapeHTML(client.name) : 'No client'} · ${escapeHTML(w.service)} · ${freqLabel}${w.start_date ? ' · started ' + w.start_date : ''}`;
    if (w.service === 'ads') {
      const parts = [];
      if (w.platform) parts.push(w.platform);
      if (w.goal) parts.push('goal: ' + w.goal);
      if (w.clicks) parts.push(w.clicks + ' clicks');
      if (w.views) parts.push(w.views + ' views');
      if (w.budget_spent) parts.push('$' + Number(w.budget_spent).toLocaleString() + ' spent');
      metaLine = `${client ? escapeHTML(client.name) : 'No client'} · ${parts.join(' · ')}`;
    }
    return `
      <div class="workflow-row" data-id="${w.id}">
        <div class="wf-top">
          <div>
            <div class="wf-title">${escapeHTML(w.title)}</div>
            <div class="wf-meta">${metaLine}</div>
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
  document.getElementById('adsPlatform').value = w ? (w.platform || 'facebook') : 'facebook';
  document.getElementById('adsGoal').value = w ? (w.goal || 'awareness') : 'awareness';
  document.getElementById('adsViews').value = w ? (w.views || '') : '';
  document.getElementById('adsReach').value = w ? (w.reach || '') : '';
  document.getElementById('adsClicks').value = w ? (w.clicks || '') : '';
  document.getElementById('adsConversions').value = w ? (w.conversions || '') : '';
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
    platform: document.getElementById('adsPlatform').value,
    goal: document.getElementById('adsGoal').value,
    views: document.getElementById('adsViews').value || null,
    reach: document.getElementById('adsReach').value || null,
    clicks: document.getElementById('adsClicks').value || null,
    conversions: document.getElementById('adsConversions').value || null,
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

// ---------- TEAM ----------
function renderTeam() {
  if (currentUserRole !== 'admin') return;
  const list = document.getElementById('teamList');
  if (!profiles.length) {
    list.innerHTML = `<div class="empty-state">No team members found.</div>`;
    return;
  }
  list.innerHTML = profiles.map(p => `
    <div class="team-row" data-id="${p.id}">
      <input type="text" class="team-name" value="${escapeHTML(p.full_name || '')}" placeholder="Name" style="flex:1; min-width:140px;">
      <input type="text" class="team-position" value="${escapeHTML(p.position || '')}" placeholder="Position (e.g. Content Creator)" style="flex:1; min-width:160px;">
      <select class="team-role">
        <option value="employee" ${p.role === 'employee' ? 'selected' : ''}>Employee</option>
        <option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Admin</option>
      </select>
      <button type="button" class="btn btn-primary team-save">Save</button>
    </div>`).join('');

  list.querySelectorAll('.team-row').forEach(row => {
    row.querySelector('.team-save').addEventListener('click', async () => {
      const id = row.dataset.id;
      const payload = {
        full_name: row.querySelector('.team-name').value.trim(),
        position: row.querySelector('.team-position').value.trim(),
        role: row.querySelector('.team-role').value,
      };
      await supabaseClient.from('profiles').update(payload).eq('id', id);
      const { data: allProfiles } = await supabaseClient.from('profiles').select('id, full_name, role, position');
      profiles = allProfiles || [];
      renderTeam();
    });
  });
}

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
