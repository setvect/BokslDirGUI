// BokslDirGUI clickable prototype interactions.
// This file intentionally uses only DOM state and fixture labels. It never reads,
// writes, copies, moves, deletes, uploads, downloads, or persists real files.
// Treat this as a disposable UX validation artifact, not as production app
// architecture or a filesystem-access blueprint.
//
// PROTOTYPE QUARANTINE: do not reuse this file as the production app shell.
// The centralized command/router shape is intentional only for a disposable
// browser mockup. Future production work must design a real app boundary from
// scratch instead of extracting this state machine.
//
// TEMPLATE SAFETY RULE: every runtime item/path/label value interpolated into
// an HTML template must be passed through escapeHtml first. Static fixture
// strings may remain literal; never interpolate unescaped user/file data.
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const state = {
    activePanel: 'left',
    selectedNames: ['..'],
    currentItem: '..',
    currentKind: 'folder',
    theme: 'dark',
    language: 'ko',
    operation: 'copy',
  };

  const operationLabels = {
    copy: '복사',
    move: '이동',
    delete: '삭제',
    'new-folder': '새 폴더',
    archive: '압축',
    rename: '이름 변경',
    properties: '정보',
  };

  const samplePaths = {
    '/데모': ['데모'],
    '/데모/docs': ['데모', 'docs'],
    '/데모/target/debug/build': ['데모', 'target/debug/build'],
    '/데모/다운로드': ['데모', '다운로드'],
    '/데모/프로젝트/BokslDirGUI': ['데모', '프로젝트', 'BokslDirGUI'],
    '/데모/스크린샷': ['데모', '스크린샷'],
    '/데모/archive': ['데모', 'archive'],
  };

  const menuModel = {
    file: [
      [
        ['복사', 'y', 'op:copy'],
        ['이동', 'x', 'op:move'],
        ['삭제', 'd', 'op:delete'],
        ['이름 변경', 'r', 'op:rename'],
      ],
      [
        ['새 폴더', 'a', 'op:new-folder'],
        ['압축', 'z', 'op:archive'],
        ['정보', 'i', 'overlay:preview'],
      ],
    ],
    edit: [
      [
        ['선택', 'Space', 'toast:선택 토글 샘플'],
        ['반전 선택', 'v', 'toast:선택 반전 샘플'],
        ['전체 선택', '^A', 'toast:전체 선택 샘플'],
        ['선택 해제', 'u', 'toast:선택 해제 샘플'],
      ],
    ],
    view: [
      [
        ['새로고침', '^R', 'toast:더미 목록 새로고침'],
        ['단일/듀얼 패널', 'Ctrl+W', 'toast:듀얼 패널 유지 샘플'],
        ['파일 정보', 'i', 'overlay:preview'],
      ],
      [
        ['필터', '/', 'overlay:filter'],
        ['빠른 위치', 'g', 'overlay:locations'],
        ['작업 큐', 'q', 'overlay:queue'],
      ],
    ],
    settings: [
      [
        ['테마 전환', '', 'action:toggle-theme'],
        ['언어 전환', '', 'action:toggle-language'],
        ['설정 요약', 'S', 'overlay:settings'],
      ],
    ],
  };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[char]);
  }

  function showToast(message) {
    const toast = $('.toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }

  function getPanel(panel = state.activePanel) {
    return $(`[data-panel="${panel}"]`);
  }

  function getOppositePanel(panel = state.activePanel) {
    return panel === 'left' ? 'right' : 'left';
  }

  function closeMenu() {
    const menu = $('[data-menu-popover]');
    if (menu) menu.hidden = true;
  }

  function closeContextMenu() {
    const menu = $('.context-menu');
    if (menu) menu.hidden = true;
  }

  function closeTransientOverlay() {
    const overlay = $('[data-transient-overlay]');
    if (overlay) overlay.hidden = true;
  }

  function closeScreens() {
    $$('[data-screen]').forEach((screen) => (screen.hidden = true));
  }

  function closeAllTransient() {
    closeMenu();
    closeContextMenu();
    closeTransientOverlay();
    closeScreens();
  }

  function setActivePanel(panel) {
    state.activePanel = panel;
    $$('.file-panel').forEach((node) => {
      const isActive = node.dataset.panel === panel;
      node.classList.toggle('active', isActive);
      $('.active-badge', node)?.remove();
      $('.target-badge', node)?.remove();
      const badge = document.createElement('span');
      badge.className = isActive ? 'active-badge' : 'target-badge';
      badge.textContent = isActive ? '활성' : '대상';
      $('.panel-header', node)?.appendChild(badge);
    });
  }

  function updatePanelStatus(panel) {
    const selectedRows = $$('tbody tr.selected', panel);
    const status = $('.panel-status', panel);
    if (!status) return;
    const rows = $$('tbody tr', panel);
    const files = rows.filter((item) => item.dataset.kind !== 'folder').length;
    const dirs = rows.length - files;
    const safeSelectionSummary =
      selectedRows.length === 1 ? selectedRows[0].dataset.name || '[unknown]' : `${selectedRows.length} selected`;
    status.textContent = `${files} files, ${dirs} dirs | 선택: ${safeSelectionSummary} | 0 B`;
  }

  function updateSelection(row, additive = false, range = false) {
    const panel = row.closest('.file-panel');
    if (!panel) return;
    setActivePanel(panel.dataset.panel);
    const rows = $$('tbody tr', panel);
    if (!additive && !range) rows.forEach((item) => item.classList.remove('selected'));
    if (range) rows.slice(0, rows.indexOf(row) + 1).forEach((item) => item.classList.add('selected'));
    else row.classList.toggle('selected', additive ? !row.classList.contains('selected') : true);
    state.selectedNames = rows.filter((item) => item.classList.contains('selected')).map((item) => item.dataset.name);
    state.currentItem = row.dataset.name || row.textContent.trim();
    state.currentKind = row.dataset.kind || 'file';
    updatePanelStatus(panel);
  }

  function updatePanelPath(path, panelName = state.activePanel) {
    setActivePanel(panelName);
    const panel = getPanel(panelName);
    const pathBar = $('.path-bar', panel);
    if (!pathBar) return;
    const parts = samplePaths[path] || path.split('/').filter(Boolean);
    pathBar.replaceChildren();
    parts.forEach((part, index) => {
      const crumb = document.createElement('button');
      crumb.type = 'button';
      crumb.className = 'breadcrumb';
      crumb.dataset.path = `/${parts.slice(0, index + 1).join('/')}`;
      crumb.textContent = index === 0 ? `/${part}` : part;
      pathBar.appendChild(crumb);
      if (index < parts.length - 1) pathBar.append(' / ');
    });
    const input = document.createElement('input');
    input.setAttribute('aria-label', `${panelName === 'left' ? '왼쪽' : '오른쪽'} 주소 입력`);
    input.value = path;
    pathBar.appendChild(input);
    showToast(`더미 경로 이동: ${path}`);
  }

  function dispatchCommand(command) {
    if (!command) return;
    const [kind, payload = ''] = command.split(':');
    if (kind === 'op') return openOperationDialog(payload);
    if (kind === 'overlay') return openTransientOverlay(payload);
    if (kind === 'action') return handleAction(payload);
    if (kind === 'toast') return showToast(payload);
  }

  function openTopMenu(button, menuKey) {
    const menu = $('[data-menu-popover]');
    const groups = menuModel[menuKey] || menuModel.view;
    if (!menu) return;
    closeContextMenu();
    closeTransientOverlay();
    menu.replaceChildren();
    groups.forEach((group) => {
      const section = document.createElement('div');
      section.className = 'menu-section';
      group.forEach(([label, shortcut, command]) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'menu-row';
        row.dataset.command = command;
        row.innerHTML = `<span>${escapeHtml(label)}</span><span class="shortcut">${escapeHtml(shortcut)}</span>`;
        section.appendChild(row);
      });
      menu.appendChild(section);
    });
    const rect = button.getBoundingClientRect();
    menu.style.left = `${Math.max(8, rect.left)}px`;
    menu.style.top = `${Math.max(34, rect.bottom)}px`;
    menu.hidden = false;
  }

  function overlayTemplate(kind) {
    const selected = state.selectedNames.length ? state.selectedNames.join(', ') : state.currentItem;
    const safeSelected = escapeHtml(selected);
    const active = state.activePanel === 'left' ? '왼쪽' : '오른쪽';
    const templates = {
      preview: {
        title: 'Info / 미리보기',
        body: `
          <dl class="overlay-grid">
            <dt>항목</dt><dd>${safeSelected}</dd>
            <dt>패널</dt><dd>${active} 패널</dd>
            <dt>종류</dt><dd>${escapeHtml(state.currentKind)}</dd>
            <dt>크기</dt><dd>28 KB 샘플</dd>
            <dt>정책</dt><dd>실제 파일을 열지 않는 더미 미리보기</dd>
          </dl>
        `,
      },
      queue: {
        title: 'Queue / 작업 큐',
        body: `
          <div class="overlay-list">
            <div class="overlay-row"><strong>복사 진행 중</strong><span>64% · ETA 00:12</span></div>
            <div class="overlay-row"><strong>압축 대기</strong><span>3개 항목</span></div>
            <div class="overlay-row"><strong>이름 변경 완료</strong><span>더미 로그</span></div>
            <div class="overlay-row"><strong>권한 오류 샘플</strong><span>실제 접근 없음</span></div>
          </div>
        `,
      },
      locations: {
        title: 'Go To / 빠른 위치',
        body: `
          <div class="overlay-list">
            <button type="button" data-jump-path="/데모/docs"><span>/데모/docs</span><small>문서</small></button>
            <button type="button" data-jump-path="/데모/다운로드"><span>/데모/다운로드</span><small>다운로드</small></button>
            <button type="button" data-jump-path="/데모/프로젝트/BokslDirGUI"><span>/데모/프로젝트/BokslDirGUI</span><small>프로젝트</small></button>
            <button type="button" data-jump-path="/데모/archive"><span>/데모/archive</span><small>압축 보관</small></button>
          </div>
        `,
      },
      about: {
        title: 'About / 복슬Dir',
        body: `
          <dl class="overlay-grid">
            <dt>목업</dt><dd>BokslDirGUI TUI-faithful prototype</dd>
            <dt>목표</dt><dd>두 패널 중심의 파일커맨더 GUI 검증</dd>
            <dt>데이터</dt><dd>샘플 fixture only</dd>
            <dt>파일 작업</dt><dd>수행하지 않음</dd>
          </dl>
        `,
      },
      filter: {
        title: 'Filter / 필터',
        body: `
          <label>필터 패턴</label>
          <input class="filter-sample" value="*.md" aria-label="필터 패턴" />
          <p class="muted">목록을 실제로 필터링하지 않고 입력/명령 흐름만 보여줍니다.</p>
        `,
      },
      settings: {
        title: 'Settings / 설정 요약',
        body: `
          <dl class="overlay-grid">
            <dt>테마</dt><dd>Dark terminal tone</dd>
            <dt>레이아웃</dt><dd>Dual panel fixed canvas</dd>
            <dt>보조 기능</dt><dd>Overlay only by default</dd>
            <dt>저장</dt><dd>설정 저장 없음</dd>
          </dl>
        `,
      },
    };
    return templates[kind] || templates.about;
  }

  function openTransientOverlay(kind) {
    const overlay = $('[data-transient-overlay]');
    if (!overlay) return;
    const template = overlayTemplate(kind);
    $('[data-overlay-title]', overlay).textContent = template.title;
    $('[data-overlay-body]', overlay).innerHTML = template.body;
    overlay.hidden = false;
    closeMenu();
    showToast(`${template.title} 오버레이`);
  }

  function openScreen(name) {
    closeAllTransient();
    $$('[data-screen]').forEach((screen) => (screen.hidden = screen.dataset.screen !== name));
    showToast(`${name === 'help' ? '도움말' : name} 오버레이`);
  }

  function setContextMenuScope(scope) {
    $$('[data-context-scope]').forEach((group) => {
      group.hidden = group.dataset.contextScope !== scope;
    });
  }

  function openContextMenu(event, row = null, scope = 'file', panelName = state.activePanel) {
    event.preventDefault();
    closeMenu();
    closeTransientOverlay();
    if (row) updateSelection(row, event.metaKey || event.ctrlKey, event.shiftKey);
    else {
      const panel = getPanel(panelName);
      if (panel) {
        setActivePanel(panelName);
        $$('tbody tr', panel).forEach((item) => item.classList.remove('selected'));
        state.selectedNames = [];
        state.currentItem = '빈 영역';
        state.currentKind = 'folder';
        updatePanelStatus(panel);
      }
    }
    const menu = $('.context-menu');
    if (!menu) return;
    setContextMenuScope(scope);
    menu.hidden = false;
    const x = Math.min(event.clientX, window.innerWidth - 280);
    const y = Math.min(event.clientY, window.innerHeight - 250);
    menu.style.left = `${Math.max(8, x)}px`;
    menu.style.top = `${Math.max(38, y)}px`;
  }

  function openOperationDialog(operation = 'copy') {
    state.operation = operation;
    closeAllTransient();
    const dialog = $('#operation-dialog');
    if (!dialog) return;
    renderOperationStep('confirm');
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeOperationDialog() {
    const dialog = $('#operation-dialog');
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }

  function renderOperationStep(step) {
    const dialog = $('#operation-dialog');
    const form = $('form', dialog);
    if (!form) return;
    const label = operationLabels[state.operation] || state.operation;
    const selected = state.selectedNames.length ? state.selectedNames.join(', ') : state.currentItem;
    const source = state.activePanel === 'left' ? '왼쪽 패널' : '오른쪽 패널';
    const target = getOppositePanel() === 'right' ? '오른쪽 패널' : '왼쪽 패널';
    const safeLabel = escapeHtml(label);
    const safeSelected = escapeHtml(selected);
    const templates = {
      confirm: `
        <h2 id="operation-title">${safeLabel} 확인</h2>
        <p class="dialog-summary">${safeSelected} 항목을 ${target} 대상으로 처리하는 더미 흐름입니다.</p>
        <div class="dialog-grid">
          <span>원본</span><strong>${source} 선택 항목</strong>
          <span>대상</span><strong>${target}</strong>
          <span>정책</span><strong>실제 파일 동작 없음</strong>
        </div>
        <menu><button value="cancel" data-dialog-close>취소</button><button type="button" class="primary" data-dialog-step="conflict">더미 ${safeLabel} 시작</button></menu>
      `,
      conflict: `
        <h2 id="operation-title">충돌 처리 샘플</h2>
        <p class="dialog-summary">동일한 이름이 있다는 가정입니다. 선택은 UI 상태에만 반영됩니다.</p>
        <div class="conflict-grid">
          <button type="button" data-dialog-step="progress">덮어쓰기</button>
          <button type="button" data-dialog-step="progress">건너뛰기</button>
          <button type="button" data-dialog-step="progress">모두 덮어쓰기</button>
          <button type="button" data-dialog-step="progress">모두 건너뛰기</button>
        </div>
        <menu><button type="button" data-dialog-step="confirm">뒤로</button><button value="cancel" data-dialog-close>취소</button></menu>
      `,
      progress: `
        <h2 id="operation-title">${safeLabel} 진행 중</h2>
        <p class="dialog-summary">현재 항목: ${safeSelected} · 14/22 files · 64% · ETA 00:12</p>
        <div class="progress" aria-label="진행률"><span style="width: 64%"></span></div>
        <div class="dialog-grid"><span>속도</span><strong>84 MB/s 샘플</strong><span>상태</span><strong>패널 레이아웃 유지</strong></div>
        <menu><button type="button" data-dialog-step="error">오류 샘플</button><button type="button" data-dialog-step="complete" class="primary">완료 샘플</button></menu>
      `,
      complete: `
        <h2 id="operation-title">${safeLabel} 완료</h2>
        <p class="dialog-summary">더미 작업 완료. 실제 파일은 변경되지 않았습니다.</p>
        <div class="dialog-grid"><span>결과</span><strong>22개 항목 성공 샘플</strong><span>다음</span><strong>대상 패널 포커스 유지</strong></div>
        <menu><button type="button" data-dialog-close class="primary">닫기</button></menu>
      `,
      error: `
        <h2 id="operation-title">오류 요약</h2>
        <p class="dialog-summary">권한 부족 샘플 오류입니다. 실제 경로나 파일에는 접근하지 않았습니다.</p>
        <div class="dialog-grid"><span>실패</span><strong>1개 항목</strong><span>힌트</span><strong>건너뛰거나 다시 시도</strong></div>
        <menu><button type="button" data-dialog-step="progress">진행 화면</button><button type="button" data-dialog-close class="primary">닫기</button></menu>
      `,
    };
    form.innerHTML = templates[step] || templates.confirm;
  }

  function handleAction(action) {
    if (action === 'toggle-theme') {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      document.body.dataset.theme = state.theme;
      showToast(`${state.theme === 'dark' ? 'Dark' : 'Light'} 테마 샘플`);
      return;
    }
    if (action === 'toggle-language') {
      state.language = state.language === 'ko' ? 'en' : 'ko';
      document.body.dataset.language = state.language;
      showToast(state.language === 'ko' ? '한국어 UI 샘플' : 'English label sample');
      return;
    }
    if (['preview', 'queue', 'locations', 'about', 'filter', 'settings'].includes(action)) {
      openTransientOverlay(action);
      return;
    }
    showToast(`${action} 샘플`);
  }

  function bindEvents() {
    $$('.file-panel').forEach((panel) => {
      panel.addEventListener('click', (event) => {
        if (!event.target.closest('button, input, select')) setActivePanel(panel.dataset.panel);
      });
      panel.addEventListener('contextmenu', (event) => {
        if (event.target.closest('tbody tr, button, input, select')) return;
        openContextMenu(event, null, 'empty', panel.dataset.panel);
      });
    });

    $$('.file-table tbody tr').forEach((row) => {
      row.addEventListener('click', (event) => updateSelection(row, event.metaKey || event.ctrlKey, event.shiftKey));
      row.addEventListener('dblclick', () => {
        updateSelection(row);
        if (row.dataset.kind === 'folder') updatePanelPath(`/데모/샘플/${row.dataset.name}`);
        else showToast(`기본 앱 열기 샘플: ${row.dataset.name} (실행 안 함)`);
      });
      row.addEventListener('contextmenu', (event) => openContextMenu(event, row));
    });

    $$('.commander-menubar [data-menu]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        openTopMenu(button, button.dataset.menu);
      });
    });

    $('[data-menu-popover]')?.addEventListener('click', (event) => {
      const command = event.target.closest('[data-command]')?.dataset.command;
      if (!command) return;
      closeMenu();
      dispatchCommand(command);
    });

    $('.context-menu')?.addEventListener('click', (event) => {
      const op = event.target.closest('[data-context-op]')?.dataset.contextOp;
      if (!op) return;
      closeContextMenu();
      if (['copy', 'move', 'delete', 'rename', 'properties', 'new-folder'].includes(op)) openOperationDialog(op);
      else if (op === 'paste') showToast('붙여넣기 샘플: 클립보드/파일 시스템 접근 없음');
      else if (op === 'refresh') showToast('더미 목록 새로고침');
      else showToast(`${event.target.textContent.trim()} 샘플`);
    });

    document.addEventListener('click', (event) => {
      if (!event.target.closest('.context-menu')) closeContextMenu();
      if (!event.target.closest('.menu-popover, [data-menu]')) closeMenu();
      const breadcrumb = event.target.closest('.breadcrumb');
      if (breadcrumb) {
        const panel = breadcrumb.closest('.file-panel');
        updatePanelPath(breadcrumb.dataset.path, panel?.dataset.panel || state.activePanel);
      }
      const jumpPath = event.target.closest('[data-jump-path]')?.dataset.jumpPath;
      if (jumpPath) {
        updatePanelPath(jumpPath);
        closeTransientOverlay();
      }
    });

    document.addEventListener('focusin', (event) => {
      if (event.target.matches('.path-bar input')) {
        const panel = event.target.closest('.file-panel');
        if (panel) setActivePanel(panel.dataset.panel);
        event.target.select();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') return closeAllTransient();
      if (event.key === '?' && !event.target.matches('input, textarea')) return openScreen('help');
      if (event.key === 'Tab' && !event.target.matches('input, select, textarea')) {
        event.preventDefault();
        setActivePanel(getOppositePanel());
        return;
      }
      if (event.target.matches('input, textarea')) {
        if (event.key === 'Enter' && event.target.matches('.path-bar input')) showToast(`주소 입력 샘플: ${event.target.value}`);
        return;
      }
      const keyMap = {
        y: () => openOperationDialog('copy'),
        x: () => openOperationDialog('move'),
        d: () => openOperationDialog('delete'),
        a: () => openOperationDialog('new-folder'),
        r: () => openOperationDialog('rename'),
        z: () => openOperationDialog('archive'),
        i: () => openTransientOverlay('preview'),
        g: () => openTransientOverlay('locations'),
        q: () => openTransientOverlay('queue'),
        '/': () => openTransientOverlay('filter'),
        F1: () => openTransientOverlay('about'),
      };
      const handler = keyMap[event.key];
      if (handler) {
        event.preventDefault();
        handler();
      }
    });

    $$('[data-op]').forEach((button) => button.addEventListener('click', () => openOperationDialog(button.dataset.op)));
    $$('[data-action]').forEach((button) => button.addEventListener('click', () => handleAction(button.dataset.action)));
    $$('[data-open-screen]').forEach((button) => button.addEventListener('click', () => openScreen(button.dataset.openScreen)));
    $$('[data-close-screen], [data-overlay-close]').forEach((button) => button.addEventListener('click', closeAllTransient));

    $('#operation-dialog')?.addEventListener('click', (event) => {
      const step = event.target.closest('[data-dialog-step]')?.dataset.dialogStep;
      if (step) renderOperationStep(step);
      if (event.target.closest('[data-dialog-close]')) closeOperationDialog();
    });
  }

  bindEvents();
  setActivePanel('left');
  showToast('클릭 프로토타입 준비 완료 · 실제 파일 작업 없음');
})();
