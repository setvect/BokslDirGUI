// BokslDirGUI clickable prototype interactions.
// This file intentionally uses only DOM state and fixture labels. It never reads,
// writes, copies, moves, deletes, uploads, downloads, or persists real files.
// Treat this as a disposable UX validation artifact, not as production app
// architecture or a filesystem-access blueprint.
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const state = {
    activePanel: 'left',
    selectedNames: ['docs'],
    theme: 'dark',
    language: 'ko',
    currentItem: 'docs',
    operation: 'copy',
    previewVisible: true,
    queueVisible: true,
  };

  const labels = {
    copy: '복사',
    move: '이동',
    delete: '삭제',
    'new-folder': '새 폴더',
    archive: '압축',
    rename: '이름 변경',
    properties: '속성 보기',
  };

  const escapeHtml = (value) =>
    String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[char]);

  function textElement(tagName, text, className = '') {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  }

  const samplePaths = {
    '/데모': ['데모'],
    '/데모/홈': ['데모', '홈'],
    '/데모/바탕화면': ['데모', '바탕화면'],
    '/데모/문서': ['데모', '문서'],
    '/데모/다운로드': ['데모', '다운로드'],
    '/데모/프로젝트/BokslDirGUI': ['데모', '프로젝트', 'BokslDirGUI'],
    '/데모/프로젝트/Archive': ['데모', '프로젝트', 'Archive'],
    '/데모/최근/스크린샷': ['데모', '최근', '스크린샷'],
    '/데모/최근/분류대기': ['데모', '최근', '분류대기'],
    '/데모/볼륨/Work': ['데모', '볼륨', 'Work'],
    '/데모/공유/share': ['데모', '공유', 'share'],
  };

  function showToast(message) {
    const toast = $('.toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(() => toast.classList.remove('is-visible'), 3200);
  }

  function getPanel(panel = state.activePanel) {
    return $(`[data-panel="${panel}"]`);
  }

  function getOppositePanel(panel = state.activePanel) {
    return panel === 'left' ? 'right' : 'left';
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
      $('.panel-header', node).appendChild(badge);
    });
    const status = $('.status-bar');
    if (status) {
      status.children[0].textContent = `활성 패널: ${panel === 'left' ? '왼쪽' : '오른쪽'}`;
      status.children[1].textContent = `작업 기본 방향: ${panel === 'left' ? '왼쪽 → 오른쪽' : '오른쪽 → 왼쪽'}`;
    }
  }

  function updatePanelPath(path, panelName = state.activePanel) {
    setActivePanel(panelName);
    const panel = getPanel(panelName);
    const input = $('.path-bar input', panel);
    if (input) input.value = path;
    const parts = samplePaths[path] || path.split('/').filter(Boolean);
    const pathBar = $('.path-bar', panel);
    if (pathBar) {
      const oldInput = input;
      pathBar.replaceChildren();
      parts.forEach((part, index) => {
        const crumb = document.createElement('button');
        crumb.type = 'button';
        crumb.className = 'breadcrumb';
        crumb.dataset.path = `/${parts.slice(0, index + 1).join('/')}`;
        crumb.textContent = part;
        pathBar.appendChild(crumb);
        if (index < parts.length - 1) pathBar.append('/');
      });
      const newInput = document.createElement('input');
      newInput.setAttribute('aria-label', `${panelName === 'left' ? '왼쪽' : '오른쪽'} 주소 입력`);
      newInput.value = path;
      pathBar.appendChild(newInput);
      if (oldInput?.matches(':focus')) newInput.focus();
    }
    showToast(`더미 경로 이동: ${path}`);
  }

  function updateSelection(row, additive = false, range = false) {
    const panel = row.closest('.file-panel');
    setActivePanel(panel.dataset.panel);
    const rows = $$('tbody tr', panel);
    if (!additive && !range) rows.forEach((item) => item.classList.remove('selected'));
    if (range) rows.slice(0, rows.indexOf(row) + 1).forEach((item) => item.classList.add('selected'));
    else row.classList.toggle('selected', additive ? !row.classList.contains('selected') : true);
    state.selectedNames = rows.filter((item) => item.classList.contains('selected')).map((item) => item.dataset.name);
    state.currentItem = row.dataset.name;
    updatePanelStatus(panel);
    updatePreview(row);
  }

  function updatePanelStatus(panel) {
    const selected = $$('tbody tr.selected', panel);
    const status = $('.panel-status', panel);
    if (!status) return;
    const count = $$('tbody tr', panel).length;
    status.textContent = `${count}개 항목 · ${selected.length}개 선택 · 선택 크기 ${selected.length ? '28 KB 샘플' : '0 B'}`;
  }

  function updatePreview(row) {
    const kind = row.dataset.kind || 'file';
    const name = row.dataset.name || '선택 없음';
    const icon = kind === 'folder' ? '📁' : kind === 'archive' ? '🗜️' : name.match(/png|jpg|jpeg/i) ? '🖼️' : '📝';
    const preview = $('.preview-body');
    if (!preview) return;
    preview.replaceChildren(
      textElement('div', icon, 'preview-icon'),
      textElement('strong', name),
      textElement('p', `${kind === 'folder' ? '폴더' : kind === 'archive' ? '압축 파일' : '파일'} · 더미 미리보기`),
      textElement('p', '실제 파일을 열지 않는 안전한 샘플 상태입니다.', 'muted'),
    );
  }

  function setContextMenuScope(scope) {
    $$('[data-context-scope]').forEach((group) => {
      group.hidden = group.dataset.contextScope !== scope;
    });
  }

  function openContextMenu(event, row = null, scope = 'file', panelName = state.activePanel) {
    event.preventDefault();
    if (row) {
      updateSelection(row, event.metaKey || event.ctrlKey, event.shiftKey);
    } else {
      const panel = getPanel(panelName);
      if (panel) {
        setActivePanel(panelName);
        $$('tbody tr', panel).forEach((item) => item.classList.remove('selected'));
        state.selectedNames = [];
        state.currentItem = '빈 영역';
        updatePanelStatus(panel);
      }
    }
    const menu = $('.context-menu');
    if (!menu) return;
    setContextMenuScope(scope);
    menu.hidden = false;
    const x = Math.min(event.clientX, window.innerWidth - 240);
    const y = Math.min(event.clientY, window.innerHeight - 330);
    menu.style.left = `${Math.max(8, x)}px`;
    menu.style.top = `${Math.max(8, y)}px`;
  }

  function closeContextMenu() {
    const menu = $('.context-menu');
    if (menu) menu.hidden = true;
  }

  function openScreen(name) {
    $$('[data-screen]').forEach((screen) => (screen.hidden = screen.dataset.screen !== name));
    showToast(`${name === 'settings' ? '설정' : '도움말'} 화면 열림`);
  }

  function closeScreens() {
    $$('[data-screen]').forEach((screen) => (screen.hidden = true));
  }

  function toggleInspector(kind) {
    const card = kind === 'preview' ? $('.preview-card') : $('.queue-card');
    if (!card) return;
    const visibleKey = kind === 'preview' ? 'previewVisible' : 'queueVisible';
    state[visibleKey] = !state[visibleKey];
    card.classList.toggle('collapsed', !state[visibleKey]);
    const body = kind === 'preview' ? $('.preview-body', card) : $('.queue-list', card);
    if (body) body.hidden = !state[visibleKey];
    showToast(`${kind === 'preview' ? '미리보기' : '작업 큐'} ${state[visibleKey] ? '표시' : '숨김'}`);
  }

  function openOperationDialog(operation = 'copy') {
    state.operation = operation;
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
    if (!dialog) return;
    const title = labels[state.operation] || state.operation;
    const selected = state.selectedNames.length ? state.selectedNames.join(', ') : state.currentItem;
    const target = getOppositePanel() === 'right' ? '오른쪽 패널' : '왼쪽 패널';
    const form = $('form', dialog);
    const safeTitle = escapeHtml(title);
    const safeSelected = escapeHtml(selected);
    const safeTarget = escapeHtml(target);
    const templates = {
      confirm: `
        <h2 id="operation-title">${safeTitle} 확인</h2>
        <p class="dialog-summary">${safeSelected} 항목을 ${safeTarget} 대상으로 처리하는 더미 흐름입니다.</p>
        <div class="dialog-grid">
          <span>원본</span><strong>${state.activePanel === 'left' ? '왼쪽' : '오른쪽'} 패널 선택 항목</strong>
          <span>대상</span><strong>${safeTarget}</strong>
          <span>정책</span><strong>실제 파일 동작 없음</strong>
        </div>
        <menu><button value="cancel" data-dialog-close>취소</button><button type="button" class="primary" data-dialog-step="conflict">더미 ${safeTitle} 시작</button></menu>
      `,
      conflict: `
        <h2 id="operation-title">충돌 처리 샘플</h2>
        <p class="dialog-summary">동일한 이름의 파일이 있다는 가정입니다. 선택은 더미 상태에만 반영됩니다.</p>
        <div class="conflict-grid">
          <button type="button" data-dialog-step="progress">덮어쓰기</button>
          <button type="button" data-dialog-step="progress">건너뛰기</button>
          <button type="button" data-dialog-step="progress">모두 덮어쓰기</button>
          <button type="button" data-dialog-step="progress">모두 건너뛰기</button>
        </div>
        <menu><button type="button" data-dialog-step="confirm">뒤로</button><button value="cancel" data-dialog-close>취소</button></menu>
      `,
      progress: `
        <h2 id="operation-title">${safeTitle} 진행 중</h2>
        <p class="dialog-summary">현재 항목: ${safeSelected} · 14/22 files · 64% · ETA 00:12</p>
        <div class="progress" aria-label="진행률"><span style="width: 64%"></span></div>
        <div class="dialog-grid"><span>속도</span><strong>84 MB/s 샘플</strong><span>상태</span><strong>UI는 계속 반응함</strong></div>
        <menu><button type="button" data-dialog-step="error">오류 샘플</button><button type="button" data-dialog-step="complete" class="primary">완료 샘플</button></menu>
      `,
      complete: `
        <h2 id="operation-title">${safeTitle} 완료</h2>
        <p class="dialog-summary">더미 작업이 완료되었습니다. 실제 파일은 변경되지 않았습니다.</p>
        <div class="dialog-grid"><span>결과</span><strong>22개 항목 성공</strong><span>다음 동작</span><strong>대상 위치 열기 버튼 후보</strong></div>
        <menu><button type="button" data-dialog-close class="primary">닫기</button></menu>
      `,
      error: `
        <h2 id="operation-title">오류 요약</h2>
        <p class="dialog-summary">권한 부족 샘플 오류입니다. 실제 경로나 파일에는 접근하지 않았습니다.</p>
        <div class="dialog-grid"><span>실패</span><strong>1개 항목</strong><span>힌트</span><strong>권한을 확인하거나 건너뛰세요.</strong></div>
        <menu><button type="button" data-dialog-step="progress">진행 화면</button><button type="button" data-dialog-close class="primary">닫기</button></menu>
      `,
    };
    form.innerHTML = templates[step] || templates.confirm;
  }

  function handleToolbarAction(action) {
    if (action === 'toggle-preview') return toggleInspector('preview');
    if (action === 'toggle-queue') return toggleInspector('queue');
    if (action === 'toggle-theme') {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      document.body.dataset.theme = state.theme;
      showToast(`${state.theme === 'dark' ? 'Dark' : 'Light'} 테마 샘플 적용`);
      return;
    }
    if (action === 'toggle-language') {
      state.language = state.language === 'ko' ? 'en' : 'ko';
      document.body.dataset.language = state.language;
      showToast(state.language === 'ko' ? '한국어 UI 샘플' : 'English label sample (partial)');
      return;
    }
    if (action === 'refresh') return showToast('더미 목록 새로고침');
    if (action === 'filter') return showToast('필터 입력 상태 샘플: *.md');
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
        if (row.dataset.kind === 'folder') {
          updatePanelPath(`/데모/샘플/${row.dataset.name}`);
          showToast(`폴더 진입 샘플: ${row.dataset.name}`);
        } else {
          showToast(`기본 앱 열기 샘플: ${row.dataset.name} (실행 안 함)`);
        }
      });
      row.addEventListener('contextmenu', (event) => openContextMenu(event, row));
    });

    $$('.location').forEach((button) => {
      button.addEventListener('click', () => {
        $$('.location').forEach((item) => item.classList.remove('active'));
        button.classList.add('active');
        updatePanelPath(button.dataset.path);
      });
    });

    document.addEventListener('click', (event) => {
      if (!event.target.closest('.context-menu')) closeContextMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeContextMenu();
        closeScreens();
      }
      if (event.key === '?') openScreen('help');
      if (event.key === 'Tab' && !event.target.matches('input, select, textarea')) {
        event.preventDefault();
        setActivePanel(getOppositePanel());
      }
    });

    $('.context-menu')?.addEventListener('click', (event) => {
      const op = event.target.closest('[data-context-op]')?.dataset.contextOp;
      if (!op) return;
      closeContextMenu();
      if (['copy', 'move', 'delete', 'rename', 'properties'].includes(op)) openOperationDialog(op === 'properties' ? 'properties' : op);
      else if (op === 'new-folder') openOperationDialog('new-folder');
      else if (op === 'paste') showToast('붙여넣기 샘플: 클립보드/파일 시스템 접근 없음');
      else if (op === 'refresh') handleToolbarAction('refresh');
      else if (op === 'empty-properties') showToast('현재 폴더 속성 샘플: 더미 메타데이터');
      else showToast(`${event.target.textContent.trim()} 샘플: ${state.currentItem}`);
    });

    $$('.toolbar [data-op]').forEach((button) => button.addEventListener('click', () => openOperationDialog(button.dataset.op)));
    $$('[data-action]').forEach((button) => button.addEventListener('click', () => handleToolbarAction(button.dataset.action)));
    $$('[data-open-screen]').forEach((button) => button.addEventListener('click', () => openScreen(button.dataset.openScreen)));
    $$('[data-close-screen]').forEach((button) => button.addEventListener('click', closeScreens));
    document.addEventListener('click', (event) => {
      const breadcrumb = event.target.closest('.breadcrumb');
      if (breadcrumb) {
        const panel = breadcrumb.closest('.file-panel');
        updatePanelPath(breadcrumb.dataset.path, panel?.dataset.panel || state.activePanel);
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
      if (event.target.matches('.path-bar input') && event.key === 'Enter') {
        showToast(`주소 입력 샘플: ${event.target.value}`);
      }
    });
    $$('.tabs button').forEach((tab) => {
      tab.addEventListener('click', () => {
        const list = tab.parentElement;
        $$('button', list).forEach((item) => item.setAttribute('aria-selected', item === tab ? 'true' : 'false'));
        showToast(`탭 전환 샘플: ${tab.textContent.trim()}`);
      });
    });
    $$('.menu-bar [data-menu]').forEach((button) => {
      button.addEventListener('click', () => showToast(`${button.textContent.trim()} 메뉴 샘플`));
    });
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
