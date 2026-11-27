import type { FastifyInstance } from 'fastify';

import type { LanCertificateService } from '../auth/lan-certificate-service.js';
import type { LocalRepository } from '../database/repositories.js';
import {
  startLocalAdminListener,
  type AdminListenerHealth,
  type LocalAdminDependencies,
} from './local-admin-server.js';
import { assertPrivateIpv4 } from './network-boundary.js';

const LOOPBACK_PORT = 4_311;
type ListenerStarter = typeof startLocalAdminListener;

export class AdminServerManager {
  private loopback: FastifyInstance | null = null;
  private lan: FastifyInstance | null = null;
  private reconfiguring: Promise<void> = Promise.resolve();
  private lanHealth: AdminListenerHealth = {
    loopback: 'unavailable',
    lan: 'disabled',
    code: null,
    message: 'The local admin listener has not started.',
  };

  constructor(
    private readonly dependencies: LocalAdminDependencies,
    private readonly repository: LocalRepository,
    private readonly certificates: LanCertificateService,
    private readonly startListener: ListenerStarter = startLocalAdminListener,
    private readonly loopbackPort: number = LOOPBACK_PORT,
  ) {}

  async start(): Promise<void> {
    if (!this.loopback) {
      this.loopback = await this.startListener(this.dependencies, {
        host: '127.0.0.1',
        port: this.loopbackPort,
        tls: null,
      });
      this.lanHealth = {
        loopback: 'healthy',
        lan: 'disabled',
        code: null,
        message: 'Loopback admin access is available; LAN access is disabled.',
      };
    }
    await this.configureLanSafely();
  }

  requestReconfigure(): void {
    this.reconfiguring = this.reconfiguring
      .catch(() => undefined)
      .then(() => this.configureLanSafely());
  }

  getListenerHealth(): AdminListenerHealth {
    return { ...this.lanHealth };
  }

  async close(): Promise<void> {
    await this.reconfiguring.catch(() => undefined);
    const servers = [this.lan, this.loopback].filter(
      (server): server is FastifyInstance => server !== null,
    );
    this.lan = null;
    this.loopback = null;
    await Promise.allSettled(servers.map((server) => server.close()));
  }

  private async configureLanSafely(): Promise<void> {
    if (this.lan) {
      await this.lan.close().catch(() => undefined);
      this.lan = null;
    }
    try {
      const settings = this.repository.getSettings();
      if (!settings.lanEnabled) {
        this.lanHealth = {
          loopback: this.loopback ? 'healthy' : 'unavailable',
          lan: 'disabled',
          code: null,
          message: 'Loopback admin access is available; LAN access is disabled.',
        };
        return;
      }
      assertPrivateIpv4(settings.lanBindHost);
      const tls = this.certificates.load();
      if (!tls) throw new Error('LAN TLS configuration is missing');
      this.lan = await this.startListener(this.dependencies, {
        host: settings.lanBindHost,
        port: settings.lanPort,
        tls,
      });
      this.lanHealth = {
        loopback: this.loopback ? 'healthy' : 'unavailable',
        lan: 'healthy',
        code: null,
        message: `LAN admin access is available on ${settings.lanBindHost}:${settings.lanPort}.`,
      };
    } catch {
      this.lan = null;
      this.lanHealth = {
        loopback: this.loopback ? 'healthy' : 'unavailable',
        lan: 'unavailable',
        code: 'lan_listener_unavailable',
        message: 'LAN admin access is unavailable. Loopback admin access remains available.',
      };
    }
  }
}
