import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import * as api from '../src/api';

vi.mock('../src/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/api')>();
  return {
    ...original,
    resolvePhoto: vi.fn(),
    fetchPhotoImage: vi.fn(),
    fetchPhotoDownload: vi.fn(),
  };
});

const token = 'A'.repeat(43);
const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });

describe('public photo page', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', `/photo#${token}`);
    vi.mocked(api.resolvePhoto).mockResolvedValue({
      status: 'ready',
      expiresAt: '2026-09-16T10:00:00.000Z',
      googleFormsUrl: null,
    });
    vi.mocked(api.fetchPhotoImage).mockResolvedValue(jpeg);
    vi.mocked(api.fetchPhotoDownload).mockResolvedValue(jpeg);
  });

  it('shows loading, the action panel before the photostrip in DOM, and the Join a Ministry link', async () => {
    const { container } = render(<App />);
    expect(screen.getByText('Your moment is almost here.')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: /finished event collage/i })).toHaveAttribute(
      'src',
      expect.stringContaining('blob:'),
    );

    const detailPanel = container.querySelector('.detail-panel');
    const photoStage = container.querySelector('.photo-stage');
    expect(detailPanel).toBeInTheDocument();
    expect(photoStage).toBeInTheDocument();
    // detailPanel is rendered before photoStage in DOM
    expect(detailPanel?.compareDocumentPosition(photoStage!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    const ministryLink = screen.getByRole('link', { name: /join a ministry/i });
    expect(ministryLink).toHaveAttribute(
      'href',
      'https://volunteer-management.ccf.org.ph/recruitment/form',
    );
    expect(ministryLink).toHaveAttribute('target', '_blank');
    expect(ministryLink).toHaveAttribute('rel', 'noopener noreferrer external');
    expect(api.resolvePhoto).toHaveBeenCalledTimes(1);
    expect(api.fetchPhotoImage).toHaveBeenCalledTimes(1);
  });

  it('downloads through the POST client without placing the token in the DOM', async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const { container } = render(<App />);
    const button = await screen.findByRole('button', { name: 'Download photo' });
    expect(container.textContent).not.toContain(token);
    fireEvent.click(button);
    await waitFor(() => expect(api.fetchPhotoDownload).toHaveBeenCalledTimes(1));
    fireEvent.click(button);
    await waitFor(() => expect(api.fetchPhotoDownload).toHaveBeenCalledTimes(2));
    expect(api.fetchPhotoDownload).toHaveBeenNthCalledWith(1, token);
    expect(api.fetchPhotoDownload).toHaveBeenNthCalledWith(2, token);
    expect(click).toHaveBeenCalledTimes(2);
  });

  it('makes one fresh authenticated image POST for each explicit page retry', async () => {
    vi.mocked(api.fetchPhotoImage)
      .mockRejectedValueOnce(new api.PhotoApiError('Temporary failure.', true))
      .mockResolvedValueOnce(jpeg);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('img', { name: /finished event collage/i })).toBeVisible();
    expect(api.resolvePhoto).toHaveBeenCalledTimes(2);
    expect(api.fetchPhotoImage).toHaveBeenCalledTimes(2);
  });

  it('fails closed without a well-shaped fragment token', async () => {
    window.history.replaceState(null, '', '/photo#not-a-token');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'We could not open this photo.' }),
    ).toBeVisible();
    expect(api.resolvePhoto).not.toHaveBeenCalled();
  });
});
