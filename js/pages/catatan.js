import { notes } from '../notes.js';
import { UI } from '../ui.js';
import { esc, escAttr } from '../format.js';

// ============ HALAMAN CATATAN KASIR ============
// Catatan singkat (serah terima shift, pesan untuk kasir berikutnya). Tersimpan di perangkat ini saja.
// Halaman ini juga tujuan "catatan baru" dari sistem (note_taking di manifest.json).

const MAX_LENGTH = 500;

function noteListHtml() {
  const items = notes.list();
  if (!items.length) return '<p class="field-hint" style="margin:0;">Belum ada catatan.</p>';

  return `<ul class="note-list">${items.map((note) => {
    const when = new Date(note.at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    return `
      <li class="note-item">
        <p class="note-text">${esc(note.text)}</p>
        <div class="note-foot">
          <span class="field-hint" style="margin:0;">${esc(when)}</span>
          <button type="button" class="btn btn-secondary" data-note-delete="${escAttr(note.id)}">Hapus</button>
        </div>
      </li>`;
  }).join('')}</ul>`;
}

export function renderCatatanPage() {
  return `
    <div class="page-header">
      <p class="greeting">Kasir</p>
      <h1 class="page-title">Catatan</h1>
      <p class="page-subtitle">Catatan singkat untuk serah terima shift. Tersimpan di perangkat ini saja.</p>
    </div>
    <div class="activity-card" style="padding: 24px;">
      <form id="noteForm" novalidate>
        <label class="form-label" for="noteText">Catatan baru</label>
        <textarea id="noteText" class="form-input" rows="3" maxlength="${MAX_LENGTH}" placeholder="cth: Beras tinggal 2 karung, minta tambah stok."></textarea>
        <p class="form-error" id="noteError" role="alert" hidden></p>
        <button type="submit" class="btn btn-primary btn-large" style="margin-top:12px;">Simpan Catatan</button>
      </form>
    </div>
    <div class="activity-card" style="padding: 24px; margin-top: 16px;" id="noteListCard">${noteListHtml()}</div>
  `;
}

export function initCatatanPage() {
  const form = document.getElementById('noteForm');
  const input = document.getElementById('noteText');
  const errorEl = document.getElementById('noteError');
  const listCard = document.getElementById('noteListCard');
  if (!form || !input || !listCard) return;

  const refresh = () => { listCard.innerHTML = noteListHtml(); };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const result = notes.add(input.value);
    errorEl.hidden = result.ok;
    if (!result.ok) {
      errorEl.textContent = result.error;
      return;
    }
    input.value = '';
    refresh();
    UI.toast('Catatan disimpan.', { type: 'success' });
  });

  listCard.addEventListener('click', (event) => {
    const button = event.target.closest('[data-note-delete]');
    if (!button) return;
    notes.remove(button.dataset.noteDelete);
    refresh();
  });

  input.focus();
}
