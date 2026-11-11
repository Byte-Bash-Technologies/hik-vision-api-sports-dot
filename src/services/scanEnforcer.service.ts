import {
  sharedEventsService,
  sharedUsersService,
  sharedDeviceService,
  HikvisionEvents,
  HikvisionUsers,
  HikvisionDevice,
} from '../hikvision';
import { logger } from '../utils/logger';
import { scheduleConfigState } from './scheduleStore';

export class ScanEnforcerService {
  private eventsService: HikvisionEvents = sharedEventsService;
  private usersService: HikvisionUsers = sharedUsersService;
  private deviceService: HikvisionDevice = sharedDeviceService;
  private isEnforcing = false;

  // Tracks newly enrolled members who get 1 test scan at reception before daily lockout starts (employeeNo -> YYYY-MM-DD)
  private enrollmentCredits = new Map<string, string>();

  /**
   * Grant 1 enrollment test credit to a member upon creation or biometric capture.
   * This ensures their test tap at the front desk does not consume their daily entrance scan.
   */
  public grantEnrollmentCredit(employeeNo: string): void {
    const key = String(employeeNo);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    this.enrollmentCredits.set(key, today);
    logger.info(`[ScanEnforcer] User ${key} granted 1 enrollment test credit for ${today} (1 test + 1 checkin allowed today).`);
  }

  /**
   * Check recent events and enforce the 1-scan-per-day rule.
   * If an employee successfully authenticated today, advance their beginTime
   * to tomorrow 00:00:00 so the terminal hardware automatically rejects any
   * further attempts today with 'Invalid Time / Not in Validity Period'.
   */
  public async enforce(): Promise<{ enforcedUsers: string[] }> {
    if (this.isEnforcing) return { enforcedUsers: [] };
    if (!scheduleConfigState.oneScanPerDay) return { enforcedUsers: [] };

    this.isEnforcing = true;
    const enforcedUsers: string[] = [];

    try {
      // 1. Get current date in local terminal timezone
      const now = new Date();
      const datePart = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);

      // Tomorrow 00:00:00
      const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
      const tomorrowDatePart = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(tomorrow);
      const tomorrowMidnight = `${tomorrowDatePart}T00:00:00`;

      // 2. Fetch today's events from terminal
      const events = await this.eventsService.fetchAllEvents({
        startTime: `${datePart}T00:00:00`,
        endTime: `${datePart}T23:59:59`,
      });

      // 3. Find unique employees who had an Access Granted event today
      const successMinors = [38, 75, 104, 1];
      const todaySuccessEvents = events.filter((ev) => {
        if (!ev.employeeNo || ev.employeeNo === 'N/A') return false;
        if (ev.major !== 5) return false;
        if (!successMinors.includes(ev.minor)) return false;
        return ev.deviceDate === datePart;
      });

      const employeesWhoScannedToday = Array.from(
        new Set(todaySuccessEvents.map((e) => String(e.employeeNo)))
      );

      for (const empNo of employeesWhoScannedToday) {
        try {
          const userScans = todaySuccessEvents.filter((e) => String(e.employeeNo) === empNo);
          const creditDate = this.enrollmentCredits.get(empNo);
          const hasEnrollmentCredit = creditDate === datePart;

          // If the user has an enrollment credit today and this is only their 1st scan,
          // treat it as the reception verification scan and do not lock them out yet.
          if (hasEnrollmentCredit && userScans.length <= 1) {
            logger.info(
              `[ScanEnforcer] User ${empNo} used 1st scan for enrollment test. Remaining scan today: 1.`
            );
            continue;
          }

          // User has completed their allowed check-in for today (1 scan for normal users, 2 scans for newly enrolled)
          const userRes = await this.usersService.searchUsers({ employeeNo: empNo, maxResults: 1 });
          const user = userRes.users?.[0];
          if (!user) continue;

          const userValid = user.Valid as any;
          const currentBeginTime = userValid?.beginTime || '';
          // If the user's beginTime is not yet set to tomorrow (or later), advance it
          if (!currentBeginTime || currentBeginTime < tomorrowMidnight) {
            const currentEndTime = userValid?.endTime || `${now.getFullYear() + 1}-12-31T23:59:59`;
            logger.info(
              `[ScanEnforcer] User ${empNo} (${user.name}) scanned ${userScans.length} time(s) today. Advancing beginTime to ${tomorrowMidnight} to enforce 1-scan-per-day.`
            );

            await this.usersService.updateAccessPeriod(
              empNo,
              tomorrowMidnight,
              currentEndTime,
              user.userType !== 'blackList'
            );
            enforcedUsers.push(empNo);
          }
        } catch (err: any) {
          logger.warn(`[ScanEnforcer] Error enforcing for user ${empNo}:`, err?.message || err);
        }
      }
    } catch (err: any) {
      logger.warn('[ScanEnforcer] Error during enforcement run:', err?.message || err);
    } finally {
      this.isEnforcing = false;
    }

    return { enforcedUsers };
  }

  /**
   * Reset a single user's beginTime back to today (e.g. for reception re-entry or manual override)
   */
  public async resetUserToToday(employeeNo: string): Promise<boolean> {
    const todayMidnight = `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())}T00:00:00`;
    try {
      const userRes = await this.usersService.searchUsers({ employeeNo: String(employeeNo), maxResults: 1 });
      const user = userRes.users?.[0];
      if (!user) return false;

      const userValid = user.Valid as any;
      await this.usersService.updateAccessPeriod(
        String(employeeNo),
        todayMidnight,
        userValid?.endTime || '2035-12-31T23:59:59',
        user.userType !== 'blackList'
      );
      this.grantEnrollmentCredit(String(employeeNo));
      logger.info(`[ScanEnforcer] User ${employeeNo} beginTime reset to today.`);
      return true;
    } catch (err) {
      logger.warn(`[ScanEnforcer] Error resetting user ${employeeNo}:`, err);
      return false;
    }
  }

  /**
   * Reset all users' beginTime back to today (e.g. when toggling off 1-scan-per-day)
   */
  public async resetAllUsersToToday(): Promise<number> {
    const todayMidnight = `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())}T00:00:00`;
    let count = 0;
    this.enrollmentCredits.clear();

    try {
      const allUsers = await this.usersService.fetchAllUsers(50);
      for (const u of allUsers) {
        const uValid = u.Valid as any;
        if (uValid?.beginTime && uValid.beginTime > todayMidnight) {
          await this.usersService.updateAccessPeriod(
            String(u.employeeNo),
            todayMidnight,
            uValid.endTime || '2035-12-31T23:59:59',
            u.userType !== 'blackList'
          );
          count++;
        }
      }
      logger.info(`[ScanEnforcer] Reset ${count} user(s) beginTime back to today.`);
    } catch (err) {
      logger.warn('[ScanEnforcer] Error resetting users:', err);
    }
    return count;
  }
}

export const scanEnforcerService = new ScanEnforcerService();
