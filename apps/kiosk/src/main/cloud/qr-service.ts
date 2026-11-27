import QRCode from 'qrcode';

import type { ReadyReceipt } from './ready-receipt.js';

export type RenderedQr = {
  imageDataUrl: string;
  expiresAt: string;
};

export class QrService {
  async render(receipt: ReadyReceipt): Promise<RenderedQr> {
    const url = `${receipt.publicPageOrigin}${receipt.publicPath}#${receipt.publicToken}`;
    return {
      imageDataUrl: await QRCode.toDataURL(url, {
        errorCorrectionLevel: 'M',
        margin: 4,
        width: 440,
        color: { dark: '#1d1d1f', light: '#ffffff' },
      }),
      expiresAt: receipt.expiresAt,
    };
  }
}
