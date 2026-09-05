import { describe, expect, it } from 'vitest';
import {
  ConfirmUploadResponseSchema,
  CreateUploadRequestSchema,
  FrameLayoutSchema,
  IpcContracts,
  OptionalGoogleFormsUrlSchema,
  isAllowedGoogleFormsUrl,
} from '../src/index.js';

const slots = [1, 2, 3].map((slotIndex) => ({
  slotIndex,
  name: `Photo ${slotIndex}`,
  x: 0.1,
  y: (slotIndex - 1) * 0.3,
  width: 0.8,
  height: 0.28,
  cropMode: 'crop-to-fill' as const,
}));

describe('shared boundary schemas', () => {
  it('accepts valid CreateUploadRequest with 1200x3600 strip dimensions', () => {
    const valid = {
      action: 'create' as const,
      clientSessionId: 'cda39163-9036-4acd-ae10-0c08fdb39022',
      contentType: 'image/jpeg' as const,
      byteSize: 1_500_000,
      sha256: 'a'.repeat(64),
      width: 1200,
      height: 3600,
      googleFormsUrl: null,
      capturedAt: '2026-08-24T12:00:00.000Z',
    };
    expect(CreateUploadRequestSchema.parse(valid)).toEqual(valid);
    expect(CreateUploadRequestSchema.parse({ ...valid, byteSize: 20_000_000 }).byteSize).toBe(
      20_000_000,
    );
  });

  it('accepts exactly three normalized slots', () => {
    expect(FrameLayoutSchema.parse(slots)).toHaveLength(3);
    expect(() => FrameLayoutSchema.parse([...slots.slice(0, 2), slots[0]])).toThrow();
    expect(() => FrameLayoutSchema.parse([{ ...slots[0], x: 0.9 }, ...slots.slice(1)])).toThrow();
    expect(() =>
      FrameLayoutSchema.parse([...slots.slice(0, 2), { ...slots[2], slotIndex: 4 }]),
    ).toThrow();
  });

  it('allows any valid HTTPS URL without credentials or custom ports', () => {
    expect(isAllowedGoogleFormsUrl('https://forms.gle/abc123')).toBe(true);
    expect(isAllowedGoogleFormsUrl('https://docs.google.com/forms/d/e/example/viewform')).toBe(
      true,
    );
    expect(
      isAllowedGoogleFormsUrl('https://volunteer-management.ccf.org.ph/recruitment/form'),
    ).toBe(true);
    expect(isAllowedGoogleFormsUrl('https://custom.ministry.org/signup?ref=booth')).toBe(true);
    expect(isAllowedGoogleFormsUrl('https://example.org:443/form')).toBe(true);

    // Rejected cases
    expect(isAllowedGoogleFormsUrl('http://example.org/join')).toBe(false);
    expect(isAllowedGoogleFormsUrl('https://user:pass@example.org/join')).toBe(false);
    expect(isAllowedGoogleFormsUrl('https://example.org:8080/join')).toBe(false);
    expect(isAllowedGoogleFormsUrl(`https://example.org/${'a'.repeat(2050)}`)).toBe(false);

    expect(OptionalGoogleFormsUrlSchema.parse('')).toBeNull();
    expect(
      OptionalGoogleFormsUrlSchema.parse('https://volunteer-management.ccf.org.ph/recruitment/form'),
    ).toBe('https://volunteer-management.ccf.org.ph/recruitment/form');
    expect(() => OptionalGoogleFormsUrlSchema.parse('http://insecure.org')).toThrow();
  });

  it('validates QrStationState with queuedCount and CAS dismiss contract', () => {
    expect(
      IpcContracts['qr-station:dismiss'].request.parse({
        sessionId: 'cda39163-9036-4acd-ae10-0c08fdb39022',
      }),
    ).toEqual({ sessionId: 'cda39163-9036-4acd-ae10-0c08fdb39022' });
    expect(IpcContracts['qr-station:dismiss'].request.parse({})).toEqual({});
  });

  it('rejects extra IPC payload fields and weak passcodes', () => {
    expect(() => IpcContracts['booth:start'].request.parse({ arbitrary: true })).toThrow();
    expect(() => IpcContracts['admin:login'].request.parse({ passcode: '7777' })).toThrow();
  });

  it('requires ready metadata with an HTTPS public page origin or local LAN HTTP', () => {
    const valid = {
      status: 'ready',
      readyAt: '2026-08-17T12:00:00.000Z',
      expiresAt: '2026-09-16T12:00:00.000Z',
      publicPageOrigin: 'https://photos.example.org',
      publicPath: '/photo',
    };
    expect(ConfirmUploadResponseSchema.parse(valid)).toEqual(valid);
    expect(
      ConfirmUploadResponseSchema.parse({ ...valid, publicPageOrigin: 'http://192.168.1.50:4310' })
        .publicPageOrigin,
    ).toBe('http://192.168.1.50:4310');
    expect(() =>
      ConfirmUploadResponseSchema.parse({ ...valid, publicPageOrigin: 'http://example.test' }),
    ).toThrow();
  });

  it('validates frame identifiers for accept-photos and the admin frame library', () => {
    const frameId = 'cda39163-9036-4acd-ae10-0c08fdb39022';
    expect(IpcContracts['booth:accept-photos'].request.parse({ frameId })).toEqual({ frameId });
    expect(() => IpcContracts['booth:accept-photos'].request.parse({})).toThrow();
    expect(() =>
      IpcContracts['booth:accept-photos'].request.parse({ frameId: 'not-a-uuid' }),
    ).toThrow();

    expect(IpcContracts['admin:list-frames'].request.parse({})).toEqual({});
    expect(IpcContracts['admin:choose-frame'].request.parse({})).toEqual({});
    expect(
      IpcContracts['admin:add-frame'].request.parse({
        candidateId: frameId,
        name: 'Landscape frame',
        shotCount: 1,
      }),
    ).toMatchObject({ candidateId: frameId, shotCount: 1 });
    expect(() =>
      IpcContracts['admin:add-frame'].request.parse({
        candidateId: frameId,
        name: 'Too many',
        shotCount: 11,
      }),
    ).toThrow();
    expect(IpcContracts['admin:replace-frame-image'].request.parse({ frameId })).toEqual({ frameId });
    expect(
      IpcContracts['admin:update-frame-layout'].request.parse({
        frameId,
        name: 'New name',
        slots,
        expectedRevision: 3,
      }),
    ).toMatchObject({ frameId, expectedRevision: 3 });
    expect(IpcContracts['admin:delete-frame'].request.parse({ frameId })).toEqual({ frameId });
    expect(IpcContracts['admin:move-frame'].request.parse({ frameId, direction: 'up' })).toEqual({
      frameId,
      direction: 'up',
    });
    expect(() =>
      IpcContracts['admin:move-frame'].request.parse({ frameId, direction: 'sideways' }),
    ).toThrow();
  });

  it('validates recent-gallery limits', () => {
    expect(IpcContracts['gallery:get-recent'].request.parse({ limit: 5 })).toEqual({ limit: 5 });
    expect(() => IpcContracts['gallery:get-recent'].request.parse({ limit: 0 })).toThrow();
    expect(() => IpcContracts['gallery:get-recent'].request.parse({ limit: 51 })).toThrow();
  });
});
