import { esc } from './format.js';
/**
 * Custom UI Components
 * Pengganti alert/confirm/prompt bawaan browser
 */
export const UI = {
  
  /**
   * Custom Modal — menggantikan window.alert / confirm
   */
  modal({ 
    title = 'Pemberitahuan', 
    message = '', 
    icon = 'info', 
    confirmText = 'OK', 
    cancelText = null,
    variant = 'primary' 
  } = {}) {
    return new Promise((resolve) => {
      const root = document.getElementById('modalRoot');
      root.innerHTML = '';
      
      const iconSvg = {
        info: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>',
        success: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>',
        warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
        danger: '<circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>'
      };
      
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      
      const dialog = document.createElement('div');
      dialog.className = 'modal-dialog';
      dialog.setAttribute('role', 'alertdialog');
      dialog.setAttribute('aria-modal', 'true');
      
      dialog.innerHTML = `
        <div class="modal-icon ${icon}">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            ${iconSvg[icon] || iconSvg.info}
          </svg>
        </div>
        <h2 class="modal-title">${this._escape(title)}</h2>
        <div class="modal-body">${this._escape(message)}</div>
        <div class="modal-actions">
          ${cancelText ? `<button class="btn btn-secondary" data-action="cancel">${this._escape(cancelText)}</button>` : ''}
          <button class="btn btn-${variant}" data-action="confirm">${this._escape(confirmText)}</button>
        </div>
      `;
      
      root.appendChild(backdrop);
      root.appendChild(dialog);
      
      requestAnimationFrame(() => {
        root.classList.add('visible');
        root.setAttribute('aria-hidden', 'false');
        dialog.querySelector('button').focus();
      });
      
      const close = (value) => {
        root.classList.remove('visible');
        root.setAttribute('aria-hidden', 'true');
        setTimeout(() => { root.innerHTML = ''; }, 250);
        resolve(value);
      };
      
      dialog.querySelector('[data-action="confirm"]').onclick = () => close(true);
      const cancelBtn = dialog.querySelector('[data-action="cancel"]');
      if (cancelBtn) cancelBtn.onclick = () => close(false);
      backdrop.onclick = () => cancelBtn ? close(false) : close(true);
      
      const onKey = (e) => {
        if (e.key === 'Escape') {
          document.removeEventListener('keydown', onKey);
          cancelBtn ? close(false) : close(true);
        }
      };
      document.addEventListener('keydown', onKey);
    });
  },
  
  /**
   * Welcome Popup — sapaan login + info update & jadwal maintenance
   * updates/maintenance: array { color?, title, desc? } (konten dikontrol kode)
   */
  welcome({ name = '', tenantName = '', avatar = 'A', updates = [], maintenance = [] } = {}) {
    return new Promise((resolve) => {
      const root = document.getElementById('modalRoot');
      root.innerHTML = '';

      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';

      const dialog = document.createElement('div');
      dialog.className = 'modal-dialog welcome-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', `Selamat datang, ${name}`);

      const updateItems = updates.map((u) => `
        <li class="welcome-update-item">
          <span class="welcome-update-dot" style="background:${u.color || 'var(--color-primary)'}"></span>
          <div>
            <p class="welcome-update-title">${this._escape(u.title)}</p>
            ${u.desc ? `<p class="welcome-update-desc">${this._escape(u.desc)}</p>` : ''}
          </div>
        </li>
      `).join('');

      const maintItems = maintenance.map((m) => `
        <li class="welcome-maint-item">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
          <div>
            <p class="welcome-maint-title">${this._escape(m.title)}</p>
            ${m.desc ? `<p class="welcome-maint-desc">${this._escape(m.desc)}</p>` : ''}
          </div>
        </li>
      `).join('');

      dialog.innerHTML = `
        <div class="welcome-banner">
          <div class="welcome-avatar">${this._escape(avatar)}</div>
          <div class="welcome-greeting">
            <p class="welcome-hello">Selamat datang 👋</p>
            <h2 class="welcome-name">${this._escape(name)}</h2>
            ${tenantName ? `<p class="welcome-tenant">${this._escape(tenantName)}</p>` : ''}
          </div>
        </div>
        <div class="welcome-body">
          ${updates.length ? `
          <p class="welcome-section-label">Yang Baru di Klontonk</p>
          <ul class="welcome-updates">${updateItems}</ul>` : ''}
          ${maintenance.length ? `
          <p class="welcome-section-label">Info Maintenance</p>
          <ul class="welcome-maint">${maintItems}</ul>` : ''}
        </div>
        <div class="modal-actions welcome-actions">
          <button class="btn btn-primary welcome-close">Lanjutkan</button>
        </div>
      `;

      root.appendChild(backdrop);
      root.appendChild(dialog);

      requestAnimationFrame(() => {
        root.classList.add('visible');
        root.setAttribute('aria-hidden', 'false');
        dialog.querySelector('button').focus();
      });

      const close = () => {
        root.classList.remove('visible');
        root.setAttribute('aria-hidden', 'true');
        setTimeout(() => { root.innerHTML = ''; }, 250);
        document.removeEventListener('keydown', onKey);
        resolve(true);
      };

      dialog.querySelector('.welcome-close').onclick = close;
      backdrop.onclick = close;

      const onKey = (e) => {
        if (e.key === 'Escape') close();
      };
      document.addEventListener('keydown', onKey);
    });
  },
  
  /**
   * Bottom Sheet — menu pilihan slide-up dari bawah layar
   * items: [{ id, label, desc?, icon? (svg string), danger? }]
   * profile: { avatar, name, role, tenant } — header opsional
   * footer: blok terpin di bawah sheet (dipakai oleh side-left), urutan dari
   *         BAWAH: version → cta → items. Struktur:
   *   - items:   [{ id, label, desc?, icon?, danger? }] — menu bergaya sheet-item
   *   - cta:     { id, label, icon?, danger? } — tombol besar ala tombol login
   *   - version: string — teks kecil, non-interaktif (tidak dapat diklik)
   * resolve(item) saat item/cta dipilih, resolve(null) saat ditutup (backdrop/Escape)
   */
  sheet({ title = '', profile = null, items = [], side = 'up', footer = null } = {}) {
    return new Promise((resolve) => {
      const root = document.getElementById('sheetRoot');
      if (!root) { resolve(null); return; }
      root.innerHTML = '';

      const backdrop = document.createElement('div');
      backdrop.className = 'sheet-backdrop';

      const panel = document.createElement('div');
      panel.className = 'sheet' + (side === 'right' ? ' side-right' : side === 'left' ? ' side-left' : '');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');

      const itemHtml = (it, i) => `
        <button class="sheet-item ${it.danger ? 'danger' : ''}" data-index="${i}" data-id="${this._escape(String(it.id ?? ''))}"${it.tone ? ` data-tone="${this._escape(it.tone)}"` : ''} style="--i:${i}">
          ${it.icon ? `<span class="sheet-item-icon">${it.icon}</span>` : ''}
          <span class="sheet-item-text">
            <span class="sheet-item-label">${this._escape(it.label)}</span>
            ${it.desc ? `<span class="sheet-item-desc">${this._escape(it.desc)}</span>` : ''}
          </span>
        </button>
      `;

      const itemsHtml = items.map((it, i) => itemHtml(it, i)).join('');

      // Footer sheet: item menu → tombol CTA → versi aplikasi (paling bawah)
      const footerItems = (footer && footer.items) || [];
      const footerCta = (footer && footer.cta) || null;
      const footerVersion = (footer && footer.version) || null;
      const ctaIndex = items.length + footerItems.length;
      const allItems = items.concat(footerItems, footerCta ? [footerCta] : []);

      const footerHtml = footer ? `
        <div class="sheet-footer">
          ${footerItems.map((it, i) => itemHtml(it, items.length + i)).join('')}
          ${footerCta ? `
          <button class="sheet-cta ${footerCta.danger ? 'danger' : ''}" data-index="${ctaIndex}" style="--i:${ctaIndex}">
            ${footerCta.icon ? `<span class="sheet-cta-icon">${footerCta.icon}</span>` : ''}
            <span>${this._escape(footerCta.label)}</span>
          </button>` : ''}
          ${footerVersion ? `<p class="sheet-version">${this._escape(footerVersion)}</p>` : ''}
        </div>
      ` : '';

      panel.innerHTML = `
        <div class="sheet-handle" aria-hidden="true"></div>
        ${profile ? `
        <div class="sheet-profile">
          <div class="avatar">${this._escape(profile.avatar || 'A')}</div>
          <div class="profile-info">
            <p class="profile-name">${this._escape(profile.name)}</p>
            <p class="profile-role">${this._escape(profile.role || '')}${profile.tenant ? ' · ' + this._escape(profile.tenant) : ''}</p>
          </div>
        </div>` : ''}
        ${title ? `<p class="sheet-title">${this._escape(title)}</p>` : ''}
        <div class="sheet-items">${itemsHtml}</div>
        ${footerHtml}
      `;

      root.appendChild(backdrop);
      root.appendChild(panel);

      requestAnimationFrame(() => {
        root.classList.add('open');
        root.setAttribute('aria-hidden', 'false');
      });

      const close = (value) => {
        root.classList.remove('open');
        root.setAttribute('aria-hidden', 'true');
        document.removeEventListener('keydown', onKey);
        setTimeout(() => { root.innerHTML = ''; }, 300);
        resolve(value);
      };

      panel.querySelectorAll('[data-index]').forEach(btn => {
        btn.addEventListener('click', () => close(allItems[Number(btn.dataset.index)]));
      });
      backdrop.addEventListener('click', () => close(null));

      const onKey = (e) => {
        if (e.key === 'Escape') close(null);
      };
      document.addEventListener('keydown', onKey);
    });
  },
  
  /**
   * Toast Notification
   */
  toast(message, { type = 'info', duration = 3000 } = {}) {
    const root = document.getElementById('toastRoot');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', 'status');
    
    const icons = {
      info: 'ℹ',
      success: '✓',
      warning: '⚠',
      danger: '✕'
    };
    
    toast.innerHTML = `
      <span style="font-weight:700;font-size:16px;">${icons[type]}</span>
      <span style="flex:1">${this._escape(message)}</span>
    `;
    
    root.appendChild(toast);
    
    setTimeout(() => {
      toast.classList.add('hiding');
      setTimeout(() => toast.remove(), 250);
    }, duration);
  },
  
  _escape(str) {
    return esc(str);
  }
};