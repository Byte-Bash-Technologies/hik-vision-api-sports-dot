import { Router, Request, Response, NextFunction } from 'express';
import {
  sharedDeviceService as deviceService,
  sharedUsersService as usersService,
  sharedEventsService as eventsService,
} from '../hikvision';
import { config } from '../config';

const router = Router();

/**
 * GET /api/device
 * Returns device metadata matching HikDevice interface
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const info = await deviceService.getDeviceInfo();
    res.json({
      success: true,
      data: {
        id: info.serialNumber || 'ds-k1t320mfwx-terminal',
        name: info.deviceName,
        host: config.HIKVISION_HOST,
        username: config.HIKVISION_USERNAME,
        model: info.model,
        firmware: info.firmwareVersion,
        serialNo: info.serialNumber,
        enabled: true,
        lastSeenAt: new Date().toISOString(),
        connection: {
          host: config.HIKVISION_HOST,
          username: config.HIKVISION_USERNAME,
          verifyTls: config.HIKVISION_VERIFY_TLS,
          timeoutMs: config.HIKVISION_TIMEOUT,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/device/status
 * Returns online status and latency
 */
router.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await deviceService.testConnection();
    res.json({
      success: true,
      data: {
        online: status.online,
        latencyMs: status.latencyMs,
        model: status.deviceInfo?.model || 'DS-K1T320MFWX',
        firmware: status.deviceInfo?.firmwareVersion,
        serialNo: status.deviceInfo?.serialNumber,
        host: config.HIKVISION_HOST,
        error: status.error,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/device/test
 * Explicit test endpoint (called by React Native test buttons)
 */
router.post('/test', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await deviceService.testConnection();
    res.json({
      success: status.online,
      data: {
        online: status.online,
        latencyMs: status.latencyMs,
        model: status.deviceInfo?.model || 'DS-K1T320MFWX',
        firmware: status.deviceInfo?.firmwareVersion,
        serialNo: status.deviceInfo?.serialNumber,
        error: status.error,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/device/sync
 * Sync both users and events on demand
 */
router.post('/sync', async (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  try {
    const [users, events] = await Promise.all([
      usersService.fetchAllUsers(30).catch(() => []),
      eventsService.fetchAllEvents({ maxResults: 30 }).catch(() => []),
    ]);

    res.json({
      success: true,
      data: {
        usersCount: users.length,
        eventsCount: events.length,
        durationMs: Date.now() - start,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/device/open-door
 * Remote door unlock command
 */
router.post('/open-door', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doorNo = Number(req.body?.doorNo || 1);
    const result = await deviceService.openDoor(doorNo);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

import { scheduleConfigState, setScheduleConfig } from '../services/scheduleStore';
import { scanEnforcerService } from '../services/scanEnforcer.service';

/**
 * GET /api/device/schedule
 * Get current time schedule and scan rules
 */
router.get('/schedule', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hwSchedule = await deviceService.getSchedule();
    res.json({
      success: true,
      data: {
        ...scheduleConfigState,
        ...hwSchedule,
        oneScanPerDay: scheduleConfigState.oneScanPerDay,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/device/schedule
 * Update hardware time window and scan frequency rule
 */
router.post('/schedule', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      enabled,
      mode,
      morningBeginTime,
      morningEndTime,
      eveningBeginTime,
      eveningEndTime,
      beginTime,
      endTime,
      templateName,
      oneScanPerDay,
      applyToAllUsers,
    } = req.body;

    const scheduleMode = mode || (morningBeginTime ? 'dual' : scheduleConfigState.mode || 'dual');
    const mB = (morningBeginTime || scheduleConfigState.morningBeginTime || '06:00').slice(0, 5);
    const mE = (morningEndTime || scheduleConfigState.morningEndTime || '11:00').slice(0, 5);
    const eB = (eveningBeginTime || scheduleConfigState.eveningBeginTime || '17:00').slice(0, 5);
    const eE = (eveningEndTime || scheduleConfigState.eveningEndTime || '22:00').slice(0, 5);

    const bTime = (beginTime || (scheduleMode === 'evening' ? eB : mB)).slice(0, 5);
    const eTime = (endTime || (scheduleMode === 'morning' ? mE : eE)).slice(0, 5);
    const isScheduleEnabled = enabled !== undefined ? Boolean(enabled) : scheduleConfigState.enabled;
    const isOneScan = oneScanPerDay !== undefined ? Boolean(oneScanPerDay) : scheduleConfigState.oneScanPerDay;

    // 1. Program physical terminal WeekPlan 2 & PlanTemplate 2 with shift(s)
    if (isScheduleEnabled) {
      await deviceService.setSchedule({
        enabled: true,
        mode: scheduleMode,
        templateName,
        morningBeginTime: mB,
        morningEndTime: mE,
        eveningBeginTime: eB,
        eveningEndTime: eE,
        beginTime: bTime,
        endTime: eTime,
      });
    }

    const defaultTitle = scheduleMode === 'dual'
      ? `Two Shifts: Morning (${mB}-${mE}) & Evening (${eB}-${eE})`
      : scheduleMode === 'morning'
      ? `Morning Shift (${mB}-${mE})`
      : scheduleMode === 'evening'
      ? `Evening Shift (${eB}-${eE})`
      : `Access Hours (${bTime}-${eTime})`;

    setScheduleConfig({
      enabled: isScheduleEnabled,
      mode: scheduleMode,
      templateNo: isScheduleEnabled ? 2 : 1,
      templateName: isScheduleEnabled ? (templateName || defaultTitle) : 'All Day (24/7)',
      morningBeginTime: mB,
      morningEndTime: mE,
      eveningBeginTime: eB,
      eveningEndTime: eE,
      beginTime: bTime,
      endTime: eTime,
      oneScanPerDay: isOneScan,
    });

    // 2. Optionally update all enrolled users' RightPlan
    let updatedUsersCount = 0;
    if (applyToAllUsers) {
      const allUsers = await usersService.fetchAllUsers(50);
      const targetTemplate = isScheduleEnabled ? '2' : '1';
      for (const u of allUsers) {
        try {
          await usersService.updateUserPlanTemplate(String(u.employeeNo), targetTemplate);
          updatedUsersCount++;
        } catch (uErr) {
          console.warn(`Could not update plan for user ${u.employeeNo}:`, uErr);
        }
      }
    }

    // 3. Immediately enforce or reset 1-scan-per-day rule
    if (isOneScan) {
      scanEnforcerService.enforce().catch((e) => console.warn('ScanEnforcer error:', e));
    } else {
      scanEnforcerService.resetAllUsersToToday().catch((e) => console.warn('ScanEnforcer reset error:', e));
    }

    res.json({
      success: true,
      message: isScheduleEnabled
        ? scheduleMode === 'dual'
          ? `Terminal programmed with 2 Shifts: Morning (${mB}-${mE}) and Evening (${eB}-${eE})`
          : `Terminal programmed: Allowed hours ${bTime} - ${eTime}${isOneScan ? ' (1 scan/day limit)' : ''}`
        : 'Terminal set to All Day (24/7) access',
      data: {
        ...scheduleConfigState,
        updatedUsersCount,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
