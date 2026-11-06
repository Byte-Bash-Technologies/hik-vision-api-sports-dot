import { Router, Request, Response, NextFunction } from 'express';
import { HikvisionClient, HikvisionEvents } from '../hikvision';
import { config } from '../config';

const router = Router();

const client = new HikvisionClient({
  host: config.HIKVISION_HOST,
  username: config.HIKVISION_USERNAME,
  password: config.HIKVISION_PASSWORD,
  verifyTls: config.HIKVISION_VERIFY_TLS,
  timeoutMs: config.HIKVISION_TIMEOUT,
});

const eventsService = new HikvisionEvents(client);

import { scheduleConfigState } from '../services/scheduleStore';

/**
 * Helper to map raw event to rich HikAttendanceEvent with Shift tagging
 */
function mapToHikAttendanceEvent(ev: any) {
  const failedMinors = [39, 76, 78, 33, 34, 37, 6, 7, 8, 9];
  const isFailed = ev.major === 5 && failedMinors.includes(ev.minor);
  const isSuccess = ev.major === 5 && [38, 75, 104, 1].includes(ev.minor);
  const isDoorEvent = ev.major === 5 && [21, 22].includes(ev.minor);

  // Calculate shift from punch time (e.g. "07:15:30")
  const timeStr = ev.deviceTime || '';
  const hour = parseInt(timeStr.slice(0, 2), 10);
  let shift: 'MORNING' | 'EVENING' | 'OTHER' = 'OTHER';
  if (!isNaN(hour)) {
    if (hour >= 4 && hour < 13) {
      shift = 'MORNING';
    } else if (hour >= 13 && hour < 23) {
      shift = 'EVENING';
    }
  }

  const status = isFailed ? 'FAILED' : 'SUCCESS';
  const statusLabel = isFailed
    ? (ev.minor === 8 ? 'Access Denied (Invalid Time)' : ev.minor === 9 ? 'Access Denied (Expired)' : 'Access Denied')
    : isSuccess
    ? 'Access Granted'
    : isDoorEvent
    ? (ev.minor === 21 ? 'Door Unlocked' : 'Door Locked')
    : ev.description;

  return {
    id: ev.id,
    deviceId: 'terminal-1',
    deviceName: 'Hikvision Access Terminal',
    deviceModel: 'DS-K1T320MFWX',
    employeeNo: ev.employeeNo || 'N/A',
    employeeName: ev.employeeName || 'Unknown',
    eventTime: ev.time,
    dateFormatted: ev.deviceDate,
    timeFormatted: ev.deviceTime,
    shift,
    shiftLabel: shift === 'MORNING' ? 'Morning Shift' : shift === 'EVENING' ? 'Evening Shift' : 'General',
    major: ev.major,
    minor: ev.minor,
    status,
    statusLabel,
    eventCategory: ev.category,
    eventDescription: ev.description,
    verificationMode: ev.verifyMode,
    verificationModeLabel: ev.verifyModeLabel,
    doorNo: ev.doorNo,
    cardReaderNo: ev.cardReaderNo,
    serialNo: ev.serialNo,
    hasRawPayload: true,
    rawEvent: ev.raw,
  };
}

/**
 * GET /api/attendance
 * Returns attendance events matching React Native HikAttendanceEvent
 * Supports filtering by date, shift, search, and employeeNo
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const position = req.query.position ? parseInt(req.query.position as string, 10) : 0;
    const maxResults = req.query.maxResults ? parseInt(req.query.maxResults as string, 10) : 50;
    const date = req.query.date as string | undefined;
    const shift = req.query.shift as string | undefined;
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const filterDate = date === 'all' ? undefined : (date || todayStr);
    const startTime = req.query.startTime as string | undefined || (filterDate ? `${filterDate}T00:00:00` : undefined);
    const endTime = req.query.endTime as string | undefined || (filterDate ? `${filterDate}T23:59:59` : undefined);
    const employeeNo = (req.query.employeeNo as string) || (req.query.employeeNoString as string);
    const search = req.query.search as string | undefined;

    let rawEvents: any[];
    let totalCount = 0;

    if (filterDate) {
      const allDay = await eventsService.fetchAllEvents({
        startTime,
        endTime,
        employeeNo,
      });
      totalCount = allDay.length;
      allDay.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      rawEvents = allDay.slice(position, position + maxResults);
    } else {
      const init = await eventsService.searchEvents({ maxResults: 1 });
      const overallTotal = Number(init.totalMatches || 0);
      const pos = Math.max(0, overallTotal - (position + maxResults));
      const result = await eventsService.searchEvents({
        position: pos,
        maxResults,
        employeeNo,
      });
      totalCount = overallTotal;
      rawEvents = [...result.events].reverse();
    }

    let mapped = rawEvents.map(mapToHikAttendanceEvent);

    if (filterDate) {
      mapped = mapped.filter((ev) => ev.dateFormatted === filterDate);
    }

    if (shift && shift !== 'ALL') {
      if (shift === 'MORNING') {
        mapped = mapped.filter((ev) => ev.shift === 'MORNING');
      } else if (shift === 'EVENING') {
        mapped = mapped.filter((ev) => ev.shift === 'EVENING');
      } else if (shift === 'DENIED') {
        mapped = mapped.filter((ev) => ev.status === 'FAILED');
      }
    }
    if (employeeNo) {
      mapped = mapped.filter((ev) => String(ev.employeeNo) === String(employeeNo));
    }
    if (search) {
      const q = search.toLowerCase();
      mapped = mapped.filter(
        (ev) =>
          ev.employeeName?.toLowerCase().includes(q) ||
          ev.employeeNo?.toLowerCase().includes(q)
      );
    }

    res.json({
      success: true,
      data: mapped,
      pagination: {
        page: Math.floor(position / maxResults) + 1,
        limit: maxResults,
        total: totalCount,
        totalPages: Math.ceil(totalCount / maxResults) || 1,
      },
    });
  } catch (error) {
    next(error);
  }
});

import { scanEnforcerService } from '../services/scanEnforcer.service';

/**
 * POST /api/attendance/sync
 * Sync attendance events from terminal
 */
router.post('/sync', async (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  try {
    const events = await eventsService.fetchAllEvents({ maxResults: 30 });
    const { enforcedUsers } = await scanEnforcerService.enforce();

    res.json({
      success: true,
      data: {
        count: events.length,
        enforcedUsers,
        durationMs: Date.now() - start,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/attendance/recent
 * Returns formatted latest punches for mobile home screens
 */
router.get('/recent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

    const init = await eventsService.searchEvents({ maxResults: 1 });
    const total = Number(init.totalMatches || 0);
    const pos = Math.max(0, total - limit);

    const result = await eventsService.searchEvents({
      position: pos,
      maxResults: limit,
    });

    const sorted = [...result.events].reverse();

    res.json({
      success: true,
      count: sorted.length,
      data: sorted,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/attendance/summary
 * Daily summary for mobile dashboards
 */
router.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const targetDate = (req.query.date as string) || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

    const events = await eventsService.fetchAllEvents({
      startTime: `${targetDate}T00:00:00`,
      endTime: `${targetDate}T23:59:59`,
    });

    const dayEvents = events.filter((e) => e.deviceDate === targetDate || !e.deviceDate);

    const verifiedMinors = [38, 75, 104, 1];
    const verifiedAuth = dayEvents.filter(
      (e) => e.major === 5 && verifiedMinors.includes(e.minor) && e.employeeNo && e.employeeNo !== 'N/A'
    );

    const uniqueEmployeesPresent = new Set(verifiedAuth.map((e) => String(e.employeeNo))).size;

    const morningEvents = verifiedAuth.filter((e) => {
      const h = parseInt((e.deviceTime || '').slice(0, 2), 10);
      return !isNaN(h) && h >= 4 && h < 13;
    });
    const morningPresent = new Set(morningEvents.map((e) => String(e.employeeNo))).size;

    const eveningEvents = verifiedAuth.filter((e) => {
      const h = parseInt((e.deviceTime || '').slice(0, 2), 10);
      return !isNaN(h) && h >= 13 && h < 23;
    });
    const eveningPresent = new Set(eveningEvents.map((e) => String(e.employeeNo))).size;

    const failedMinors = [39, 76, 78, 33, 34, 37, 6, 7];
    const failedAttempts = dayEvents.filter(
      (e) => e.major === 5 && failedMinors.includes(e.minor)
    ).length;

    res.json({
      success: true,
      data: {
        date: targetDate,
        totalEventsRecorded: events.length,
        todayEventsCount: dayEvents.length,
        presentToday: uniqueEmployeesPresent,
        morningCount: morningPresent,
        eveningCount: eveningPresent,
        failedAttemptsToday: failedAttempts,
        shifts: {
          morning: {
            begin: scheduleConfigState.morningBeginTime,
            end: scheduleConfigState.morningEndTime,
            count: morningPresent,
          },
          evening: {
            begin: scheduleConfigState.eveningBeginTime,
            end: scheduleConfigState.eveningEndTime,
            count: eveningPresent,
          },
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/attendance/user/:employeeNo
 * Get punches for a specific user
 */
router.get('/user/:employeeNo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employeeNo = req.params.employeeNo;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

    const init = await eventsService.searchEvents({
      maxResults: 1,
      employeeNo,
    });

    const total = Number(init.totalMatches || 0);
    const pos = Math.max(0, total - limit);

    const result = await eventsService.searchEvents({
      position: pos,
      maxResults: limit,
      employeeNo,
    });

    let events = result.events;
    // Fallback if terminal didn't filter in hardware condition
    if (events.length === 0 || events.some((e) => e.employeeNo && String(e.employeeNo) !== String(employeeNo))) {
      const allEvents = await eventsService.fetchAllEvents();
      events = allEvents.filter((ev) => String(ev.employeeNo) === String(employeeNo));
    }

    const mapped = events
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, limit)
      .map(mapToHikAttendanceEvent);

    res.json({
      success: true,
      employeeNo,
      count: mapped.length,
      data: mapped,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
