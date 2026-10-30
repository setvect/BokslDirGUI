import { displayPath } from '../domain/pathDisplay';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ACTION_BY_ID, actionForKeyboardShortcut, labelForAction, shortcutLabelForAction } from '../actions/registry';
import type { FileMetadata, FilePreview } from '../domain/types';
import { FILE_INFO_TEXT, formatUserErrorMessage, OVERLAY_TEXT, type SupportedLanguage } from '../i18n-resources';
import type { SafeMutationClient } from '../tauri/commanderClients';
import { CommanderOverlayDialog } from './CommanderOverlays';
import { FileInfoView } from './FileInfoView';
import { elementOwnsNativeKeyboardActivation, elementOwnsTextKeyboard } from './keyboardOwnership';

export function QuickPreviewDialog({ language, preview, loading, getMetadata, onClose }: {
  language: SupportedLanguage;
  preview: FilePreview | null;
  loading: boolean;
  getMetadata?: SafeMutationClient['getMetadata'];
  onClose(): void;
}) {
  const text = OVERLAY_TEXT[language];
  const scrollRef = useRef<HTMLPreElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const infoRef = useRef<HTMLElement>(null);
  const [showInfo, setShowInfo] = useState(false);
  const infoAction = ACTION_BY_ID.get('file.properties')!;
  const infoLabel = labelForAction(infoAction, language);
  const canShowInfo = !loading && !!preview && !!getMetadata;
  const toggleInfo = () => {
    if (showInfo && infoRef.current?.contains(document.activeElement)) {
      (scrollRef.current ?? contentRef.current)?.focus({ preventScroll: true });
    }
    setShowInfo(value => !value);
  };

  useEffect(() => {
    if (!loading) (scrollRef.current ?? contentRef.current)?.focus({ preventScroll: true });
  }, [loading, preview?.path]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!elementOwnsTextKeyboard(target) && !elementOwnsNativeKeyboardActivation(target)
      && actionForKeyboardShortcut(event)?.id === infoAction.id && canShowInfo) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) toggleInfo();
      return;
    }
    const scrollArea = scrollRef.current;
    // 정보 패널과 버튼의 스크롤·키보드 소유권을 유지한다.
    if (!scrollArea || !scrollArea.contains(target) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const lineHeight = Number.parseFloat(window.getComputedStyle(scrollArea).lineHeight) || 28;
    const pageHeight = Math.max(lineHeight, scrollArea.clientHeight - lineHeight);
    const distance = { ArrowDown: lineHeight, ArrowUp: -lineHeight, PageDown: pageHeight, PageUp: -pageHeight }[event.key];
    if (distance === undefined && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Home') scrollArea.scrollTop = 0;
    else if (event.key === 'End') scrollArea.scrollTop = scrollArea.scrollHeight;
    else if (distance !== undefined) scrollArea.scrollTop += distance;
  };

  return <CommanderOverlayDialog owner="quick-preview" title={text.quickView} ariaLabel={text.quickView}
    onClose={onClose} className={`quick-preview-dialog${showInfo ? ' has-file-info' : ''}`}
    onOpenAutoFocus={event => {
      event.preventDefault();
      (scrollRef.current ?? contentRef.current)?.focus({ preventScroll: true });
    }}>
    <div className="quick-preview-content" ref={contentRef} tabIndex={-1} onKeyDown={handleKeyDown}>
      {loading ? <p>{text.previewLoading}</p> : null}
      {!loading && preview ? <>
        <div className="quick-preview-meta">
          <strong title={displayPath(preview.path)}>{preview.name}</strong>
          <span>{preview.sizeBytes.toLocaleString()} {text.bytes}</span>
          {preview.mimeType ? <span>{preview.mimeType}</span> : null}
        </div>
        <div className={`quick-preview-body${showInfo ? ' has-file-info' : ''}`}>
          <div className="quick-preview-document">
            {preview.kind === 'image' && preview.dataUrl ? <img src={preview.dataUrl} alt={preview.name} className="quick-preview-image" /> : null}
            {preview.kind === 'text' ? <>
              {preview.truncated ? <p className="operation-warning">{text.previewTruncated}</p> : null}
              <pre className="quick-preview-text" ref={scrollRef} role="region" aria-label={`${text.quickView}: ${preview.name}`} tabIndex={0}>{preview.text}</pre>
            </> : null}
            {preview.kind === 'unsupported' ? <p>{text.previewUnsupported}</p> : null}
            {preview.kind === 'tooLarge' ? <p>{text.previewTooLarge}</p> : null}
          </div>
          {showInfo && getMetadata ? <aside ref={infoRef} className="quick-preview-info" aria-label={infoLabel} tabIndex={0}>
            <PreviewFileInfo key={preview.path} path={preview.path} language={language} getMetadata={getMetadata} />
          </aside> : null}
        </div>
      </> : null}
      <div className="filter-actions">
        <button type="button" disabled={!canShowInfo} aria-pressed={showInfo}
          onClick={toggleInfo}>{infoLabel} <kbd>{shortcutLabelForAction(infoAction)}</kbd></button>
        <button type="button" onClick={onClose}>{text.close}</button>
      </div>
    </div>
  </CommanderOverlayDialog>;
}

function PreviewFileInfo({ path, language, getMetadata }: {
  path: string;
  language: SupportedLanguage;
  getMetadata: NonNullable<SafeMutationClient['getMetadata']>;
}) {
  const text = FILE_INFO_TEXT[language];
  const [result, setResult] = useState<{ metadata: FileMetadata } | { error: string } | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setResult(null);
    void getMetadata({ path }).then(response => {
      if (!active) return;
      setResult(response.ok ? { metadata: response.data } : { error: formatUserErrorMessage(language, response.error) });
    }).catch(() => {
      if (active) setResult({ error: text.failed });
    });
    return () => { active = false; };
  }, [path, getMetadata, language, reload, text.failed]);
  if (!result) return <p role="status">{text.loading}</p>;
  if ('error' in result) return <>
    <p role="alert" className="operation-warning">{result.error}</p>
    <button type="button" onClick={() => setReload(value => value + 1)}>{text.retry}</button>
  </>;
  return <FileInfoView metadata={result.metadata} language={language} />;
}
