import { config } from '../config';
import { HikvisionClient } from './HikvisionClient';
import { HikvisionDevice } from './HikvisionDevice';
import { HikvisionUsers } from './HikvisionUsers';
import { HikvisionEvents } from './HikvisionEvents';

/**
 * Shared singleton HikvisionClient so all Express routes and background services
 * reuse the same HTTP/HTTPS keep-alive connection pool and Digest Auth challenge.
 */
export const sharedHikvisionClient = new HikvisionClient({
  host: config.HIKVISION_HOST,
  username: config.HIKVISION_USERNAME,
  password: config.HIKVISION_PASSWORD,
  verifyTls: config.HIKVISION_VERIFY_TLS,
  timeoutMs: config.HIKVISION_TIMEOUT,
  isMock: config.HIKVISION_MOCK,
});

export const sharedDeviceService = new HikvisionDevice(sharedHikvisionClient);
export const sharedUsersService = new HikvisionUsers(sharedHikvisionClient);
export const sharedEventsService = new HikvisionEvents(sharedHikvisionClient);

