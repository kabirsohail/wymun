/* Youth Impacts Admin Portal — Robust Client-side SPA (v1.2.0)
   - Auth: SHA-256 compare, session in localStorage, 3-strike lockout, idle timeout.
   - Resilience: hash router (#/login, #/app), state persistence (filters/sort/theme), service-worker app shell cache.
   - Data: CSV import/export, localStorage override, reset to defaults.
   - Letters: per-row presence+size verification (HEAD → GET fallback), batch ZIP (selected only), concurrency limiting.
   - UX: sort indicators, sticky header, selection, verify panel, help overlay.
*/

const CONFIG = window.__CONFIG__;
const EXPECTED_USER = CONFIG.username;
const EXPECTED_HASH = CONFIG.passwordHashHex.toLowerCase();

// ---- Theme ----
const themeToggle = document.getElementById('themeToggle');
function applyTheme(t) {
  if (t === 'dark') document.documentElement.classList.add('dark');
  else document.documentElement.classList.remove('dark');
  localStorage.setItem('theme', t);
}
applyTheme(localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark':'light'));
themeToggle.addEventListener('click', () => {
  const t = document.documentElement.classList.contains('dark') ? 'light':'dark';
  applyTheme(t);
});

// ---- Elements ----
const loginView = document.getElementById('loginView');
const appView = document.getElementById('appView');
const logoutBtn = document.getElementById('logoutBtn');
const loginForm = document.getElementById('loginForm');
const lockoutMsg = document.getElementById('lockoutMsg');
const lastLogin = document.getElementById('lastLogin');
const sessionBanner = document.getElementById('sessionBanner');
const helpBtn = document.getElementById('helpBtn');

// Controls
const selectAll = document.getElementById('selectAll');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const zipBtn = document.getElementById('zipBtn');
const printBtn = document.getElementById('printBtn');
const verifyBtn = document.getElementById('verifyBtn');
const importCsv = document.getElementById('importCsv');
const resetDataBtn = document.getElementById('resetDataBtn');
const verifyPanel = document.getElementById('verifyPanel');
const documentsModal = document.getElementById('documentsModal');
const modalStudentName = document.getElementById('modalStudentName');
const modalDocumentsList = document.getElementById('modalDocumentsList');
const closeDocumentsModal = document.getElementById('closeDocumentsModal');

// Filters
const searchInput = document.getElementById('searchInput');
const statusFilter = document.getElementById('statusFilter');
const countryFilter = document.getElementById('countryFilter');
const programFilter = document.getElementById('programFilter');
const rowsEl = document.getElementById('rows');
const rowCount = document.getElementById('rowCount');

// ---- Router ----
function go(hash){ location.hash = hash; }
function onRoute(){
  const h = location.hash || '#/login';
  if (h.startsWith('#/app')) { showApp(); }
  else { showLogin(); }
}
window.addEventListener('hashchange', onRoute);

// ---- Lockout helpers ----
function now(){ return Date.now(); }
function getJSON(k, def) { try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(def)); } catch { return def; } }
function setJSON(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

function getLock(){ return getJSON('lock', {}); }
function setLock(obj){ setJSON('lock', obj); }
function resetAttempts(){ setLock({ attempts:0, until:null }); }
function recordAttempt(ok){
  const L = getLock();
  if (ok) { resetAttempts(); return; }
  const attempts = (L.attempts||0) + 1;
  if (attempts >= CONFIG.lockoutAfterAttempts) {
    const until = now() + CONFIG.lockoutMinutes*60*1000;
    setLock({ attempts, until });
  } else {
    setLock({ attempts, until: L.until||null });
  }
}
function checkLockout(){
  const L = getLock();
  if (!L.until) return 0;
  const remaining = Math.max(0, L.until - now());
  if (remaining <= 0) { resetAttempts(); return 0; }
  return remaining;
}

async function sha256Hex(str){
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// ---- Auth ----
function showLogin(){
  appView.classList.add('hidden');
  sessionBanner.classList.add('hidden');
  logoutBtn.classList.add('hidden');
  loginView.classList.remove('hidden');
}
function showApp(){
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  logoutBtn.classList.remove('hidden');
  sessionBanner.classList.remove('hidden');
  const s = getJSON('session', null);
  if (s?.loginAt) lastLogin.textContent = `Last login: ${new Date(s.loginAt).toLocaleString()}`;
  startIdleTimer();
  initData();
  render();
}

function logout(){
  localStorage.removeItem('session');
  go('#/login');
}
logoutBtn.addEventListener('click', logout);

loginForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const lockMs = checkLockout();
  if (lockMs>0){
    lockoutMsg.textContent = `Locked. Try again in ${Math.ceil(lockMs/60000)} min.`;
    return;
  }
  
  const submitBtn = document.querySelector('#loginForm button');
  if (!submitBtn) {
    console.error('Submit button not found');
    return;
  }
  
  const originalText = submitBtn.textContent;
  
  // Show loading animation
  submitBtn.disabled = true;
  submitBtn.innerHTML = `
    <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    Signing in...
  `;
  
  // Simulate loading for 1 second
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const u = document.getElementById('username').value.trim();
  const p = document.getElementById('password').value;
  const hash = await sha256Hex(p);
  const ok = (u === EXPECTED_USER && hash === EXPECTED_HASH);
  recordAttempt(ok);
  
  if (!ok){
    const left = Math.max(0, CONFIG.lockoutAfterAttempts - (getLock().attempts||0));
    lockoutMsg.textContent = left>0 ? `Invalid. ${left} attempt(s) left.` : `Locked for ${CONFIG.lockoutMinutes} min.`;
    // Reset button
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
    return;
  }
  
  setJSON('session', { user: u, loginAt: now() });
  lockoutMsg.textContent = '';
  go('#/app');
});

// resume
(function(){
  if (localStorage.getItem('session')) go('#/app'); else go('#/login');
})();

// ---- Idle timeout ----
let idleTimer = null;
function resetIdle(){
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(()=>{ logout(); alert('Session timed out due to inactivity.'); }, CONFIG.idleMinutes*60*1000);
}
function startIdleTimer(){
  ['click','mousemove','keydown','scroll','touchstart'].forEach(ev =>
    document.addEventListener(ev, resetIdle, { passive:true })
  );
  resetIdle();
}

// ---- Data & State ----
const DEFAULT_DATA = [
  {
    "name": "Anika Najam",
    "program": "YIMUN • NYC",
    "batch": "2025-Nov",
    "country": "Pakistan",
    "status": "Accepted",
    "invite": "ANIKA NAJAM YIMUN NYC Invite.pdf",
    "passport": "AnikaNajamPassport.pdf",
    "payment": "Paid",
    "visa": "Submitted",
    "notes": "PIFIS Delegation"
  },
  {
    "name": "Moazzam Dildar",
    "program": "YIMUN • NYC",
    "batch": "2025-Nov",
    "country": "Pakistan",
    "status": "Accepted",
    "invite": "MOAZZAM DILDAR YIMUN NYC Invite.pdf",
    "passport": "MoazzamDildarPassport.pdf",
    "payment": "Paid",
    "visa": "Submitted",
    "notes": "PIFIS Delegation"
  },
  {
    "name": "Muhammad Tayyab",
    "program": "YIMUN • NYC",
    "batch": "2025-Nov",
    "country": "Pakistan",
    "status": "Accepted",
    "invite": "MUHAMMAD TAYYAB YIMUN NYC Invite.pdf",
    "passport": "MuhammadTayyabPassport.jpeg",
    "payment": "Paid",
    "visa": "Approved",
    "notes": "PIFIS Delegation"
  },
  {
    "name": "Sharoon Gill",
    "program": "YIMUN • NYC",
    "batch": "2025-Nov",
    "country": "Pakistan",
    "status": "Accepted",
    "invite": "SHAROON GILL YIMUN NYC Invite.pdf",
    "passport": "SharoonGillPassport.jpeg",
    "payment": "Paid",
    "visa": "Submitted",
    "notes": "PIFIS Delegation"
  }
];
let DATA = [];                 // active dataset
let SELECTED = new Set();      // selected names (or ids if present)
let letterCheckCache = new Map(); // filename -> { ok, size, url }

let sortKey = getJSON('ui.sortKey','name');
let sortDir = getJSON('ui.sortDir',1);

function persistUI(){
  setJSON('ui.sortKey', sortKey);
  setJSON('ui.sortDir', sortDir);
  setJSON('ui.filters', {
    q: searchInput.value,
    status: statusFilter.value,
    country: countryFilter.value,
    program: programFilter.value
  });
}

function restoreUI(){
  const f = getJSON('ui.filters', {});
  if (f.q) searchInput.value = f.q;
  if (f.status) statusFilter.value = f.status;
  if (f.country) countryFilter.value = f.country;
  if (f.program) programFilter.value = f.program;
}

function initData(){
  // Load from localStorage override or defaults
  // Force using hardcoded dataset only
  DATA = DEFAULT_DATA.slice();
  // Populate country/program filters
  const countries = Array.from(new Set(DATA.map(d=>d.country))).sort();
  const programs = Array.from(new Set(DATA.map(d=>d.program))).sort();
  function setOptions(select, list){
    const current = select.value;
    select.innerHTML = '<option value="">All</option>' + list.map(v=>`<option>${v}</option>`).join('');
    if (list.includes(current)) select.value = current;
  }
  setOptions(countryFilter, countries);
  setOptions(programFilter, programs);
  restoreUI();
}

// ---- Utils ----
function normalize(v){ return (v??'').toString().toLowerCase(); }
function getLetterURL(file){
  return new URL(`invites/${file}`, document.baseURI).href;
}
function getPassportURL(file, studentName){
  // Use the folder structure for passport files
  const folderName = studentName.replace(/\s+/g, '_').toLowerCase();
  return new URL(`submittedDocuments/${folderName}/passport.pdf`, document.baseURI).href;
}

function getDocumentsFolderURL(studentName){
  // Create a folder path based on student name
  const folderName = studentName.replace(/\s+/g, '_').toLowerCase();
  return new URL(`submittedDocuments/${folderName}/`, document.baseURI).href;
}
function formatSize(bytes){
  if (!Number.isFinite(bytes)) return '';
  const units = ['B','KB','MB','GB']; let i=0, n=bytes;
  while (n>=1024 && i<units.length-1){ n/=1024; i++; }
  return `${n.toFixed(n<10 && i>0 ? 1 : 0)} ${units[i]}`;
}

// ---- Document Data ----
const STUDENT_DOCUMENTS = {
  'Anika Najam': [
    { name: 'Passport', file: 'AnikaNajamPassport.pdf', type: 'identity' }
  ],
  'Moazzam Dildar': [
    { name: 'Passport', file: 'MoazzamDildarPassport.pdf', type: 'identity' }
  ],
  'Muhammad Tayyab': [
    { name: 'Passport', file: 'MuhammadTayyabPassport.jpeg', type: 'identity' },
    { name: 'Academic Transcript', file: 'transcript.pdf', type: 'academic' },
    { name: 'Medical Certificate', file: 'medical_certificate.pdf', type: 'health' }
  ],
  'Sharoon Gill': [
    { name: 'Passport', file: 'SharoonGillPassport.jpeg', type: 'identity' }
  ]
};

function getDocumentTypeIcon(type) {
  const icons = {
    identity: `<svg class="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2"></path></svg>`,
    academic: `<svg class="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>`,
    health: `<svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path></svg>`
  };
  return icons[type] || `<svg class="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>`;
}

function openDocumentsModal(studentName) {
  const documents = STUDENT_DOCUMENTS[studentName] || [];
  modalStudentName.textContent = studentName;
  
  if (documents.length === 0) {
    modalDocumentsList.innerHTML = `
      <div class="text-center py-8 text-slate-500 dark:text-slate-400">
        <svg class="w-12 h-12 mx-auto mb-4 text-slate-300 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
        </svg>
        <p>No documents submitted yet</p>
      </div>
    `;
  } else {
    const folderName = studentName.replace(/\s+/g, '_').toLowerCase();
    modalDocumentsList.innerHTML = documents.map(doc => `
      <div class="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
        <div class="flex items-center gap-3">
          ${getDocumentTypeIcon(doc.type)}
          <div>
            <h4 class="font-medium text-slate-900 dark:text-slate-100">${doc.name}</h4>
            <p class="text-sm text-slate-500 dark:text-slate-400">PDF Document</p>
          </div>
        </div>
        <a href="submittedDocuments/${folderName}/${doc.file}" target="_blank" class="px-3 py-1.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg text-sm hover:opacity-90 transition-opacity">
          View
        </a>
      </div>
    `).join('');
  }
  
  documentsModal.classList.remove('hidden');
}

function closeDocumentsModalHandler() {
  documentsModal.classList.add('hidden');
}

// Modal event listeners
closeDocumentsModal.addEventListener('click', closeDocumentsModalHandler);
documentsModal.addEventListener('click', (e) => {
  if (e.target === documentsModal) closeDocumentsModalHandler();
});

// Make openDocumentsModal globally available
window.openDocumentsModal = openDocumentsModal;

// ---- Filtering/Sorting ----
function filtered(){
  const q = normalize(searchInput.value);
  const st = statusFilter.value;
  const ct = countryFilter.value;
  const pr = programFilter.value;
  return DATA.filter(d => {
    if (st && d.status !== st) return false;
    if (ct && d.country !== ct) return false;
    if (pr && d.program !== pr) return false;
    if (!q) return true;
    return [d.name,d.program,d.batch,d.country,d.status,d.payment,d.visa,d.notes].some(x=>normalize(x).includes(q));
  });
}

function sortData(arr){
  const key = sortKey;
  const dir = sortDir;
  return arr.slice().sort((a,b)=>{
    const va = normalize(a[key]);
    const vb = normalize(b[key]);
    if (va<vb) return -1*dir;
    if (va>vb) return 1*dir;
    return 0;
  });
}

// ---- Rendering ----
function badgeStatus(s){
  const cls = s==='Accepted' ? 'badge-accepted' : s==='Waitlisted' ? 'badge-waitlisted' : 'badge-rejected';
  return `<span class="badge ${cls}">${s}</span>`;
}

function inviteCell(file){
  if (!file) return '<span class="badge badge-pending">Pending</span>';
  const url = getLetterURL(file);
  return `<a class="link" href="${url}" download>Download</a>`;
}

function documentsCell(passport, studentName){
  if (!passport) return '<span class="badge badge-pending">Pending</span>';
  return `<button class="link hover:underline cursor-pointer" onclick="openDocumentsModal('${studentName.replace(/'/g, "\\'")}')">Submitted Documents</button>`;
}

function rowClass(file){
  return '';
}

function render(){
  const arr = sortData(filtered());
  rowsEl.innerHTML = arr.map(d => `
    <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-900/30 ${rowClass(d.invite)}">
      <td class="px-3 py-2"><input type="checkbox" class="rowSel" data-name="${d.name.replace(/"/g,'&quot;')}"></td>
      <td class="px-3 py-2">${d.name}</td>
      <td class="px-3 py-2">${d.program}</td>
      <td class="px-3 py-2">${d.batch}</td>
      <td class="px-3 py-2">${d.country}</td>
      <td class="px-3 py-2">${badgeStatus(d.status)}</td>
      <td class="px-3 py-2">${documentsCell(d.passport, d.name)}</td>
      <td class="px-3 py-2">${inviteCell(d.invite)}</td>
      <td class="px-3 py-2">${d.payment}</td>
      <td class="px-3 py-2">${d.visa}</td>
      <td class="px-3 py-2">${d.notes||''}</td>
    </tr>
  `).join('');

  // restore selection
  document.querySelectorAll('.rowSel').forEach(cb => {
    const name = cb.dataset.name;
    cb.checked = SELECTED.has(name);
    cb.addEventListener('change', () => {
      if (cb.checked) SELECTED.add(name); else SELECTED.delete(name);
      selectAll.checked = isAllSelected();
    });
  });

  rowCount.textContent = `${arr.length} record${arr.length===1?'':'s'}`;
  updateSortIndicators();
}

function isAllSelected(){
  const arr = sortData(filtered());
  if (arr.length===0) return false;
  return arr.every(d => SELECTED.has(d.name));
}

function updateSortIndicators(){
  document.querySelectorAll('th.sort').forEach(th => {
    const span = th.querySelector('.sort-indicator');
    if (!span) return;
    const key = th.dataset.key;
    if (key === sortKey) {
      span.textContent = sortDir>0 ? '▲' : '▼';
    } else {
      span.textContent = '';
    }
  });
}

// sort handlers
document.querySelectorAll('th.sort').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    if (sortKey === key) sortDir *= -1;
    else { sortKey = key; sortDir = 1; }
    persistUI();
    render();
  });
});

// filter handlers
[statusFilter, countryFilter, programFilter].forEach(el => el.addEventListener('change', () => { persistUI(); render(); }));
searchInput.addEventListener('input', () => { persistUI(); render(); });

// Select all
selectAll.addEventListener('change', () => {
  const arr = sortData(filtered());
  if (selectAll.checked) arr.forEach(d => SELECTED.add(d.name));
  else arr.forEach(d => SELECTED.delete(d.name));
  render();
});

// ---- CSV Export ----
exportCsvBtn.addEventListener('click', () => {
  const arr = sortData(filtered());
  const header = ['Name','Program','Batch','Country','Status','Passport','InviteLetter','Payment','Visa','Notes'];
  const rows = arr.map(d => [d.name,d.program,d.batch,d.country,d.status,(d.passport||''),(d.invite||''),d.payment,d.visa,(d.notes||'')]);
  const csv = [header].concat(rows).map(r => r.map(v => `"${(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `students_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a); 
  a.click(); 
  a.remove();
  URL.revokeObjectURL(a.href);
});

// ---- CSV Import ----
importCsv.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (res) => {
      const required = ['Name','Program','Batch','Country','Status','Passport','InviteLetter','Payment','Visa','Notes'];
      const missing = required.filter(k => !res.meta.fields.includes(k));
      if (missing.length){
        alert('CSV missing columns: ' + missing.join(', '));
        return;
      }
      alert('CSV import is disabled for this build. Data is hardcoded.');
    }
  });
});

// Reset data
resetDataBtn.addEventListener('click', () => {
  localStorage.removeItem('data.override');
  SELECTED.clear();
  letterCheckCache.clear();
  fileCheckCache.clear();
  initData();
  render();
  alert('Data reset to defaults.');
});

// ---- ZIP selected letters ----
zipBtn.addEventListener('click', async () => {
  const names = new Set(SELECTED);
  if (names.size===0){ alert('Select at least one row.'); return; }
  
  const mapByName = new Map(DATA.map(d => [d.name, d]));
  const chosen = Array.from(names).map(n => mapByName.get(n)).filter(Boolean).filter(d => !!d.invite);
  if (chosen.length===0){ alert('No selected rows have invite letters.'); return; }

  // Show loading state
  const originalText = zipBtn.textContent;
  zipBtn.disabled = true;
  zipBtn.innerHTML = `
    <svg class="animate-spin -ml-1 mr-2 h-4 w-4 inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    Creating ZIP...
  `;

  const zip = new JSZip();
  let added = 0, skipped = 0;
  
  try {
    await Promise.all(chosen.map(async d => {
      const url = getLetterURL(d.invite);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(res.statusText);
        const blob = await res.blob();
        zip.file(d.invite, blob);
        added++;
      } catch (e) {
        skipped++;
        console.warn('Skip', url, e);
      }
    }));
    
    if (added === 0) { 
      alert('No downloadable letters found (files missing).'); 
      return; 
    }
    
    const content = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = `invite_letters_${new Date().toISOString().split('T')[0]}.zip`;
    document.body.appendChild(a); 
    a.click(); 
    a.remove();
    URL.revokeObjectURL(a.href);
    
    if (skipped>0) alert(`${skipped} file(s) were missing and not included.`);
  } catch (error) {
    alert('Error creating ZIP file: ' + error.message);
  } finally {
    // Reset button
    zipBtn.disabled = false;
    zipBtn.textContent = originalText;
  }
});

// ---- Verify letters (presence + size) with concurrency limit ----
verifyBtn.addEventListener('click', async () => {
  verifyPanel.classList.remove('hidden');
  verifyPanel.textContent = 'Verifying letters…';
  
  // Show loading state on button
  const originalText = verifyBtn.textContent;
  verifyBtn.disabled = true;
  verifyBtn.innerHTML = `
    <svg class="animate-spin -ml-1 mr-2 h-4 w-4 inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    Verifying...
  `;
  
  try {
    const tasks = DATA.filter(d=>d.invite).map(d => d.invite);
    const results = await verifyLetters(tasks, 6);
    const ok = results.filter(r=>r.ok).length;
    const missing = results.length - ok;
    const list = results.map(r => `${r.ok?'✅':'❌'} ${r.file} ${r.size?('('+formatSize(r.size)+')'):''}`).join('\n');
    verifyPanel.innerHTML = `<div class="text-slate-700 dark:text-slate-300">
      <div><strong>${ok}</strong> present, <strong>${missing}</strong> missing.</div>
      <pre class="mt-2 overflow-x-auto">${list}</pre>
    </div>`;
    render(); // update row highlights & size labels
    
    // Show success state
    verifyBtn.innerHTML = `
      <svg class="w-4 h-4 mr-2 text-green-500 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
      </svg>
      Letters Verified
    `;
    
    // Reset button after 3 seconds
    setTimeout(() => {
      verifyBtn.disabled = false;
      verifyBtn.textContent = originalText;
    }, 3000);
    
  } catch (error) {
    verifyPanel.innerHTML = `<div class="text-red-600">Error verifying letters: ${error.message}</div>`;
    verifyBtn.disabled = false;
    verifyBtn.textContent = originalText;
  }
});

async function headOrGet(url){
  // Try HEAD for lightweight check; fall back to GET if HEAD fails or blocked
  try {
    const r = await fetch(url, { method:'HEAD' });
    if (r.ok) return { ok:true, size: Number(r.headers.get('content-length'))||null };
    // Some static hosts don't implement HEAD properly; fall back
  } catch {}
  try {
    const r = await fetch(url, { method:'GET', headers: { 'Range':'bytes=0-0' }, cache:'no-store' });
    if (r.ok) {
      // Parse content-range (e.g., "bytes 0-0/123456")
      const cr = r.headers.get('content-range');
      const size = cr ? Number(cr.split('/').pop()) : Number(r.headers.get('content-length'))||null;
      // Drain body to free memory
      await r.blob();
      return { ok:true, size: size||null };
    }
  } catch {}
  return { ok:false, size:null };
}

async function verifyLetters(files, concurrency=4){
  const out = [];
  let i=0;
  async function worker(){
    while (i<files.length){
      const file = files[i++];
      const url = getLetterURL(file);
      const res = await headOrGet(url);
      letterCheckCache.set(file, { ok: res.ok, size: res.size, url });
      fileCheckCache.set(url, { ok: res.ok, size: res.size });
      out.push({ file, ...res });
    }
  }
  const workers = Array.from({length:Math.min(concurrency, files.length)}, worker);
  await Promise.all(workers.map(w=>w()));
  return out;
}

// ---- Help ----
helpBtn.addEventListener('click', (e) => {
  e.preventDefault();
  alert([
    'Tips:',
    '• Place invite PDFs in applicantDocuments/Invites/ and passports in applicantDocuments/Passports/.',
    '• Links are RELATIVE; works from subpaths on GitHub Pages.',
    '• Use Verify letters to mark missing files and show sizes.',
    '• Import CSV to replace data; Reset Data to revert.',
    '• Select rows to ZIP letters.',
    '• Filters, sort, theme persist across refresh.'
  ].join('\\n'));
});

// ---- Print ----
printBtn.addEventListener('click', () => window.print());

// Kick off route handling
onRoute();
// No dynamic detection; render immediately with hardcoded dataset
render();
