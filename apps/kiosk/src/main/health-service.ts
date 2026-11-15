import type { AdminHealth, CameraAdapter, PrinterHealth } from '@grace-booth/shared';

import type { DeliveryClient } from './cloud/delivery-client.js';
import type { LocalRepository } from './database/repositories.js';
import type { PlatformSecretProtection } from './storage/secret-store.js';

export class HealthService {
  constructor(
    private readonly camera: CameraAdapter,
    private readonly delivery: DeliveryClient,
    private readonly repository: LocalRepository,
    private readonly protection: PlatformSecretProtection,
    private readonly now: () => number = Date.now,
    private readonly printer: (() => PrinterHealth) | null = null,
  ) {}

  async getHealth(): Promise<AdminHealth> {
    const checkedAt = this.now();
    const [camera, cloud] = await Promise.all([
      this.camera.getStatus().catch(() => null),
      this.delivery.health().catch(() => ({
        healthy: false,
        code: 'cloud_health_failed',
        message: 'Cloud health could not be checked.',
      })),
    ]);
    const databaseHealthy = this.repository.integrityCheck();
    const encryptionHealthy = this.protection.isAvailable();
    return {
      camera: {
        state:
          camera?.state === 'ready'
            ? 'healthy'
            : camera?.state === 'unsupported'
              ? 'unavailable'
              : 'degraded',
        code: camera?.code ?? (camera ? null : 'camera_health_failed'),
        message: camera?.operatorMessage ?? 'Camera health could not be checked.',
        checkedAt,
      },
      cloud: {
        state: cloud.healthy
          ? 'healthy'
          : this.delivery.isConfigured()
            ? 'degraded'
            : 'unconfigured',
        code: cloud.code,
        message: cloud.message,
        checkedAt,
      },
      database: {
        state: databaseHealthy ? 'healthy' : 'unavailable',
        code: databaseHealthy ? null : 'database_integrity_failed',
        message: databaseHealthy
          ? 'Local database is healthy.'
          : 'Local database needs operator attention.',
        checkedAt,
      },
      encryption: {
        state: encryptionHealthy ? 'healthy' : 'unavailable',
        code: encryptionHealthy ? null : 'secure_storage_unavailable',
        message: encryptionHealthy
          ? 'Windows secure storage is available.'
          : 'Windows secure storage is unavailable.',
        checkedAt,
      },
      ...(this.printer ? { printer: printerServiceHealth(this.printer()) } : {}),
    };
  }
}

function printerServiceHealth(health: PrinterHealth): AdminHealth['camera'] {
  return {
    state:
      health.status === 'ready' || health.status === 'printing'
        ? 'healthy'
        : health.status === 'unconfigured'
          ? 'unconfigured'
          : 'degraded',
    code:
      health.status === 'ready' || health.status === 'printing' ? null : `printer_${health.status}`,
    message: health.message,
    checkedAt: health.checkedAt,
  };
}
