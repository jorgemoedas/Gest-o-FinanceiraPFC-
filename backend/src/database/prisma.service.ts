import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { postgresAdapterOptions } from './postgres-connection';

function positiveInteger(config: ConfigService, key: string, fallback: number): number {
  const parsed = Number.parseInt(config.get<string>(key) ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_DATABASE_POOL_MAX = 10;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    const adapterOptions = postgresAdapterOptions(
      config.getOrThrow<string>('DATABASE_URL'),
      config.get<string>('DATABASE_CA_CERT')
    );
    const adapter = new PrismaPg({
      ...adapterOptions,
      // O limite deve respeitar a cota do provedor; aumentar o pool não torna
      // consultas mais rápidas e pode esgotar as conexões do Supabase.
      max: positiveInteger(config, 'DATABASE_POOL_MAX', DEFAULT_DATABASE_POOL_MAX),
      connectionTimeoutMillis: positiveInteger(config, 'DATABASE_CONNECTION_TIMEOUT_MS', 10_000),
      idleTimeoutMillis: positiveInteger(config, 'DATABASE_IDLE_TIMEOUT_MS', 30_000)
    });
    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
