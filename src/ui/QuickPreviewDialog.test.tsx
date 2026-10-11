// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FileMetadata, FilePreview } from '../domain/types';
import { QuickPreviewDialog } from './QuickPreviewDialog';
import { FileInfoView } from './FileInfoView';
import { testEntry } from './testing/commanderTestSupport';
import './testing/commanderTestSetup';

const photo: FileMetadata = {
  ...testEntry('/photos', 'camera.jpg'), absolutePath: '/photos/camera.jpg', extension: 'jpg', mimeType: 'image/jpeg',
  readonly: false, directoryStats: null,
  imageMetadata: { width: 6000, height: 4000, exifStatus: 'present', truncated: false, fields: [
    { key: 'Model', value: 'Camera model' }, { key: 'DateTimeOriginal', value: '2026-10-11 13:14:15' },
    { key: 'OffsetTimeOriginal', value: '+09:00' }, { key: 'ExposureTime', value: '1/250 s' },
    { key: 'GPSLatitude', value: '37 deg 30 min N' }, { key: 'Copyright', value: '<script>Example</script>' },
  ] },
};
const preview: FilePreview = { path: photo.path, name: photo.name, kind: 'tooLarge', sizeBytes: 20 * 1024 * 1024,
  mimeType: 'image/jpeg', text: null, dataUrl: null, truncated: false, limitBytes: 8 * 1024 * 1024 };

describe('preview file information', () => {
  it('shows EXIF independently of image preview size and uses the same information view', async () => {
    const user = userEvent.setup();
    const getMetadata = vi.fn(async () => ({ ok: true as const, data: photo }));
    render(<QuickPreviewDialog preview={preview} loading={false} language="ko" getMetadata={getMetadata} onClose={vi.fn()} />);
    expect(getMetadata).not.toHaveBeenCalled();
    await user.keyboard('i');
    expect(await screen.findByText('Camera model')).toBeTruthy();
    expect(screen.getByText('6,000 × 4,000 px')).toBeTruthy();
    expect(screen.getByText('촬영 시각')).toBeTruthy();
    expect(screen.getByText('수정일')).toBeTruthy();
    expect(getMetadata).toHaveBeenCalledWith({ path: photo.path });
    const details = screen.getByText('상세 메타데이터').closest('details')!;
    expect(details.open).toBe(false);
    await user.click(screen.getByText('상세 메타데이터'));
    expect(details.open).toBe(true);
    expect(within(details).getByText('37 deg 30 min N')).toBeTruthy();
    expect(within(details).getByText('<script>Example</script>')).toBeTruthy();
    expect(details.querySelector('script')).toBeNull();
    const info = screen.getByRole('complementary', { name: '파일 정보' });
    info.focus();
    await user.keyboard('i');
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(document.activeElement?.className).toContain('quick-preview-content');
  });

  it('keeps text scroll position and native controls while toggling information', async () => {
    const user = userEvent.setup();
    const getMetadata = vi.fn(async () => ({ ok: true as const, data: { ...photo, imageMetadata: null } }));
    render(<QuickPreviewDialog preview={{ ...preview, kind: 'text', text: 'readable text' }} loading={false}
      language="en" getMetadata={getMetadata} onClose={vi.fn()} />);
    const scroll = screen.getByRole('region');
    scroll.scrollTop = 125;
    await user.keyboard('i');
    await screen.findByRole('complementary');
    expect(scroll.scrollTop).toBe(125);
    const button = screen.getByRole('button', { name: 'File Info i' });
    button.focus();
    await user.keyboard('i');
    expect(screen.getByRole('complementary')).toBeTruthy();
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(scroll.scrollTop).toBe(125);
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(scroll.scrollTop).toBe(125);
  });

  it('ignores old metadata after the preview target changes and after closing', async () => {
    const user = userEvent.setup();
    let finish: (result: { ok: true; data: FileMetadata }) => void = () => {};
    const getMetadata = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue({ ok: true, data: { ...photo, name: 'next.jpg', absolutePath: '/photos/next.jpg',
        imageMetadata: { ...photo.imageMetadata!, fields: [{ key: 'Model', value: 'Next camera' }] } } });
    const { rerender, unmount } = render(<QuickPreviewDialog preview={preview} loading={false} language="ko" getMetadata={getMetadata} onClose={vi.fn()} />);
    await user.keyboard('i');
    expect(screen.getByRole('status')).toBeTruthy();
    rerender(<QuickPreviewDialog preview={{ ...preview, path: '/photos/next.jpg', name: 'next.jpg' }} loading={false} language="ko" getMetadata={getMetadata} onClose={vi.fn()} />);
    expect(await screen.findByText('Next camera')).toBeTruthy();
    await act(async () => finish({ ok: true, data: photo }));
    expect(screen.queryByText('Camera model')).toBeNull();
    expect(screen.getByText('Next camera')).toBeTruthy();
    getMetadata.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    rerender(<QuickPreviewDialog preview={{ ...preview, path: '/photos/last.jpg' }} loading={false} language="ko" getMetadata={getMetadata} onClose={vi.fn()} />);
    expect(screen.getByRole('status')).toBeTruthy();
    unmount();
    await act(async () => finish({ ok: true, data: photo }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows read errors with retry without closing the preview', async () => {
    const user = userEvent.setup();
    const getMetadata = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true, data: photo });
    render(<QuickPreviewDialog preview={preview} loading={false} language="ko" getMetadata={getMetadata} onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '파일 정보 i' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('Camera model')).toBeTruthy();
    expect(getMetadata).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['absent', '촬영 정보 없음'], ['unreadable', '이미지 메타데이터를 읽을 수 없습니다.'],
    ['limited', '읽기 한도 안에서 메타데이터를 확인하지 못했습니다.'],
  ] as const)('keeps basic information when EXIF is %s', (exifStatus, message) => {
    render(<FileInfoView language="ko" metadata={{ ...photo, imageMetadata: { ...photo.imageMetadata!, exifStatus, fields: [] } }} />);
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.getByText('/photos/camera.jpg')).toBeTruthy();
    expect(screen.getByText('6,000 × 4,000 px')).toBeTruthy();
  });
});
