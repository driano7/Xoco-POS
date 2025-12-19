/*
 * Utilidades para generar hashes salteados para el POS.
 * Combina un salt global y uno específico por usuario.
 */

import { createHash } from 'crypto';

const GLOBAL_SALT = process.env.POS_PASSWORD_GLOBAL_SALT ?? '';

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '_');

const getEnv = (prefix: string, identifier: string) => {
  const key = `${prefix}_${identifier}`.toUpperCase();
  return process.env[key] ?? null;
};

export const getUserSalt = (email: string) => getEnv('POS_PASSWORD_SALT', slugify(email)) ?? '';

export const getPresetHashOverride = (email: string) =>
  getEnv('POS_PASSWORD_HASH', slugify(email));

export const hashWithSalts = (email: string, password: string) => {
  const userSalt = getUserSalt(email);
  const payload = `${GLOBAL_SALT}${password}${userSalt}`;
  return createHash('sha256').update(payload).digest('hex');
};
