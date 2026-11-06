import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  user?: string;
  password?: string;
}

export interface SmtpSettingsResult {
  settings?: SmtpSettings;
  missing: string[];
}

interface RawSmtpSettings {
  prefix: string;
  host?: string;
  portText?: string;
  secure?: boolean;
  from?: string;
  user?: string;
  password?: string;
}

function text(config: ConfigService, key: string): string | undefined {
  const value = config.get<string>(key)?.trim();
  return value || undefined;
}

function booleanValue(config: ConfigService, key: string): boolean | undefined {
  const value = text(config, key);
  if (value === undefined) return false;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  return undefined;
}

function readRawSmtpSettings(config: ConfigService, prefix: string): RawSmtpSettings {
  return {
    prefix,
    host: text(config, `${prefix}_HOST`),
    portText: text(config, `${prefix}_PORT`),
    secure: booleanValue(config, `${prefix}_SECURE`),
    from: text(config, `${prefix}_FROM`),
    user: text(config, `${prefix}_USER`),
    password: text(config, `${prefix}_PASSWORD`)
  };
}

function parsePort(portText?: string): number {
  return Number(portText);
}

function hasInvalidPort(portText: string | undefined, port: number): boolean {
  return !portText || !Number.isInteger(port) || port < 1 || port > 65535;
}

function hasMismatchedCredentials(user: string | undefined, password: string | undefined): boolean {
  return (user && !password) !== (!user && password);
}

function missingSmtpFields(values: RawSmtpSettings, port: number): string[] {
  const { prefix, host, portText, secure, from, user, password } = values;
  const missing: string[] = [];

  if (!host) missing.push(`${prefix}_HOST`);
  if (hasInvalidPort(portText, port)) missing.push(`${prefix}_PORT`);
  if (secure === undefined) missing.push(`${prefix}_SECURE`);
  if (!from) missing.push(`${prefix}_FROM`);
  if (hasMismatchedCredentials(user, password)) missing.push(`${prefix}_USER/${prefix}_PASSWORD`);
  return missing;
}

function buildSmtpSettings(values: RawSmtpSettings, port: number): SmtpSettings {
  const { host, secure, from, user, password } = values;
  return {
    host: host as string,
    port,
    secure: secure as boolean,
    from: from as string,
    ...(user ? { user, password } : {})
  };
}


export function readSmtpSettings(config: ConfigService, prefix = 'SMTP'): SmtpSettingsResult {
  const values = readRawSmtpSettings(config, prefix);
  const port = parsePort(values.portText);
  const missing = missingSmtpFields(values, port);
  if (missing.length > 0) return { missing };

  return { settings: buildSmtpSettings(values, port), missing: [] };
}

export function createSmtpTransport(settings: SmtpSettings): Transporter {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    ...(settings.user && settings.password ? { auth: { user: settings.user, pass: settings.password } } : {})
  });
}

export function isEnabled(config: ConfigService, key: string): boolean {
  return config.get<string>(key, 'false').trim().toLowerCase() === 'true';
}
