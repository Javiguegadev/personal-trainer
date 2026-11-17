import { randomUUID } from 'expo-crypto';

/** A new id for a row created on the device (food-log items are written with `PUT`, spec 005). */
export function newId(): string {
  return randomUUID();
}
