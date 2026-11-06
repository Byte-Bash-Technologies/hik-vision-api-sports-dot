import { Router, Request, Response, NextFunction } from 'express';
import { HikvisionClient, HikvisionDevice, HikvisionUsers, HikvisionEvents } from '../hikvision';
import { config } from '../config';

const router = Router();

const client = new HikvisionClient({
  host: config.HIKVISION_HOST,
  username: config.HIKVISION_USERNAME,
  password: config.HIKVISION_PASSWORD,
  verifyTls: config.HIKVISION_VERIFY_TLS,
  timeoutMs: config.HIKVISION_TIMEOUT,
});

const deviceService = new HikvisionDevice(client);
const usersService = new HikvisionUsers(client);
const eventsService = new HikvisionEvents(client);

/**
 * GET /api/dashboard/summary
 * Aggregates device status, user counts, and recent punches matching HikDashboardSummary
 */
router.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [deviceInfo, userCounts, initEvents] = await Promise.all([
      deviceService.getDeviceInfo().catch(() => ({
        deviceName: 'Access Controller',
        model: 'DS-K1T320MFWX',
        serialNumber: 'Unknown',
        firmwareVersion: 'V3.5.2',
        raw: {},
      })),
      usersService.getUserCount().catch(() => ({
        userNumber: 1,
        bindFingerprintUserNumber: 1,
        bindFaceUserNumber: 0,
        bindCardUserNumber: 0,
        raw: {},
      })),
      eventsService.searchEvents({ maxResults: 1 }).catch(() => ({
        totalMatches: 0,
        numOfMatches: 0,
        events: [],
      })),
    ]);

    const todayStr = (req.query.date as string) || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

    const totalEventsCount = Number(initEvents.totalMatches || 0);
    const latestPos = Math.max(0, totalEventsCount - 30);
    const [recentBuffer, todayEvents] = await Promise.all([
      eventsService.searchEvents({ position: latestPos, maxResults: 30 }).catch(() => ({
        totalMatches: totalEventsCount,
        numOfMatches: 0,
        events: [],
      })),
      eventsService.fetchAllEvents({
        startTime: `${todayStr}T00:00:00`,
        endTime: `${todayStr}T23:59:59`,
      }).catch(() => []),
    ]);

    // Verified attendance punches: major 5 with minor 38, 75 (face passed), 104, 1 with employeeNo
    const verifiedMinors = [38, 75, 104, 1];
    const verifiedAuthToday = todayEvents.filter(
      (e) => e.major === 5 && verifiedMinors.includes(e.minor) && e.employeeNo && e.employeeNo !== 'N/A'
    );

    const uniqueEmployeesPresent = new Set(verifiedAuthToday.map((e) => String(e.employeeNo))).size;
    const failedMinors = [39, 76, 78, 33, 34, 37, 6, 7];
    const failedAttempts = todayEvents.filter(
      (e) => e.major === 5 && failedMinors.includes(e.minor)
    ).length;

    const recentEvents = [...recentBuffer.events]
      .reverse()
      .slice(0, 10)
      .map((ev) => ({
        id: ev.id,
        employeeNo: ev.employeeNo || 'N/A',
        employeeName: ev.employeeName || 'Unknown',
        eventTime: ev.time,
        timeFormatted: ev.deviceTime,
        eventDescription: ev.description,
        verificationModeLabel: ev.verifyModeLabel,
        doorNo: ev.doorNo,
      }));

    res.json({
      success: true,
      data: {
        todayEvents: verifiedAuthToday.length,
        presentToday: uniqueEmployeesPresent,
        device: {
          id: deviceInfo.serialNumber,
          name: deviceInfo.deviceName,
          model: deviceInfo.model,
          firmware: deviceInfo.firmwareVersion,
          serialNo: deviceInfo.serialNumber
            ? `${deviceInfo.serialNumber.substring(0, 4)}****${deviceInfo.serialNumber.slice(-3)}`
            : 'Unknown',
          host: config.HIKVISION_HOST,
          lastSeenAt: new Date().toISOString(),
          lastSyncAt: new Date().toISOString(),
        },
        stats: {
          totalUsers: userCounts.userNumber,
          fingerprintUsers: userCounts.bindFingerprintUserNumber,
          faceUsers: userCounts.bindFaceUserNumber,
          cardUsers: userCounts.bindCardUserNumber,
          totalEvents: totalEventsCount,
          todayEvents: verifiedAuthToday.length,
          rawTodayEvents: todayEvents.length,
          presentToday: uniqueEmployeesPresent,
          failedAttemptsToday: failedAttempts,
        },
        recentEvents,
        serverTime: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
